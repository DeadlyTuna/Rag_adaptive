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
  Reminder,
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

/** GET /api/turns/{id}/counterfactual — the same question answered with parts of the learning removed. */
export interface Counterfactual {
  question: string;
  turnId: string;
  recorded: { text: string; model?: string; intent?: string };
  variants: Record<
    "adaptive" | "no_memory" | "no_feedback" | "plain",
    {
      label: string;
      text: string;
      intent: string;
      sameAsAdaptive: boolean;
      citations: { n: number; itemId: string; title: string; kind: "document" | "memory" }[];
      top: { id: string; title: string; kind: "document" | "memory"; score: number }[];
      weights: Weights;
    }
  >;
  memoriesUsed: { n: number; itemId: string; title: string }[];
  lowerReliability: { id: string; reliability: number }[];
}

type Cell = { correct: number; total: number; rate: number };
export interface BenchmarkSummary {
  embedder: string;
  seconds: number;
  main: Record<string, Record<string, Cell>>;
  ablations: Record<string, Record<string, Cell>>;
  calibration?: { answers: number; meanConfidenceRight: number | null; meanConfidenceWrong: number | null; auroc: number | null };
  experiments?: {
    ranking: Record<string, { mrr: number; "hit@1": number } | string>;
    forgetting: {
      trueMeanGapDays: Record<string, number>;
      handSetTauDays: Record<string, number>;
      learnedTauDays: Record<string, number>;
      heldoutLogLik: Record<string, number>;
      _about: string;
    };
    consolidation: Record<string, { currentMemoriesBefore: number; currentMemoriesAfter: number; merged: number; copiesOfTheAnswerInTop5: number } | string>;
    propagation: { feedback: string; reliabilityChanged: Record<string, [number, number]> };
    counterfactual: { questions: number; answersThatChangeWithout: Record<string, number> };
    staleness: { overriddenPassages: number; lowReliabilityPassages: number; otherPassages: number; counts: number[] };
    reminders: { cases: { statement: string; saidAtHour: number; expected: number; scheduled: number; fired: number }[]; _about: string };
  };
}

/** GET /api/research — everything the Research page shows. */
export interface Research {
  novelties: string[];
  available: string[];
  globalWeights: Weights;
  intentWeights: Record<string, { label: string; feedback: number; groupShare: number; effective: Weights; own: Weights | null }>;
  shrinkageK: number;
  decay: Record<string, { tau: number; prior: number; events: number; exposure: number; memories: number }>;
  decayInUse: boolean;
  trust: Record<string, { name: string; department?: string; alpha: number; beta: number; mean: number }>;
  verification: { threshold: number; crowdK: number };
  pending: Memory[];
  reminders: Reminder[];
  staleness: { id: string; kind: "document" | "memory"; staleness: number; reasons: string[] }[];
  benchmark: BenchmarkSummary | null;
  now: number;
}

export interface Resolved {
  slot: string;
  value: string | null;
  source: { kind: "memory" | "document"; id: string; label: string; appliesTo?: string; validFrom: number } | null;
  memories: { id: string; value?: string; status: string; appliesTo?: string; validFrom: number; validTo?: number; learnedAt: number; visible: boolean }[];
  claims: { id: string; value: string; scope?: string; validFrom: number; label: string }[];
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
  ids: { sessionId: string; userTurnId: string; assistantTurnId: string; userId?: string | null },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      message,
      session_id: ids.sessionId,
      user_turn_id: ids.userTurnId,
      assistant_turn_id: ids.assistantTurnId,
      ...(ids.userId ? { user_id: ids.userId } : {}),
    }),
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

const userQuery = (user?: string | null) => (user ? `?user=${encodeURIComponent(user)}` : "");

export const live = {
  state: (user?: string | null) => request<ServerWorld>(`/api/state${userQuery(user)}`),
  health: () => request<Health>("/api/health"),
  reset: () => json<ServerWorld>("/api/reset", "POST"),
  feedback: (body: { turn_id: string; verdict: Feedback["verdict"]; reason?: Feedback["reason"]; target_id?: string }) =>
    json<FeedbackResult>("/api/feedback", "POST", body),
  patchMemory: (id: string, body: { pinned?: boolean; status?: "outdated" | "current" }) =>
    json<Memory>(`/api/memories/${encodeURIComponent(id)}`, "PATCH", body),
  deleteMemory: (id: string) => json<void>(`/api/memories/${encodeURIComponent(id)}`, "DELETE"),
  weights: (w: Weights, label?: string) => json<Weights>("/api/weights", "PUT", { ...w, label }),
  clock: (advance_ms: number) => json<ClockResult>("/api/clock", "POST", { advance_ms }),
  retrieve: (query: string, weights?: Weights, expand = true) =>
    json<{ query: string; candidates: Candidate[] }>("/api/retrieve", "POST", { query, weights, expand }),
  classify: (text: string, predictor?: "rules" | "ml" | "llm") => json<Classification>("/api/classify", "POST", { text, predictor }),
  classifierEval: (predictor: "rules" | "ml") => request<ClassifierEval>(`/api/classifier/eval?predictor=${predictor}`),
  ingestSample: () => json<IngestResult>("/api/documents/sample", "POST"),
  // research extensions
  research: (user?: string | null) => request<Research>(`/api/research${userQuery(user)}`),
  counterfactual: (turnId: string) => request<Counterfactual>(`/api/turns/${encodeURIComponent(turnId)}/counterfactual`),
  verify: (id: string, accept: boolean) =>
    json<{ memory: Memory; events: ActivityEvent[] }>(`/api/memories/${encodeURIComponent(id)}/verify`, "POST", { accept }),
  consolidate: () => json<{ events: ActivityEvent[]; memories: Memory[] }>("/api/memories/consolidate", "POST"),
  dismissReminder: (id: string) => json<Reminder>(`/api/reminders/${encodeURIComponent(id)}/dismiss`, "POST"),
  resolve: (slot: string, opts: { user?: string | null; scope?: string; asOf?: number } = {}) => {
    const q = new URLSearchParams({ slot });
    if (opts.user) q.set("user", opts.user);
    if (opts.scope) q.set("scope", opts.scope);
    if (opts.asOf !== undefined) q.set("as_of", String(Math.round(opts.asOf)));
    return request<Resolved>(`/api/research/resolve?${q}`);
  },
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<IngestResult>("/api/documents", { method: "POST", body });
  },
};
