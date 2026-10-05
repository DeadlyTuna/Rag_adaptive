"""Learning from feedback — where the adaptation actually happens (not in the LLM).

Two things learn:
  1. The ranking weights w = (S, R, C, I) — a pairwise ranking update. When the user
     rejects item n and we prefer item p, the weights move towards the factors that
     would have ranked p above n:   w ← normalise(w + η·clip(f_p − f_n))
  2. Per-source reliability — lowered ×0.85 when a source is rejected, raised +0.03
     when an answer citing it is marked helpful. Reliability feeds the C factor.

Port of frontend/lib/engine/learn.ts.
"""

from __future__ import annotations

from .schemas import FACTORS, Candidate, Weights
from .util import r3 as _r3

ETA = 0.08
FLOOR = 0.02
MAX_STEP = 0.05  # no single piece of feedback moves a weight by more than this


def _clip(x: float) -> float:
    return max(-MAX_STEP, min(MAX_STEP, x))


def normalise(w: Weights) -> Weights:
    c = {f: max(FLOOR, w.get(f)) for f in FACTORS}
    total = sum(c.values())
    c = {f: _r3(c[f] / total) for f in FACTORS}
    # fix rounding drift on the largest weight so the four always sum to exactly 1
    drift = 1 - sum(c.values())
    big = FACTORS[0]
    for f in FACTORS[1:]:
        if c[f] > c[big]:
            big = f
    c[big] = _r3(c[big] + drift)
    return Weights(**c)


def pairwise_update(w: Weights, preferred: Candidate, rejected: Candidate, eta: float = ETA) -> Weights:
    """The rejected item should have scored lower than the preferred one."""
    nxt = {f: w.get(f) + _clip(eta * (preferred.factors.get(f) - rejected.factors.get(f))) for f in FACTORS}
    return normalise(Weights(**nxt))


def reinforce_update(w: Weights, cited: Candidate, others: list[Candidate], eta: float = ETA / 2) -> Weights:
    """Helpful answer: lean towards the signals that put the cited item on top."""
    if not others:
        return w
    nxt = {}
    for f in FACTORS:
        mean = sum(o.factors.get(f) for o in others) / len(others)
        nxt[f] = w.get(f) + _clip(eta * (cited.factors.get(f) - mean))
    return normalise(Weights(**nxt))


def deltas(a: Weights, b: Weights) -> Weights:
    return Weights(**{f: _r3(b.get(f) - a.get(f)) for f in FACTORS})


def lower_reliability(r: float) -> float:
    return max(0.2, _r3(r * 0.85))


def raise_reliability(r: float) -> float:
    return min(1.0, _r3(r + 0.03))


def outdated_reliability(r: float) -> float:
    return max(0.2, _r3(r * 0.8))


def score_of(f: Weights, w: Weights) -> float:
    return w.S * f.S + w.R * f.R + w.C * f.C + w.I * f.I
