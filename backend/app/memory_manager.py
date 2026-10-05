"""Memory manager: turns classified statements into memory writes, and applies every
other change to what the system believes — add / replace / reinforce / expire /
pin / mark outdated / delete — plus feedback.

Nothing is ever silently overwritten. A correction marks the old fact `outdated`
(kept as history, linked both ways) and the new one `current`; a correction to a
*document* claim leaves the passage in the index but records that its claim is
overridden for that slot.

Port of the statement/feedback/memory-action parts of frontend/lib/engine/engine.ts.
All functions mutate the World passed in and return what happened.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Callable, Optional

from .classifier import importance_for, user_confidence
from .forgetting import DAY
from .learning import (
    deltas,
    lower_reliability,
    normalise,
    outdated_reliability,
    pairwise_update,
    raise_reliability,
    reinforce_update,
)
from .retriever import short_doc
from .schemas import (
    ActivityEvent,
    Classification,
    Feedback,
    Memory,
    MemoryOp,
    ReliabilityChange,
    Source,
    Turn,
    WeightPoint,
    World,
)
from .slots import slot_def
from .text import capitalise
from .util import r2, uid

# placer(world, item_id, near_id) — gives a new item its spot on the 2-D map
Placer = Callable[[World, str, Optional[str]], None]


def event(type_: str, at: int, title: str, detail: str, ref_id: Optional[str] = None) -> ActivityEvent:
    return ActivityEvent(id=uid("ev"), type=type_, at=at, title=title, detail=detail, ref_id=ref_id)


# ---------------------------------------------------------------------------------
# time helpers (server-local time, like the browser's in the demo)


def _dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000)


def _ms(d: datetime) -> int:
    return int(d.timestamp() * 1000)


def end_of_day(t: int, plus_days: int = 0) -> int:
    d = _dt(t) + timedelta(days=plus_days)
    return _ms(d.replace(hour=23, minute=59, second=0, microsecond=0))


def expiry_for(text: str, now: int) -> int:
    if re.search(r"\btomorrow\b", text, re.I):
        return end_of_day(now, 1)
    if re.search(r"\b(today|tonight|this (morning|afternoon|evening))\b", text, re.I):
        return end_of_day(now)
    if re.search(r"\bthis week(end)?\b", text, re.I):
        return end_of_day(now, 6)
    return now + DAY


def fmt_day(t: int) -> str:
    d = _dt(t)
    return f"{d:%a}, {d.day} {d:%b}"


def fmt_weekday_time(t: int) -> str:
    """'Tue, 11:59 pm' — the browser's en-IN format, so both engines read the same."""
    d = _dt(t)
    hour = d.hour % 12 or 12
    return f"{d:%a}, {hour}:{d:%M} {'am' if d.hour < 12 else 'pm'}"


# ---------------------------------------------------------------------------------
# expiry


def tick(world: World, now: int) -> tuple[list[ActivityEvent], list[str]]:
    """Expire temporary memories whose time has passed."""
    events: list[ActivityEvent] = []
    expired: list[str] = []
    for m in world.memories:
        if m.status == "current" and m.expires_at and m.expires_at <= now and not m.pinned:
            m.status = "expired"
            m.expired_at = m.expires_at
            events.append(event("memory.expired", m.expires_at, "Temporary memory expired", m.text, m.id))
            expired.append(m.id)
    world.events.extend(events)
    return events, expired


# ---------------------------------------------------------------------------------
# statements → memories


