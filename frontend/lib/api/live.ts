// HTTP client for the real FastAPI backend (DESIGN_PLAN.md §8, BACKEND_HANDOFF.md).
// Used when NEXT_PUBLIC_API_URL is set; otherwise the in-browser demo engine runs.

import type {
  ActivityEvent,
  Candidate,
  Chunk,
  Classification,
  DocumentMeta,
  Feedback,
  Memory,
  MemoryClass,
  MemoryOp,
  Retrieval,
  Turn,
  Weights,
  World,
} from "../engine/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
export const LIVE = API_URL.length > 0;

/** GET /api/state: the world plus the server's demo clock. */
export type ServerWorld = World & { clockOffset: number; serverNow: number };

export interface WorldPatch {
  memories: Memory[];
  chunks: Chunk[]; // only the ones that changed
  positions: Record<string, [number, number]>; // only new ones
  events: ActivityEvent[];
}

export type ChatEvent =
  | { type: "user"; turn: Turn }
  | { type: "stage"; stage: "classifying" | "remembering" | "retrieving" | "generating" }
  | { type: "classification"; turn_id: string; classification: Classification }
  | { type: "memory_ops"; turn_id: string; ops: MemoryOp[] }
  | ({ type: "patch" } & WorldPatch)
  | { type: "retrieval"; turn_id: string; retrieval: Retrieval }
  | { type: "token"; turn_id: string; text: string }
  | { type: "done"; turn: Turn }
  | { type: "error"; message: string };

export interface FeedbackResult {
  weights: Weights;
  feedback: Feedback;
  deltas: Weights | null;
  events: ActivityEvent[];
}

export interface IngestResult {
  document: DocumentMeta | null;
  chunks: Chunk[];
  events: ActivityEvent[];
  alreadyIndexed: boolean;
}

export interface ClockResult {
  now: number;
  clockOffset: number;
  expired: string[];
  events: ActivityEvent[];
}

export interface ClassifierEval {
  predictor: string;
  accuracy: number;
  macroF1: number;
  correct: number;
  total: number;
  classes: MemoryClass[];
  confusion: number[][]; // rows = true class, columns = predicted, in `classes` order
  misses: { text: string; expected: MemoryClass; got: MemoryClass }[];
}

export interface Health {
  status: string;
  answers: string; // model id, or "template"
  classifier: string;
  embedder: string;
  vectorStore: string;
  indexed: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = (body as { detail?: unknown } | null)?.detail;
    const msg = typeof detail === "string" ? detail : (detail as { message?: string } | undefined)?.message;
    throw new ApiError(msg || `${init?.method ?? "GET"} ${path} failed with ${res.status}`, res.status, detail ?? body);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = <T>(path: string, method: string, body?: unknown) =>
  request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** POST /api/chat → Server-Sent Events, one JSON `ChatEvent` per `data:` line. */
export async function streamChat(
  message: string,
  ids: { sessionId: string; userTurnId: string; assistantTurnId: string },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, session_id: ids.sessionId, user_turn_id: ids.userTurnId, assistant_turn_id: ids.assistantTurnId }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`POST /api/chat failed with ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as ChatEvent);
    }
  }
}

export const live = {
  state: () => request<ServerWorld>("/api/state"),
  health: () => request<Health>("/api/health"),
  reset: () => json<ServerWorld>("/api/reset", "POST"),
  feedback: (body: { turn_id: string; verdict: Feedback["verdict"]; reason?: Feedback["reason"]; target_id?: string }) =>
    json<FeedbackResult>("/api/feedback", "POST", body),
  patchMemory: (id: string, body: { pinned?: boolean; status?: "outdated" }) => json<Memory>(`/api/memories/${encodeURIComponent(id)}`, "PATCH", body),
  deleteMemory: (id: string) => json<void>(`/api/memories/${encodeURIComponent(id)}`, "DELETE"),
  weights: (w: Weights, label?: string) => json<Weights>("/api/weights", "PUT", { ...w, label }),
  clock: (advance_ms: number) => json<ClockResult>("/api/clock", "POST", { advance_ms }),
  retrieve: (query: string, weights?: Weights, expand = true) =>
    json<{ query: string; candidates: Candidate[] }>("/api/retrieve", "POST", { query, weights, expand }),
  classify: (text: string, predictor?: "rules" | "ml" | "llm") => json<Classification>("/api/classify", "POST", { text, predictor }),
  classifierEval: (predictor: "rules" | "ml") => request<ClassifierEval>(`/api/classifier/eval?predictor=${predictor}`),
  ingestSample: () => json<IngestResult>("/api/documents/sample", "POST"),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<IngestResult>("/api/documents", { method: "POST", body });
  },
};
