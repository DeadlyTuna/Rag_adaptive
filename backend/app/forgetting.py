"""Forgetting: memory strength decays with time since last use (Ebbinghaus-style).

    strength(t) = importance × confidence × exp(−(t − last_use) / τ)
    τ = base_τ(class) × 1.2^uses      (each use stretches the half-life: spacing effect)

Pinned memories don't decay; temporary memories expire at `expires_at`.
Port of frontend/lib/engine/forget.ts.
"""

from __future__ import annotations

import math

from .schemas import Memory

HOUR = 3_600_000
DAY = 24 * HOUR

BASE_TAU = {
    "persistent": 60 * DAY,
    "important": 45 * DAY,
    "correction": 90 * DAY,
    "temporary": 1.2 * DAY,
}

FORGET_THRESHOLD = 0.15


def tau(m: Memory, uses_so_far: int | None = None, base: dict[str, float] | None = None) -> float:
    """`base` overrides the hand-set τ per class (learned ones, novelty 5)."""
    n = len(m.uses) if uses_so_far is None else uses_so_far
    return (base or BASE_TAU).get(m.cls, BASE_TAU[m.cls]) * (1.2 ** min(n, 8))


def strength_at(m: Memory, t: int, base: dict[str, float] | None = None) -> float:
    """Strength in [0, 1] at time t (ignores status — callers decide what outdated means)."""
    if t < m.created_at:
        return 0.0
    if m.expires_at and t >= m.expires_at and not m.pinned:
        return 0.0
    uses = [u for u in m.uses if u <= t]
    last = max([m.created_at, *uses])
    start = m.importance * m.confidence
    if m.pinned:
        return start
    return start * math.exp(-(t - last) / tau(m, len(uses), base))