def knowledge_line(world: World, cls: Classification, text: str, now: int) -> tuple[str, str]:
    """(label, line) — the short human label and the knowledge line stored."""
    d = slot_def(cls.slot)
    v = cls.value or ""
    dept_mem = world.current_memory("user.department")
    dept = dept_mem.value if dept_mem else None
    slot = d.slot if d else None
    if slot == "user.name":
        return d.label, f"Name: {v}"
    if slot == "user.style":
        line = (
            "Prefers concise answers"
            if v == "concise"
            else "Prefers answers as bullet points"
            if v == "bullet points"
            else "Prefers step-by-step explanations"
        )
        return d.label, line
    if slot == "user.attendance":
        return d.label, f"Current attendance is {v}"
    if slot == "user.department":
        return d.label, f"Studies {v}"
    if slot == "event.exam":
        when = now + DAY if "tomorrow" in v else now
        what = re.sub(r"\s*(today|tomorrow|tonight|this \w+)$", "", v, flags=re.I)
        return d.label, f"Has a {what} on {fmt_day(when)}"
    if slot == "attendance.minimum":
        scope = f" ({dept or 'your'} department)" if cls.scope else ""
        return d.label, f"Minimum attendance = {v}{scope}"
    if slot == "library.hours":
        return d.label, f"Library {v.replace('closes', 'closes at')}" if v.startswith("closes") else f"Library open {v}"
    if slot == "pass.marks":
        return d.label, f"Pass mark = {v}"
    if slot == "hostel.curfew":
        return d.label, f"Hostel in-time is {v}"

    # an open-ended fact: the LLM classifier may have written a clean knowledge line
    if cls.knowledge:
        clean = capitalise(cls.knowledge.strip().rstrip(".!"))
    else:
        clean = capitalise(re.sub(r"[.!]+$", "", re.sub(r"^(actually|fyi|note|btw|so|ok|okay|also)[,:]?\s+", "", text.strip(), flags=re.I)))
    if re.search(r"\bdeadline", text, re.I):
        topic = "Deadline"
    elif re.search(r"\bexam|quiz|test\b", text, re.I):
        topic = "Exam"
    elif re.search(r"\bfee", text, re.I):
        topic = "Fees"
    elif re.search(r"\bhostel", text, re.I):
        topic = "Hostel"
    elif re.search(r"\blab\b", text, re.I):
        topic = "Lab"
    else:
        topic = "Note"
    return topic, clean


def apply_statement(world: World, text: str, cls: Classification, now: int, placer: Placer) -> tuple[list[MemoryOp], list[ActivityEvent]]:
    ops: list[MemoryOp] = []
    events: list[ActivityEvent] = []
    d = slot_def(cls.slot)

    if cls.decision in ("question", "discard"):
        if cls.decision == "discard":
            ops.append(MemoryOp(kind="discard", title="Not stored", detail=cls.reason))
        return ops, events

    if cls.decision == "reinforce":
        m = world.current_memory(cls.slot) if cls.slot else None
        if m:
            m.uses.append(now)
            m.last_used_at = now
            m.confidence = min(0.98, r2(m.confidence + 0.04))
            ops.append(MemoryOp(kind="reinforce", memory_id=m.id, title=m.text, detail=f"Confirmed — confidence now {m.confidence:.2f}"))
            events.append(event("memory.reinforced", now, "Memory reinforced", m.text, m.id))
        else:
            ops.append(MemoryOp(kind="reinforce", title="Matches the documents", detail="Already what the regulations say."))
        return ops, events

    if cls.decision == "flag-previous":
        # the last answer to an actual question — acknowledgements don't count
        prev: Optional[Turn] = None
        for t in reversed(world.turns):
            if t.role != "assistant" or not (t.retrieval and t.retrieval.candidates):
                continue
            asked = next((u for u in world.turns if u.id == t.reply_to), None)
            if asked and asked.classification and asked.classification.is_question:
                prev = t
                break
        cited = {c.item_id for c in (prev.citations or [])} if prev else set()
        target = None
        if prev and prev.retrieval:
            target = next((c for c in prev.retrieval.candidates if c.id in cited), None) or prev.retrieval.candidates[0]
        if prev and target:
            fb, fb_events = feedback_on(world, prev, "not_helpful", "wrong_source", target.id, now)
            prev.feedback = fb
            events.extend(fb_events)
            ops.append(
                MemoryOp(
                    kind="flag",
                    previous_id=target.id,
                    subject=target.title,
                    title=f"Lowered trust in {target.title}",
                    detail=f"Reliability {fb.reliability.from_:.2f} → {fb.reliability.to:.2f}" if fb.reliability else None,
                )
            )
        else:
            ops.append(MemoryOp(kind="flag", title="Nothing to flag yet", detail="There's no earlier answer to a question in this conversation."))
        return ops, events

    # store / replace / keep-temporarily
    label, line = knowledge_line(world, cls, text, now)
    kind = d.kind if d else ("event" if cls.label == "temporary" else "fact")
    mcls = "important" if cls.label == "irrelevant" else cls.label
    memory = Memory(
        id=uid("mem"),
        slot=cls.slot if (cls.slot and d and d.value) else None,
        label=label,
        text=line,
        value=cls.value,
        scope=cls.scope,
        cls=mcls,
        kind=kind,
        source=Source(type="user", label="You"),
        utterance=text.strip(),
        confidence=user_confidence(text, mcls, kind, bool(cls.value)),
        importance=importance_for(mcls, kind),
        reliability=1.0,
        status="current",
        pinned=False,
        created_at=now,
        last_used_at=now,
        uses=[],
    )
    if cls.decision == "keep-temporarily":
        memory.expires_at = expiry_for(text, now)

    near: Optional[str] = None
    if cls.decision == "replace" and cls.conflict:
        c = cls.conflict
        memory.previous_value = c.with_value
        if c.with_kind == "memory":
            old = world.memory(c.with_id)
            if old:
                old.status = "outdated"
                old.superseded_by = memory.id
                old.superseded_at = now
                memory.supersedes = old.id
                near = old.id
        else:
            chunk = world.chunk(c.with_id)
            if chunk and cls.slot:
                chunk.overridden_by = {**(chunk.overridden_by or {}), cls.slot: memory.id}
                memory.supersedes = f"chunk:{chunk.id}"
                near = chunk.id

    world.memories.append(memory)
    placer(world, memory.id, near)

    if cls.decision == "replace" and cls.conflict:
        c = cls.conflict
        ops.append(
            MemoryOp(
                kind="replace",
                memory_id=memory.id,
                previous_id=c.with_id if c.with_kind == "memory" else None,
                title=memory.text,
                detail=f"Replaces “{c.with_value}” from {'an earlier memory' if c.with_kind == 'memory' else c.with_source}",
            )
        )
        what = "Preference updated" if kind == "preference" else "Profile updated" if kind == "profile" else "Previous fact corrected"
        events.append(event("memory.replaced", now, what, f"{label}: {c.with_value} → {memory.value or memory.text}", memory.id))
    else:
        detail = (
            f"Kept until {fmt_weekday_time(memory.expires_at)}"
            if cls.decision == "keep-temporarily" and memory.expires_at
            else f"Stored as {mcls} · confidence {memory.confidence:.2f}"
        )
        ops.append(MemoryOp(kind="add", memory_id=memory.id, title=memory.text, detail=detail))
        title = (
            "Preference learned"
            if kind == "preference"
            else "Profile learned"
            if kind == "profile"
            else "Temporary memory kept"
            if mcls == "temporary"
            else "New knowledge added"
        )
        events.append(event("memory.preference" if kind == "preference" else "memory.added", now, title, memory.text, memory.id))
    return ops, events


