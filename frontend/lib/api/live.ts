// HTTP client for the real FastAPI backend (DESIGN_PLAN.md §8).
// Used when NEXT_PUBLIC_API_URL is set; otherwise the in-browser demo engine runs.

import type { Classification, Feedback, MemoryOp, Retrieval, Turn, Weights, World } from "../engine/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
export const LIVE = API_URL.length > 0;

export type ChatEvent =
  | { type: "user"; turn: Turn }
  | { type: "stage"; stage: "classifying" | "remembering" | "retrieving" | "generating" }
  | { type: "classification"; turn_id: string; classification: Classification }
  | { type: "memory_ops"; turn_id: string; ops: MemoryOp[] }
  | { type: "retrieval"; turn_id: string; retrieval: Retrieval }
  | { type: "token"; turn_id: string; text: string }
  | { type: "done"; turn: Turn }
  | { type: "error"; message: string };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed with ${res.status}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** POST /api/chat → Server-Sent Events, one JSON `ChatEvent` per `data:` line. */
export async function streamChat(message: string, sessionId: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, session_id: sessionId }),
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
  state: () => json<World>("/api/state"),
  feedback: (body: { turn_id: string; verdict: Feedback["verdict"]; reason?: Feedback["reason"]; target_id?: string }) =>
    json<{ weights: Weights; feedback: Feedback }>("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
  patchMemory: (id: string, body: { pinned?: boolean; status?: "outdated" }) =>
    json(`/api/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMemory: (id: string) => json(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  weights: (w: Weights) => json<Weights>("/api/weights", { method: "PUT", body: JSON.stringify(w) }),
  clock: (advance_ms: number) => json("/api/clock", { method: "POST", body: JSON.stringify({ advance_ms }) }),
  upload: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${API_URL}/api/documents`, { method: "POST", body });
    if (!res.ok) throw new Error(`POST /api/documents failed with ${res.status}`);
    return res.json();
  },
};
