"""Novelty 8 — many students: private memories, crowd-verified shared facts.

Everything a student says about *themselves* (name, attendance, preferences, exams) is
private to them. A *world* fact one student tells us ("our department raised the
attendance requirement to 80%") starts private as well — it changes that student's
answers only. When CROWD_K different students independently state the same value (for
the same scope) it becomes shared knowledge: verified by the crowd, used for everyone it
applies to. A document stating the same value shares it at once (verify.py).

This keeps the personal-assistant behaviour while stopping one student's mistake — or
one bad actor — from changing everyone's answers.
"""

from __future__ import annotations

from typing import Optional

from ..classifier import same_value
from ..memory_manager import Result, event
from ..schemas import Classification, MemoryOp, World, owner_of
from ..slots import slot_def
from .verify import CROWD_K, promote, reporters_of


def corroborate(world: World, text: str, cls: Classification, user: str, applies_to: Optional[str], now: int) -> Optional[Result]:
    """If another student already told us this same fact, count this student as a second
    reporter instead of storing a copy — and share it once CROWD_K students agree."""
    d = slot_def(cls.slot)
    if not cls.slot or not cls.value or not d or d.user:
        return None
    match = next(
        (
            m
            for m in world.memories
            if m.slot == cls.slot
            and m.status in ("current", "pending")
            and owner_of(m) not in (None, user)
            and user not in (m.reporters or [])
            and same_value(m.value, cls.value)
            and m.applies_to == applies_to
        ),
        None,
    )
    if not match:
        return None
    match.reporters = [*reporters_of(match), user]
    match.uses.append(now)
    match.last_used_at = now
    n = len(match.reporters)
    events = []
    if n >= CROWD_K:
        scope = f" in {applies_to}" if applies_to else ""
        if match.status == "pending":
            events += promote(world, match, now, "crowd", f"{match.text} — confirmed by {n} students, now shared with everyone{scope}")
        else:
            match.shared = True
            events.append(event("memory.verified", now, "Shared by the crowd", f"{match.text} — confirmed by {n} students, now shared with everyone{scope}", match.id))
        detail = f"{n} students have now said this — shared with everyone{scope}"
    else:
        detail = f"{n} of {CROWD_K} students needed before it is shared"
    e = event("memory.corroborated", now, "Fact corroborated", f"{match.text} · {detail}", match.id)
    ops = [MemoryOp(kind="corroborate", memory_id=match.id, title=match.text, detail=detail)]
    return ops, [e, *events]
