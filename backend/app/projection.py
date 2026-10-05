"""2-D map of the embedding space (the frontend's "knowledge terrain").

Classical MDS on cosine distance places every passage and memory so that similar
things sit close together. New items are placed out-of-sample: next to the item they
replace, or at the similarity-weighted centre of their nearest neighbours, then nudged
apart. Coordinates live in the frontend's map extent: x ∈ [−1.45, 1.45], y ∈ [−0.8, 0.8].

Port of frontend/lib/engine/project.ts (with numpy's eigh instead of power iteration).
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np

EXTENT = (1.45, 0.8)  # half-width, half-height of the map


def hash01(s: str, salt: int = 0) -> float:
    h = (2166136261 ^ salt) & 0xFFFFFFFF
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return (h % 100000) / 100000


def _clamp(p: np.ndarray) -> np.ndarray:
    return np.array(
        [
            max(-EXTENT[0] * 0.92, min(EXTENT[0] * 0.92, float(p[0]))),
            max(-EXTENT[1] * 0.88, min(EXTENT[1] * 0.88, float(p[1]))),
        ]
    )


def _clamp_all(p: np.ndarray) -> np.ndarray:
    p[:, 0] = np.clip(p[:, 0], -EXTENT[0] * 0.92, EXTENT[0] * 0.92)
    p[:, 1] = np.clip(p[:, 1], -EXTENT[1] * 0.88, EXTENT[1] * 0.88)
    return p


def _fit(pts: np.ndarray) -> np.ndarray:
    mn, mx = pts.min(axis=0), pts.max(axis=0)
    c = (mn + mx) / 2
    half = (mx - mn) / 2
    half[half == 0] = 1
    s = np.array([EXTENT[0] * 0.86, EXTENT[1] * 0.82]) / half
    return (pts - c) * s


def _equalise(pts: np.ndarray, amount: float) -> np.ndarray:
    """Blend each axis with its rank so the map uses its whole area while keeping
    every item's neighbours in order (MDS bunches most items with a few outliers)."""
    n = len(pts)
    out = pts.copy()
    for axis in (0, 1):
        ext = EXTENT[axis] * (0.86 if axis == 0 else 0.8)
        order = np.argsort(pts[:, axis], kind="stable")
        q = -ext + 2 * ext * (np.arange(n) + 0.5) / n
        out[order, axis] = pts[order, axis] * (1 - amount) + q * amount
    return out


def relax(pts: np.ndarray, min_d: float, iters: int, fixed: Optional[np.ndarray] = None) -> np.ndarray:
    """Push points apart until no pair is closer than `min_d` (vectorised)."""
    p = pts.astype(np.float64).copy()
    n = len(p)
    if n < 2:
        return p
    movable = np.ones(n, dtype=bool) if fixed is None else ~fixed
    for _ in range(iters):
        d = p[None, :, :] - p[:, None, :]  # d[i, j] = p[j] − p[i]
        dist = np.sqrt((d**2).sum(-1))
        np.fill_diagonal(dist, np.inf)
        close = dist < min_d
        if not close.any():
            break
        dist_safe = np.where(dist == 0, 1e-6, dist)
        push = np.where(close, (min_d - dist_safe) / 2, 0.0)
        u = d / dist_safe[..., None]
        # a fixed neighbour doesn't move, so the movable one moves twice as far
        factor = np.where(movable[None, :], 1.0, 2.0)
        delta = -(u * (push * factor)[..., None]).sum(axis=1)
        p[movable] += delta[movable]
        p = _clamp_all(p)
    return p


def mds(ids: list[str], vectors: np.ndarray) -> dict[str, tuple[float, float]]:
    n = len(ids)
    if n == 0:
        return {}
    if n < 3:
        return {i: (round(-0.5 + k * 1.0, 4), 0.0) for k, i in enumerate(ids)}
    v = vectors.astype(np.float64)
    cos = np.clip(v @ v.T, -1, 1)
    d2 = np.maximum(0.0, 1 - cos) ** 2
    j = np.eye(n) - np.ones((n, n)) / n
    b = -0.5 * j @ d2 @ j
    vals, vecs = np.linalg.eigh(b)
    top = np.argsort(vals)[::-1][:2]
    pts = vecs[:, top] * np.sqrt(np.maximum(vals[top], 1e-9))
    # eigenvector signs are arbitrary: fix them so the map doesn't flip between runs
    for k in range(2):
        if pts[np.argmax(np.abs(pts[:, k])), k] < 0:
            pts[:, k] *= -1
    pts = _fit(pts)
    pts = _equalise(pts, 0.6)
    pts = relax(pts, 0.21, 160)
    return {i: (round(float(x), 4), round(float(y), 4)) for i, (x, y) in zip(ids, pts)}


def place(
    item_id: str,
    vector: np.ndarray,
    positions: dict[str, tuple[float, float]],
    neighbours: dict[str, np.ndarray],
    near: Optional[str] = None,
) -> tuple[float, float]:
    """Place a new item next to what it replaces, or among its nearest neighbours."""
    angle = hash01(item_id, 3) * math.pi * 2
    if near and near in positions:
        base = np.array(positions[near], dtype=np.float64)
        radius = 0.21
    else:
        scored = []
        for nid, nv in neighbours.items():
            if nid == item_id or nid not in positions:
                continue
            s = max(0.0, float(np.dot(vector.astype(np.float64), nv.astype(np.float64))))
            scored.append((s, nid))
        scored.sort(reverse=True)
        scored = [x for x in scored[:3] if x[0] > 0.05]
        if scored:
            w = np.array([s * s for s, _ in scored])
            xy = np.array([positions[nid] for _, nid in scored])
            base = (xy * w[:, None]).sum(0) / w.sum()
            radius = 0.12
        else:
            # nothing similar: the emptiest spot on a coarse grid
            all_pts = np.array(list(positions.values())) if positions else np.zeros((1, 2))
            best, best_d = np.zeros(2), -1.0
            for gx in range(-6, 7):
                for gy in range(-4, 5):
                    c = np.array([(gx / 6) * EXTENT[0] * 0.85, (gy / 4) * EXTENT[1] * 0.8])
                    d = float(np.min(np.hypot(all_pts[:, 0] - c[0], all_pts[:, 1] - c[1])))
                    if d > best_d:
                        best_d, best = d, c
            base, radius = best, 0.0
    start = _clamp(base + radius * np.array([math.cos(angle), math.sin(angle)]))
    others = [np.array(p) for pid, p in positions.items() if pid not in (item_id, near)]
    pts = np.vstack([*others, start]) if others else start[None, :]
    fixed = np.array([True] * len(others) + [False])
    relaxed = relax(pts, 0.13, 40, fixed)
    x, y = relaxed[-1]
    return (round(float(x), 4), round(float(y), 4))
