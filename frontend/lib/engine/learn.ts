// Learning from feedback — where the adaptation actually happens.
// Pairwise ranking update on the four weights + per-source reliability.

import type { Candidate, Weights } from "./types";
import { FACTORS } from "./types";

export const ETA = 0.08;
const FLOOR = 0.02;
const MAX_STEP = 0.05; // no single piece of feedback moves a weight by more than this

const clip = (x: number) => Math.max(-MAX_STEP, Math.min(MAX_STEP, x));

export function normalise(w: Weights): Weights {
  const c = { ...w };
  for (const f of FACTORS) c[f] = Math.max(FLOOR, c[f]);
  const sum = FACTORS.reduce((s, f) => s + c[f], 0);
  for (const f of FACTORS) c[f] = Math.round((c[f] / sum) * 1000) / 1000;
  // fix rounding drift on the largest weight so the four always sum to exactly 1
  const drift = 1 - FACTORS.reduce((s, f) => s + c[f], 0);
  const big = FACTORS.reduce((a, b) => (c[b] > c[a] ? b : a));
  c[big] = Math.round((c[big] + drift) * 1000) / 1000;
  return c;
}

/** The rejected item should have scored lower than the preferred one: w ← w + η(f_p − f_n). */
export function pairwiseUpdate(w: Weights, preferred: Candidate, rejected: Candidate, eta = ETA): Weights {
  const next = { ...w };
  for (const f of FACTORS) next[f] = w[f] + clip(eta * (preferred.factors[f] - rejected.factors[f]));
  return normalise(next);
}

/** Helpful answer: lean towards the signals that put the cited item on top. */
export function reinforceUpdate(w: Weights, cited: Candidate, others: Candidate[], eta = ETA / 2): Weights {
  if (!others.length) return w;
  const next = { ...w };
  for (const f of FACTORS) {
    const mean = others.reduce((s, o) => s + o.factors[f], 0) / others.length;
    next[f] = w[f] + clip(eta * (cited.factors[f] - mean));
  }
  return normalise(next);
}

export function deltas(from: Weights, to: Weights): Weights {
  return {
    S: Math.round((to.S - from.S) * 1000) / 1000,
    R: Math.round((to.R - from.R) * 1000) / 1000,
    C: Math.round((to.C - from.C) * 1000) / 1000,
    I: Math.round((to.I - from.I) * 1000) / 1000,
  };
}

export function lowerReliability(r: number) {
  return Math.max(0.2, Math.round(r * 0.85 * 1000) / 1000);
}
export function raiseReliability(r: number) {
  return Math.min(1, Math.round((r + 0.03) * 1000) / 1000);
}
