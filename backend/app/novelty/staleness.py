"""Novelty 10 — a staleness map: how out of date is each part of what the system knows?

Every passage and memory gets a staleness score in [0, 1] (0 fresh, 1 stale), which the
memory page paints over the knowledge terrain so you can *see* the stale regions.

  passage   1 − (1 − 0.35·age) · (1 − reliability loss) · (0.25 if a correction overrides it)
              age            years since publication, capped at 2  (→ 0..1)
              reliability loss  (1 − reliability) / 0.8  (reliability floor is 0.2)
  memory    current: 1 − strength / (importance × confidence) — how far it has decayed
            pending: 0.5 (not verified yet) · outdated / expired / archived: 1

The same formula runs in the browser (frontend/lib/engine/staleness.ts) so the terrain
works in the demo mode as well.
"""

from __future__ import annotations

from typing import Optional

from ..forgetting import DAY, strength_at
from ..schemas import World

AGE_SPAN = 2 * 365 * DAY


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def chunk_staleness(age_ms: float, reliability: float, overridden: bool) -> float:
    age = _clamp(age_ms / AGE_SPAN)
    loss = _clamp((1 - reliability) / 0.8)
    return round(1 - (1 - 0.35 * age) * (1 - loss) * (0.25 if overridden else 1), 3)


def staleness_map(world: World, now: int, taus: Optional[dict[str, float]] = None) -> list[dict]:
    out: list[dict] = []
    for c in world.chunks:
        overridden = bool(world.overrides(c))
        s = chunk_staleness(now - c.published_at, c.reliability, overridden)
        reasons = []
        if overridden:
            reasons.append("a correction overrides its claim")
        if c.reliability < 1:
            reasons.append(f"reliability {c.reliability:.2f}")
        reasons.append(f"published {round((now - c.published_at) / DAY)} days ago")
        out.append({"id": c.id, "kind": "document", "staleness": s, "reasons": reasons})
    for m in world.memories:
        if not world.visible(m):
            continue
        if m.status == "current":
            base = m.importance * m.confidence
            s = 0.0 if m.pinned or base <= 0 else round(_clamp(1 - strength_at(m, now, taus) / base), 3)
            reasons = ["pinned"] if m.pinned else [f"strength {strength_at(m, now, taus):.2f} of {base:.2f}"]
        elif m.status == "pending":
            s, reasons = 0.5, ["waiting for verification"]
        else:
            s, reasons = 1.0, [m.status]
        out.append({"id": m.id, "kind": "memory", "staleness": s, "reasons": reasons})
    return out
