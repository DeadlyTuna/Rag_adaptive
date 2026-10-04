// Forgetting: memory strength decays with time since last use (Ebbinghaus-style),
// each use stretches the decay constant (spacing effect), temporary memories expire.

import type { Memory } from "./types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const BASE_TAU: Record<Memory["cls"], number> = {
  persistent: 60 * DAY,
  important: 45 * DAY,
  correction: 90 * DAY,
  temporary: 1.2 * DAY,
};

export const FORGET_THRESHOLD = 0.15;

export function tau(m: Memory, usesSoFar = m.uses.length): number {
  return BASE_TAU[m.cls] * Math.pow(1.2, Math.min(usesSoFar, 8));
}

/** Strength in [0,1] at time t (ignores status — callers decide what outdated means). */
export function strengthAt(m: Memory, t: number): number {
  if (t < m.createdAt) return 0;
  if (m.expiresAt && t >= m.expiresAt && !m.pinned) return 0;
  const uses = m.uses.filter((u) => u <= t);
  const last = Math.max(m.createdAt, ...uses);
  const base = m.importance * m.confidence;
  if (m.pinned) return base;
  return base * Math.exp(-(t - last) / tau(m, uses.length));
}

/** Status as of time t, for the "as of" scrubber. */
export function statusAt(m: Memory, t: number): Memory["status"] | "future" {
  if (t < m.createdAt) return "future";
  if (m.supersededAt && t >= m.supersededAt) return "outdated";
  if (m.status === "outdated" && !m.supersededAt) return "outdated";
  if (m.expiredAt && t >= m.expiredAt) return "expired";
  if (m.status === "expired" && !m.expiredAt) return "expired";
  return "current";
}

/** Sampled forgetting curve: strength from creation to `until`. */
export function forgettingCurve(m: Memory, until: number, samples = 120): { t: number; s: number }[] {
  const start = m.createdAt;
  const span = Math.max(until - start, HOUR);
  const pts: { t: number; s: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = start + (span * i) / samples;
    pts.push({ t, s: strengthAt(m, t) });
  }
  // make the rehearsal bumps crisp: add points just before/after each use
  for (const u of m.uses) {
    if (u > start && u < until) {
      pts.push({ t: u - 1, s: strengthAt({ ...m, uses: m.uses.filter((x) => x < u) }, u - 1) });
      pts.push({ t: u, s: strengthAt(m, u) });
    }
  }
  return pts.sort((a, b) => a.t - b.t);
}