def expand_query(text: str, cls: Classification) -> str:
    """Add the context a short question implies (short-term memory of the topic)."""
    extra: list[str] = []
    if re.search(r"\b(fat|final assessment|finals?)\b", text, re.I):
        extra.append("FAT eligibility minimum attendance requirement CAT")
    if re.search(r"\b(am i|can i|my)\b", text, re.I) and re.search(r"\b(eligible|allowed|write|sit)\b", text, re.I):
        extra.append("my current attendance")
    if re.search(r"\battendance\b", text, re.I) and not re.search(r"\bmy attendance\b", text, re.I):
        extra.append("minimum attendance requirement")
    if not cls.is_question and cls.slot_label:
        extra.append(cls.slot_label)
    return f"{text} {' '.join(extra)}" if extra else text


# ---------------------------------------------------------------------------------
# feedback


def _short_query(q: Optional[str]) -> str:
    if not q:
        return "answer"
    words = q.split()
    s = " ".join(words[:7])
    return f"{s}…" if len(s) < len(q) else s


def title_for(world: World, item_id: str) -> str:
    c = world.chunk(item_id)
    if c:
        return f"{short_doc(world.doc_title(c.doc_id))} §{c.section}"
    m = world.memory(item_id)
    return m.text if m else item_id


def feedback_on(
    world: World, turn: Turn, verdict: str, reason: Optional[str], target_id: Optional[str], now: int
) -> tuple[Feedback, list[ActivityEvent]]:
    cands = turn.retrieval.candidates if turn.retrieval else []
    before = world.weights.model_copy()
    after = before
    reliability: Optional[ReliabilityChange] = None

    def set_reliability(item_id: str, fn: Callable[[float], float]) -> None:
        nonlocal reliability
        target = world.chunk(item_id) or world.memory(item_id)
        if not target:
            return
        frm = target.reliability
        target.reliability = fn(frm)
        if frm != target.reliability:
            reliability = ReliabilityChange(id=item_id, from_=frm, to=target.reliability)

    if verdict == "helpful":
        cited_ids = {c.item_id for c in (turn.citations or [])}
        cited = [c for c in cands if c.id in cited_ids]
        others = [c for c in cands if c.id not in cited_ids]
        for c in cited:
            set_reliability(c.id, raise_reliability)
        if cited:
            after = reinforce_update(before, cited[0], others)
        label = f"Helpful: {_short_query(turn.retrieval.query if turn.retrieval else None)}"
    elif target_id and reason in ("wrong_source", "outdated"):
        rejected = next((c for c in cands if c.id == target_id), None)
        preferred = next((c for c in cands if c.id != target_id and not (c.note or "").startswith("Looked up")), None)
        if rejected and preferred:
            after = pairwise_update(before, preferred, rejected)
        set_reliability(target_id, outdated_reliability if reason == "outdated" else lower_reliability)
        if reason == "outdated":
            m = world.memory(target_id)
            if m and m.status == "current":
                m.status = "outdated"
                m.superseded_at = now
        label = f"{'Outdated' if reason == 'outdated' else 'Wrong source'}: {rejected.title if rejected else 'source'}"
    else:
        label = "Not helpful: incomplete answer"

    after = normalise(after)
    d = deltas(before, after)
    changed = any(abs(d.get(f)) >= 0.001 for f in "SRCI")
    events: list[ActivityEvent] = []
    if changed:
        world.weights = after
        world.weight_history.append(WeightPoint(at=now, weights=after.model_copy(), label=label))
        events.append(event("weights.updated", now, "Ranking weights updated", label))
    if reliability and reliability.to < reliability.from_:
        events.append(
            event(
                "memory.flagged",
                now,
                "Source marked less reliable",
                f"{title_for(world, reliability.id)} · {reliability.from_:.2f} → {reliability.to:.2f}",
                reliability.id,
            )
        )
    fb = Feedback(verdict=verdict, reason=reason, target_id=target_id, deltas=d, reliability=reliability, at=now)
    return fb, events


