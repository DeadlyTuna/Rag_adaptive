"""Novelty 3 — verifying corrections before they override a trusted source.

Adaptive RAG lets one sentence ("the minimum attendance is 5%") override a regulation.
That is what makes it useful, and what makes it easy to poison. Here a correction that
contradicts a document (or a fact a document backs) is scored before it is accepted:

    score = 0.50 · trust(student)            how often this student's corrections held up
          + 0.15 · authority                 cites a department / circular / professor …
          + 0.10 · scoped                    "for our department": a local exception,
                                             not a contradiction of the general rule
          + 0.25 · (1 − reliability × size)  how hard it contradicts the source: the
                                             source's reliability times the size of the
                                             change — relative for numbers (75% → 80% is
                                             small, 75% → 5% is not; ≥ 50% counts as 1),
                                             in hours for times (≥ 6 hours counts as 1)

At or above THRESHOLD the correction applies at once, as before. Below it the memory is
kept as *pending*: it is stored and shown, but answers keep using the source until

  • a document states the same value      → verified (and the student's trust goes up)
  • CROWD_K students say the same thing   → verified by the crowd (novelty 8)
  • a moderator accepts it                → verified
  • a document states a different value, or a moderator rejects it → rejected (trust down)

Student trust is a Beta(α, β) posterior, starting at Beta(4, 1) (mean 0.8): good faith,
but a handful of rejected corrections is enough to stop someone overriding the rules.
"""

from __future__ import annotations

import re
from typing import Optional

from ..classifier import AUTHORITY, same_value
from ..memory_manager import event, supersede
from ..retriever import short_doc
from ..schemas import DEFAULT_USER, ActivityEvent, Classification, Memory, Trust, Verification, World
from ..slots import slot_def
from ..util import r2

THRESHOLD = 0.6
CROWD_K = 2
SIZE_CAP = 0.5  # a relative change of 50% or more counts as a full contradiction


def trust_of(world: World, user: str) -> Trust:
    return world.trust.get(user) or Trust()


def reward(world: World, users: list[str], amount: float = 1.0) -> None:
    for u in users:
        t = trust_of(world, u)
        world.trust[u] = Trust(alpha=t.alpha + amount, beta=t.beta)


def penalise(world: World, users: list[str], amount: float = 1.0) -> None:
    for u in users:
        t = trust_of(world, u)
        world.trust[u] = Trust(alpha=t.alpha, beta=t.beta + amount)


def _number(v: Optional[str]) -> Optional[float]:
    m = re.search(r"-?\d+(?:\.\d+)?", v or "")
    return float(m.group(0)) if m else None


_TIME = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)", re.I)


def _minutes(v: Optional[str]) -> Optional[int]:
    """A time of day in minutes (the last one, for a range like "8 am – 8 pm"); small
    hours count as the next day, so "1 am" is later than "11 pm"."""
    found = _TIME.findall(v or "")
    if not found:
        return None
    h, m, ap = found[-1]
    hour = int(h) % 12 + (12 if ap.lower() == "pm" else 0)
    mins = hour * 60 + int(m or 0)
    return mins + 24 * 60 if hour < 5 else mins


def change_size(new: Optional[str], old: Optional[str]) -> float:
    """Size of the change in [0, 1]: relative for numbers (≥ 50% counts as 1), by hours
    for times of day (≥ 6 hours counts as 1); 0.5 when the values can't be compared."""
    ta, tb = _minutes(new), _minutes(old)
    if ta is not None and tb is not None:
        return min(1.0, abs(ta - tb) / 360)
    a, b = _number(new), _number(old)
    if a is None or b is None:
        return 0.5
    if b == 0:
        return 1.0
    return min(1.0, abs(a - b) / abs(b) / SIZE_CAP)


def contradicted_source(world: World, cls: Classification) -> Optional[tuple[str, str, float, str]]:
    """(id, value, reliability, label) of the trusted source a correction contradicts —
    a document passage, or a memory that a document or the crowd stands behind."""
    c = cls.conflict
    if not c:
        return None
    if c.with_kind == "document":
        chunk = world.chunk(c.with_id)
        if chunk:
            return chunk.id, c.with_value, chunk.reliability, f"{short_doc(world.doc_title(chunk.doc_id))} §{chunk.section}"
        return None
    m = world.memory(c.with_id)
    if m and (m.source.type == "document" or m.shared or m.confirmed_by):
        label = m.source.label if m.source.type == "document" else "a verified fact"
        return m.id, c.with_value, r2(m.reliability * m.confidence), label
    return None


