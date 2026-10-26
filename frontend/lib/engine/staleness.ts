// How out of date each passage and memory is, 0 (fresh) … 1 (stale) — the terrain's
// "Staleness" view. Same formula as the backend (backend/app/novelty/staleness.py):
//   passage  1 − (1 − 0.35·age) · (1 − reliability loss) · (0.25 if a correction overrides it)
//            age = years since publication / 2 (capped at 1), loss = (1 − reliability) / 0.8
//   memory   current: how far its strength has decayed · pending: 0.5 · replaced/expired/archived: 1

import type { Chunk, Memory } from "./types";
import { DAY, statusAt, strengthAt } from "./forget";

const AGE_SPAN = 2 * 365 * DAY;
const clamp = (x: number) => Math.max(0, Math.min(1, x));

export function chunkStaleness(c: Chunk, t: number): number {
  const age = clamp((t - c.publishedAt) / AGE_SPAN);
  const loss = clamp((1 - c.reliability) / 0.8);
  const overridden = Object.keys(c.overriddenBy ?? {}).length > 0;
  return 1 - (1 - 0.35 * age) * (1 - loss) * (overridden ? 0.25 : 1);
}

export function memoryStaleness(m: Memory, t: number): number {
  const st = statusAt(m, t);
  if (st === "pending") return 0.5;
  if (st !== "current") return 1;
  const base = m.importance * m.confidence;
  if (m.pinned || base <= 0) return 0;
  return clamp(1 - strengthAt(m, t) / base);
}
