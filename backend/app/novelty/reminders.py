"""Novelty 11 — proactive reminders from temporary memories.

"I have a DBMS exam tomorrow" is kept until the end of tomorrow and then let go. Since
the system knows *when* it matters, it can also speak first: two reminders are scheduled
from it — the evening before (18:00) and the morning of (07:00) — skipping any that are
already in the past. When the clock passes a reminder it becomes *due*: it shows up in
the activity feed (and as a notification in the app). Deleting or outdating the memory
cancels its reminders.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from ..memory_manager import event
from ..schemas import ActivityEvent, Memory, Reminder, World, owner_of
from ..util import uid

EVENING_HOUR = 18
MORNING_HOUR = 7


def _what(m: Memory) -> str:
    v = m.value or m.text
    v = re.sub(r"\s*\b(today|tomorrow|tonight|this (morning|afternoon|evening|week))\b", "", v, flags=re.I).strip()
    v = re.sub(r"^(has an? |have an? )", "", v, flags=re.I)
    return v or "event"


def schedule(world: World, m: Memory, now: int) -> list[Reminder]:
    if m.cls != "temporary" or not m.expires_at:
        return []
    day = datetime.fromtimestamp(m.expires_at / 1000).replace(hour=0, minute=0, second=0, microsecond=0)
    what = _what(m)
    plan = [
        (day - timedelta(days=1) + timedelta(hours=EVENING_HOUR), f"Tomorrow: {what}", f"Your {what} is tomorrow — get some rest tonight. Good luck!"),
        (day + timedelta(hours=MORNING_HOUR), f"Today: {what}", f"Your {what} is today. Good luck!"),
    ]
    out = []
    for at_dt, title, text in plan:
        at = int(at_dt.timestamp() * 1000)
        if at > now:
            r = Reminder(id=uid("rem"), memory_id=m.id, owner=owner_of(m), at=at, title=title, text=text)
            world.reminders.append(r)
            out.append(r)
    return out


def due(world: World, now: int) -> list[ActivityEvent]:
    """Reminders whose time has come; ones whose memory is gone are cancelled."""
    events: list[ActivityEvent] = []
    for r in world.reminders:
        if r.status != "scheduled" or r.at > now:
            continue
        m = next((x for x in world.memories if x.id == r.memory_id), None)
        # still relevant when the reminder was due: current then (it may have expired since)
        relevant = m is not None and (m.status == "current" or (m.status == "expired" and (m.expired_at or 0) > r.at))
        if not relevant:
            r.status = "cancelled"
            continue
        r.status = "due"
        events.append(event("reminder.due", r.at, r.title, r.text, r.memory_id))
    world.events.extend(events)
    return events
