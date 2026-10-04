// 2-D projection of the embedding space for the terrain.
// Classical MDS on cosine distance for the seed corpus; new items are placed
// near their nearest neighbours (out-of-sample), then nudged apart.

import { cosine, embed } from "./embed";

export const EXTENT: [number, number] = [1.45, 0.8]; // half-width, half-height of the map

export interface Placeable {
  id: string;
  text: string;
}

function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function mds(items: Placeable[]): Record<string, [number, number]> {
  const n = items.length;
  const vecs = items.map((it) => embed(it.text));
  const D2: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = Math.max(0, 1 - cosine(vecs[i], vecs[j]));
      D2[i][j] = D2[j][i] = d * d;
    }
  // double centring
  const rowMean = D2.map((r) => r.reduce((a, b) => a + b, 0) / n);
  const total = rowMean.reduce((a, b) => a + b, 0) / n;
  const B = D2.map((r, i) => r.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + total)));

  const eig: { vec: number[]; val: number }[] = [];
  const M = B.map((r) => r.slice());
  for (let k = 0; k < 2; k++) {
    let v = Array.from({ length: n }, (_, i) => hash01(items[i].id, k + 1) - 0.5);
    let val = 0;
    for (let it = 0; it < 200; it++) {
      const w = M.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
      const norm = Math.hypot(...w) || 1;
      v = w.map((x) => x / norm);
      val = norm;
    }
    eig.push({ vec: v, val });
    // deflate
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i][j] -= val * v[i] * v[j];
  }

  let pts = items.map((_, i) => [eig[0].vec[i] * Math.sqrt(eig[0].val), eig[1].vec[i] * Math.sqrt(eig[1].val)] as [number, number]);
  pts = fit(pts);
  pts = equalise(pts, 0.6);
  pts = relax(pts, 0.21, 160);

  const out: Record<string, [number, number]> = {};
  items.forEach((it, i) => (out[it.id] = pts[i]));
  return out;
}

function fit(pts: [number, number][]): [number, number][] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = (EXTENT[0] * 0.86) / ((maxX - minX) / 2 || 1);
  const sy = (EXTENT[1] * 0.82) / ((maxY - minY) / 2 || 1);
  return pts.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy]);
}

/**
 * MDS of sparse text vectors bunches most items together with a few far outliers.
 * Blend each axis with its rank (empirical CDF) so the map uses its whole area
 * while keeping every item's neighbours in order.
 */
function equalise(pts: [number, number][], amount: number): [number, number][] {
  const n = pts.length;
  const out = pts.map((p) => [p[0], p[1]] as [number, number]);
  for (const axis of [0, 1] as const) {
    const ext = EXTENT[axis] * (axis === 0 ? 0.86 : 0.8);
    const order = pts.map((p, i) => ({ v: p[axis], i })).sort((a, b) => a.v - b.v);
    order.forEach(({ i }, rank) => {
      const q = -ext + (2 * ext * (rank + 0.5)) / n;
      out[i][axis] = pts[i][axis] * (1 - amount) + q * amount;
    });
  }
  return out;
}

function clamp(p: [number, number]): [number, number] {
  return [Math.max(-EXTENT[0] * 0.92, Math.min(EXTENT[0] * 0.92, p[0])), Math.max(-EXTENT[1] * 0.88, Math.min(EXTENT[1] * 0.88, p[1]))];
}

/** Push points apart until no pair is closer than `min`. */
export function relax(pts: [number, number][], min: number, iters: number, fixed?: Set<number>): [number, number][] {
  const p = pts.map((x) => [x[0], x[1]] as [number, number]);
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j][0] - p[i][0];
        const dy = p[j][1] - p[i][1];
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d < min) {
          const push = (min - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          const fi = fixed?.has(i);
          const fj = fixed?.has(j);
          if (!fi) p[i] = clamp([p[i][0] - ux * push * (fj ? 2 : 1), p[i][1] - uy * push * (fj ? 2 : 1)]);
          if (!fj) p[j] = clamp([p[j][0] + ux * push * (fi ? 2 : 1), p[j][1] + uy * push * (fi ? 2 : 1)]);
          moved = true;
        }
      }
    if (!moved) break;
  }
  return p;
}

/**
 * Place a new item: near the item it replaces (if any), otherwise at the
 * similarity-weighted centroid of its nearest neighbours.
 */
export function place(
  item: Placeable,
  positions: Record<string, [number, number]>,
  neighbours: Placeable[],
  near?: string,
): [number, number] {
  const angle = hash01(item.id, 3) * Math.PI * 2;
  let base: [number, number];
  let radius: number;

  if (near && positions[near]) {
    base = positions[near];
    radius = 0.21;
  } else {
    const v = embed(item.text);
    const scored = neighbours
      .filter((nb) => positions[nb.id] && nb.id !== item.id)
      .map((nb) => ({ nb, s: Math.max(0, cosine(v, embed(nb.text))) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .filter((x) => x.s > 0.05);
    if (scored.length) {
      let wx = 0;
      let wy = 0;
      let ws = 0;
      for (const { nb, s } of scored) {
        const w = s * s;
        wx += positions[nb.id][0] * w;
        wy += positions[nb.id][1] * w;
        ws += w;
      }
      base = [wx / ws, wy / ws];
      radius = 0.12;
    } else {
      // nothing similar: the emptiest spot on a coarse grid
      let best: [number, number] = [0, 0];
      let bestD = -1;
      const all = Object.values(positions);
      for (let gx = -6; gx <= 6; gx++)
        for (let gy = -4; gy <= 4; gy++) {
          const c: [number, number] = [(gx / 6) * EXTENT[0] * 0.85, (gy / 4) * EXTENT[1] * 0.8];
          const d = Math.min(...all.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
          if (d > bestD) {
            bestD = d;
            best = c;
          }
        }
      base = best;
      radius = 0;
    }
  }

  const start = clamp([base[0] + Math.cos(angle) * radius, base[1] + Math.sin(angle) * radius]);
  // nudge only the new point away from crowding
  const others = Object.entries(positions).filter(([id]) => id !== item.id && id !== near).map(([, p]) => p);
  const pts = [...others, start];
  const fixed = new Set(others.map((_, i) => i));
  const relaxed = relax(pts, 0.13, 40, fixed);
  return relaxed[relaxed.length - 1];
}
