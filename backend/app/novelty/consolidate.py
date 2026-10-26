"""Novelty 7 — consolidation: what a memory system does "overnight".

Two passes over the student's current memories (never pinned ones, never the slot facts
that are the current answer to a question, never ones that override a document):

  merge    two memories of the same student and kind that say the same thing (embedding
           similarity ≥ MERGE_SIM) become one: the better-supported one survives, takes
           the other's uses (so its decay slows) and a small confidence boost; the other
           is archived with a pointer to the survivor.
  archive  a memory whose strength has decayed below FORGET_THRESHOLD is archived —
           out of retrieval, still listed (and restorable) in the memory bank.

Runs when the demo clock jumps a day or more, and on demand (POST /api/memory/consolidate).
"""

from __future__ import annotations

from typing import Callable, Optional

from ..forgetting import FORGET_THRESHOLD, strength_at
from ..memory_manager import event
from ..schemas import ActivityEvent, Memory, World, owner_of

MERGE_SIM = 0.82


def _eligible(m: Memory) -> bool:
    return m.status == "current" and not m.pinned and not m.slot and not (m.supersedes or "").startswith("chunk:") and m.cls != "temporary"


def consolidate(world: World, now: int, sim: Callable[[str, str], float], taus: Optional[dict[str, float]] = None) -> list[ActivityEvent]:
    events: list[ActivityEvent] = []
    pool = [m for m in world.memories if _eligible(m)]

    # merge near-duplicates
    for i, a in enumerate(pool):
        if a.status != "current":
            continue
        for b in pool[i + 1 :]:
            if b.status != "current" or owner_of(a) != owner_of(b) or a.kind != b.kind:
                continue
            s = sim(a.id, b.id)
            if s < MERGE_SIM:
                continue
            keep, drop = (a, b) if (len(a.uses), a.confidence, a.created_at) >= (len(b.uses), b.confidence, -b.created_at) else (b, a)
            keep.uses = sorted(set(keep.uses) | set(drop.uses) | {drop.created_at})
            keep.last_used_at = max(keep.last_used_at, drop.last_used_at)
            keep.confidence = min(0.98, round(max(keep.confidence, drop.confidence) + 0.02, 2))
            keep.merged_from = [*(keep.merged_from or []), drop.id]
            drop.status = "archived"
            drop.archived_at = now
            drop.merged_into = keep.id
            events.append(event("memory.merged", now, "Duplicate memories merged", f"“{drop.text}” → “{keep.text}” (similarity {s:.2f})", keep.id))

    # archive what has faded
    for m in pool:
        if m.status == "current" and strength_at(m, now, taus) < FORGET_THRESHOLD:
            m.status = "archived"
            m.archived_at = now
            events.append(event("memory.archived", now, "Faded memory archived", f"{m.text} · strength below {FORGET_THRESHOLD}", m.id))

    world.events.extend(events)
    return events


def restore(world: World, m: Memory, now: int) -> list[ActivityEvent]:
    """Bring an archived memory back (and count the restore as a use)."""
    if m.status != "archived" or m.merged_into or (m.verification and m.verification.resolved_by and not m.verification.accepted):
        return []
    m.status = "current"
    m.archived_at = None
    m.uses.append(now)
    m.last_used_at = now
    e = event("memory.reinforced", now, "Memory restored", m.text, m.id)
    world.events.append(e)
    return [e]
