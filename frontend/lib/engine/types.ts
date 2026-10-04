// Domain model shared by the in-browser demo engine and the HTTP client.
// Mirrors the FastAPI contract in DESIGN_PLAN.md §7–8.

export type MemoryClass = "persistent" | "important" | "correction" | "temporary" | "irrelevant";
export type MemoryStatus = "current" | "outdated" | "expired";
export type MemoryKind = "fact" | "preference" | "profile" | "event";
export type SourceKind = "document" | "memory";
export type Factor = "S" | "R" | "C" | "I";

export const CLASSES: MemoryClass[] = ["persistent", "important", "correction", "temporary", "irrelevant"];
export const FACTORS: Factor[] = ["S", "R", "C", "I"];

export interface Weights {
  S: number;
  R: number;
  C: number;
  I: number;
}

export interface Claim {
  slot: string;
  value: string;
  scope?: string;
}

export interface DocumentMeta {
  id: string;
  title: string;
  issuer: string;
  publishedAt: number;
  indexedAt: number;
  chunkIds: string[];
  sample?: boolean;
}

export interface Chunk {
  id: string;
  docId: string;
  section: string;
  title: string;
  text: string;
  tokens: number;
  importance: number;
  reliability: number;
  publishedAt: number;
  indexedAt: number;
  claims: Claim[];
  /** slot → memory id that overrides this chunk's claim */
  overriddenBy?: Record<string, string>;
}

export interface Memory {
  id: string;
  slot: string | null;
  label: string; // short human label for the slot, e.g. "Minimum attendance"
  text: string; // the knowledge line, e.g. "Minimum attendance = 80% (CSE)"
  value?: string;
  scope?: string;
  cls: Exclude<MemoryClass, "irrelevant">;
  kind: MemoryKind;
  source: { type: "user" | "document"; label: string; ref?: string };
  utterance?: string; // what the user actually said
  confidence: number;
  importance: number;
  reliability: number;
  status: MemoryStatus;
  pinned: boolean;
  createdAt: number;
  lastUsedAt: number;
  uses: number[];
  expiresAt?: number;
  expiredAt?: number;
  supersedes?: string; // memory id or "chunk:<id>"
  supersededBy?: string;
  supersededAt?: number;
  previousValue?: string;
  confirmedBy?: string; // chunk id
}

export type SpanKind = "value" | "topic" | "time" | "cue" | "entity";
export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
  text: string;
}

export interface Conflict {
  withId: string; // memory id or chunk id
  withKind: SourceKind;
  withText: string;
  withValue: string;
  withSource: string;
}

export type Decision =
  | "store"
  | "replace"
  | "reinforce"
  | "keep-temporarily"
  | "discard"
  | "flag-previous"
  | "question";

export interface Classification {
  label: MemoryClass;
  probs: Record<MemoryClass, number>;
  spans: Span[];
  isQuestion: boolean;
  slot?: string;
  slotLabel?: string;
  value?: string;
  scope?: string;
  coref?: string; // e.g. "“it” → minimum attendance (from your previous question)"
  conflict?: Conflict;
  decision: Decision;
  reason: string;
}

export interface Candidate {
  id: string;
  kind: SourceKind;
  title: string;
  subtitle: string;
  text: string;
  factors: Weights; // raw factor values 0..1
  score: number;
  rank: number;
  status?: MemoryStatus;
  cls?: Memory["cls"];
  excluded?: string; // reason it was filtered out
  note?: string; // e.g. "Overridden for minimum attendance → 80%"
}

export interface Retrieval {
  query: string;
  candidates: Candidate[];
  excluded: Candidate[];
  weights: Weights;
  searched: { chunks: number; memories: number };
  pool: number; // candidates that passed the similarity stage
  preferences: { id: string; text: string }[]; // standing context, always applied
  ping: [number, number];
}

export type MemoryOpKind = "add" | "replace" | "reinforce" | "expire" | "flag" | "confirm" | "discard";
export interface MemoryOp {
  kind: MemoryOpKind;
  memoryId?: string;
  previousId?: string;
  title: string;
  detail?: string;
  subject?: string; // e.g. the source whose trust was lowered
}

export interface Citation {
  n: number;
  itemId: string;
}

export interface Feedback {
  verdict: "helpful" | "not_helpful";
  reason?: "wrong_source" | "outdated" | "incomplete";
  targetId?: string;
  deltas?: Weights;
  reliability?: { id: string; from: number; to: number };
  at: number;
}

export type TurnStatus = "classifying" | "retrieving" | "streaming" | "done" | "error";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  // user
  classification?: Classification;
  memoryOps?: MemoryOp[];
  // assistant
  replyTo?: string;
  retrieval?: Retrieval;
  citations?: Citation[];
  intent?: string;
  status?: TurnStatus;
  feedback?: Feedback;
  error?: string;
}

export type EventType =
  | "memory.added"
  | "memory.preference"
  | "memory.replaced"
  | "memory.expired"
  | "memory.reinforced"
  | "memory.flagged"
  | "memory.pinned"
  | "memory.deleted"
  | "memory.outdated"
  | "memory.confirmed"
  | "weights.updated"
  | "document.indexed"
  | "document.conflict";

export interface ActivityEvent {
  id: string;
  type: EventType;
  at: number;
  title: string;
  detail: string;
  refId?: string;
}

export interface WeightPoint {
  at: number;
  weights: Weights;
  label: string;
}

export interface World {
  version: number;
  seededAt: number;
  documents: DocumentMeta[];
  chunks: Chunk[];
  memories: Memory[];
  turns: Turn[];
  events: ActivityEvent[];
  queries: number[];
  weights: Weights;
  weightHistory: WeightPoint[];
  positions: Record<string, [number, number]>;
  scriptDone: string[];
}