def apply_feedback(
    world: World, turn_id: str, verdict: str, reason: Optional[str], target_id: Optional[str], now: int
) -> tuple[Optional[Feedback], list[ActivityEvent]]:
    turn = next((t for t in world.turns if t.id == turn_id), None)
    if not turn:
        return None, []
    fb, events = feedback_on(world, turn, verdict, reason, target_id, now)
    turn.feedback = fb
    world.events.extend(events)
    return fb, events


# ---------------------------------------------------------------------------------
# direct memory actions (the Memory page)


def toggle_pin(world: World, mem_id: str, now: int, pinned: Optional[bool] = None) -> list[ActivityEvent]:
    m = world.memory(mem_id)
    if not m:
        return []
    m.pinned = (not m.pinned) if pinned is None else pinned
    e = event("memory.pinned", now, "Memory pinned" if m.pinned else "Memory unpinned", m.text, m.id)
    world.events.append(e)
    return [e]


def _release_chunk_override(world: World, m: Memory) -> None:
    if m.supersedes and m.supersedes.startswith("chunk:") and m.slot:
        chunk = world.chunk(m.supersedes[6:])
        if chunk and chunk.overridden_by:
            chunk.overridden_by.pop(m.slot, None)
            if not chunk.overridden_by:
                chunk.overridden_by = None


def mark_outdated(world: World, mem_id: str, now: int) -> list[ActivityEvent]:
    m = world.memory(mem_id)
    if not m or m.status != "current":
        return []
    m.status = "outdated"
    m.superseded_at = now
    _release_chunk_override(world, m)
    e = event("memory.outdated", now, "Memory marked outdated", m.text, m.id)
    world.events.append(e)
    return [e]


def delete_memory(world: World, mem_id: str, now: int) -> list[ActivityEvent]:
    """Delete a memory. Deleting a replacement restores what it replaced."""
    m = world.memory(mem_id)
    if not m:
        return []
    if m.supersedes and m.supersedes.startswith("chunk:") and m.slot:
        _release_chunk_override(world, m)
    elif m.supersedes and m.status == "current":
        prev = world.memory(m.supersedes)
        if prev:
            prev.status = "current"
            prev.superseded_by = None
            prev.superseded_at = None
    world.memories = [x for x in world.memories if x.id != mem_id]
    world.positions.pop(mem_id, None)
    e = event("memory.deleted", now, "Memory deleted", m.text)
    world.events.append(e)
    return [e]
