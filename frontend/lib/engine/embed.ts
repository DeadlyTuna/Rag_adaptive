// Hashed bag-of-words embeddings (384 dims — the width of all-MiniLM-L6-v2, which the
// real backend uses). Deterministic, dependency-free, good enough to show retrieval.

import { TOKEN_WEIGHT, tokens } from "./text";

export const DIMS = 384;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const cache = new Map<string, Float32Array>();

export function embed(text: string): Float32Array {
  const hit = cache.get(text);
  if (hit) return hit;

  const toks = tokens(text);
  const counts = new Map<string, number>();
  const add = (feature: string, w: number) => counts.set(feature, (counts.get(feature) ?? 0) + w);

  // numbers only carry meaning next to words ("80%" in an attendance rule, not "2+2")
  const hasWords = toks.some((t) => !t.startsWith("#"));
  toks.forEach((t, i) => {
    const isNum = t.startsWith("#");
    if (isNum && !hasWords) return;
    add(t, isNum ? 0.3 : (TOKEN_WEIGHT[t] ?? 1));
    if (i > 0 && !isNum && !toks[i - 1].startsWith("#")) add(toks[i - 1] + "_" + t, 0.5);
  });

  const v = new Float32Array(DIMS);
  for (const [feature, tf] of counts) {
    const h = fnv1a(feature);
    const sign = (h >>> 31) & 1 ? -1 : 1;
    v[h % DIMS] += sign * (tf <= 1 ? tf : 1 + Math.log(tf)); // sublinear term frequency
  }
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIMS; i++) v[i] /= norm;

  if (cache.size > 2000) cache.clear();
  cache.set(text, v);
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Similarity on a 0–1 scale, calibrated so a strong topical match reads ~0.8 and
 *  incidental word overlap stays near zero. */
export function similarity(a: string, b: string): number {
  const c = cosine(embed(a), embed(b));
  const x = Math.max(0, (c - 0.05) / 0.75);
  return Math.round(Math.min(1, Math.pow(x, 0.8)) * 1000) / 1000;
}

// ---- fingerprint: a dense 32-value strip for showing a vector -------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let projection: Float32Array[] | null = null;
function getProjection(n: number) {
  if (projection && projection.length === n) return projection;
  const rnd = mulberry32(7);
  projection = Array.from({ length: n }, () => {
    const row = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) row[i] = rnd() * 2 - 1;
    return row;
  });
  return projection;
}

/** Random projection of the embedding into `n` values in [-1, 1]. */
export function fingerprint(text: string, n = 32): number[] {
  const v = embed(text);
  const rows = getProjection(n);
  const out = rows.map((r) => cosine(r, v));
  const max = Math.max(...out.map(Math.abs)) || 1;
  return out.map((x) => x / max);
}