def assess(world: World, text: str, cls: Classification, user: str) -> Optional[Verification]:
    """Score a correction, or None when there is nothing trusted to contradict
    (facts about the student themselves are never second-guessed)."""
    d = slot_def(cls.slot)
    if cls.decision != "replace" or (d and d.user):
        return None
    src = contradicted_source(world, cls)
    if not src:
        return None
    against, against_value, reliability, label = src
    t = trust_of(world, user).mean
    authority = bool(AUTHORITY.search(text))
    scoped = bool(cls.scope)
    size = change_size(cls.value, against_value)
    contradiction = reliability * size
    score = 0.5 * t + 0.15 * authority + 0.10 * scoped + 0.25 * (1 - contradiction)
    reasons = [f"Your corrections' track record: trust {t:.2f}"]
    if authority:
        reasons.append("Names an authority (department, circular, professor …)")
    if scoped:
        reasons.append("Scoped to a department — a local exception rather than a contradiction")
    reasons.append(f"Contradicts {label} (reliability {reliability:.2f}): {against_value} → {cls.value}, a {'large' if size >= 1 else 'small' if size < 0.3 else 'moderate'} change")
    return Verification(
        score=r2(score),
        threshold=THRESHOLD,
        accepted=score >= THRESHOLD,
        reasons=reasons,
        against=against,
        against_value=against_value,
    )


def reporters_of(m: Memory) -> list[str]:
    """The students who stated this fact (whether or not it has been shared since)."""
    if m.reporters:
        return list(m.reporters)
    return [m.owner or DEFAULT_USER] if m.source.type == "user" else []


def promote(world: World, m: Memory, now: int, by: str, detail: Optional[str] = None) -> list[ActivityEvent]:
    """A pending correction is verified: it now replaces what it contradicted. Returns the
    event; the caller records it (in a chat turn, the turn records all its events)."""
    if m.status != "pending":
        return []
    m.status = "current"
    v = m.verification
    if v:
        v.resolved_by = by
        v.resolved_at = now
        v.accepted = True
        if v.against:
            kind = "document" if world.chunk(v.against) else "memory"
            supersede(world, m, kind, v.against, m.slot, now)
    if by in ("document", "crowd"):
        m.shared = True
    reward(world, reporters_of(m))
    why = {"document": "a document states the same value", "crowd": f"{len(m.reporters or [])} students said the same", "moderator": "a moderator accepted it"}[by]
    return [event("memory.verified", now, "Correction verified", detail or f"{m.text} — {why}", m.id)]


def reject(world: World, m: Memory, now: int, by: str, detail: Optional[str] = None) -> list[ActivityEvent]:
    if m.status != "pending":
        return []
    m.status = "archived"
    m.archived_at = now
    if m.verification:
        m.verification.resolved_by = by
        m.verification.resolved_at = now
        m.verification.accepted = False
    penalise(world, reporters_of(m))
    why = "a document states a different value" if by == "document" else "a moderator rejected it"
    return [event("memory.rejected", now, "Correction rejected", detail or f"{m.text} — {why}", m.id)]


def on_document_claim(world: World, slot: str, value: str, chunk_id: str, now: int, dept: Optional[str] = None) -> list[ActivityEvent]:
    """A newly indexed passage states `value` for `slot` (for department `dept`, when it is
    scoped): settle pending corrections and share the students' facts it confirms."""
    events: list[ActivityEvent] = []
    for m in [x for x in world.memories if x.slot == slot]:
        if dept and m.applies_to and m.applies_to != dept:
            continue  # another department's rule — this document says nothing about it
        if same_value(m.value, value) and m.status in ("pending", "current") and dept and not m.applies_to:
            m.applies_to = dept  # the document tells us whom the rule is for
        if m.status == "pending":
            if same_value(m.value, value):
                m.confidence = max(m.confidence, 0.95)
                m.confirmed_by = chunk_id
                events += promote(world, m, now, "document")
            else:
                events += reject(world, m, now, "document")
        elif m.status == "current" and m.source.type == "user" and same_value(m.value, value) and not m.shared and m.confirmed_by == chunk_id:
            # the core pipeline already confirmed it; with that, it is shared knowledge
            m.shared = True
            reward(world, reporters_of(m))
    return events
