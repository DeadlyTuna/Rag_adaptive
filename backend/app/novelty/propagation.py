"""Novelty 9 — trust propagates to similar passages.

Feedback changes the reliability of one passage. But passages that are about the same
thing (neighbours in embedding space — the sibling sections of the same chapter, or
another copy of the same rule) are probably right or wrong together: rules go out of date
an edition at a time. So part of every reliability change spreads to the passage's
nearest neighbours:

    Δr_neighbour = β · similarity · Δr_target

for up to TOP_N neighbours that are in the same document with similarity ≥ SAME_DOC_SIM,
or anywhere with similarity ≥ MIN_SIM.

β = 0.5 for "outdated" (an old rule makes its neighbours suspect too), 0.3 otherwise.
Reliability stays within [0.2, 1]. Only document passages propagate, and only to
passages: a memory's reliability is about that one statement.
"""

from __future__ import annotations

from typing import Callable

from ..schemas import ReliabilityChange, World
from ..util import r3

BETA = {"outdated": 0.5, "wrong_source": 0.3, "helpful": 0.3}
SAME_DOC_SIM = 0.3
MIN_SIM = 0.6
TOP_N = 3


def propagate(
    world: World,
    change: ReliabilityChange,
    reason: str,
    neighbours: Callable[[str, int], list[tuple[str, float]]],
) -> list[ReliabilityChange]:
    target = world.chunk(change.id)
    if not target:
        return []
    delta = change.to - change.from_
    if abs(delta) < 1e-9:
        return []
    beta = BETA.get(reason, 0.3)
    out: list[ReliabilityChange] = []
    for nid, sim in neighbours(change.id, TOP_N * 3):
        c = world.chunk(nid)
        if not c or nid == change.id or len(out) >= TOP_N:
            continue
        if sim < (SAME_DOC_SIM if c.doc_id == target.doc_id else MIN_SIM):
            continue
        frm = c.reliability
        to = r3(max(0.2, min(1.0, frm + beta * sim * delta)))
        if to != frm:
            c.reliability = to
            out.append(ReliabilityChange(id=nid, from_=frm, to=to))
    return out
