"""Slots: the things a statement can be *about*. Same slot + different value = conflict.

Port of the SLOTS table in frontend/lib/engine/classify.ts. Each slot knows how to
spot its topic and how to pull a normalised value out of a sentence.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional

from .text import capitalise

Extracted = dict  # {"value": str, "scope": Optional[str]}

PCT = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)", re.I)
TIME = re.compile(r"(\d{1,2}(?::\d{2})?\s*(?:am|pm))", re.I)


def _pct(t: str) -> Optional[str]:
    m = PCT.search(t)
    return f"{m.group(1)}%" if m else None


def _norm_time(time: str) -> str:
    return re.sub(r"(\d)(am|pm)", r"\1 \2", re.sub(r"\s+", " ", time).lower(), count=1)


@dataclass(frozen=True)
class SlotDef:
    slot: str
    label: str
    kind: str  # fact | preference | profile | event
    user: bool  # describes the user (profile/preference) rather than the world
    topic: re.Pattern[str]
    value: Optional[Callable[[str], Optional[Extracted]]] = None


def _name(t: str) -> Optional[Extracted]:
    m = re.search(r"\bmy name is ([a-z][a-z'-]+)", t, re.I) or re.search(r"\bcall me ([a-z][a-z'-]+)", t, re.I)
    return {"value": capitalise(m.group(1).lower())} if m else None


def _style(t: str) -> Optional[Extracted]:
    m = re.search(
        r"\b(?:prefer|like|want|keep|give me|use)\b[^.?!]*?\b(concise|short|brief|detailed|step[- ]by[- ]step|bullet(?:ed)?(?: points)?)\b",
        t,
        re.I,
    )
    if not m:
        return None
    v = m.group(1).lower()
    if re.search(r"concise|short|brief", v):
        return {"value": "concise"}
    if "bullet" in v:
        return {"value": "bullet points"}
    return {"value": "step-by-step"}


def _my_attendance(t: str) -> Optional[Extracted]:
    m = re.search(
        r"\bmy (?:current )?attendance (?:is|was|=|:|stands at|is now|is at)?\s*(?:now\s+|at\s+|around\s+|about\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)?",
        t,
        re.I,
    )
    return {"value": f"{m.group(1)}%"} if m else None


def _department(t: str) -> Optional[Extracted]:
    m = re.search(r"\b(?:i'?m|i am) (?:in|from) (?:the )?(cse|ece|eee|it|mech(?:anical)?|civil|biotech)\b", t, re.I) or re.search(
        r"\bmy (?:department|branch) is (\w+)", t, re.I
    )
    return {"value": m.group(1).upper()} if m else None


def _exam(t: str) -> Optional[Extracted]:
    m = re.search(
        r"\b(?:have|got|there'?s|writing)\s+(?:an?|my|the)?\s*([a-z]{2,10}\s)?(exam|quiz|test|viva|presentation)\b[^.?!]*?\b(today|tomorrow|tonight|this (?:morning|afternoon|evening|week))\b",
        t,
        re.I,
    )
    if not m:
        return None
    subject = m.group(1).strip().upper() + " " if m.group(1) else ""
    return {"value": f"{subject}{m.group(2).lower()} {m.group(3).lower()}"}


def _attendance_minimum(t: str) -> Optional[Extracted]:
    if re.search(r"\bmy (current )?attendance\b", t, re.I):
        return None
    v = _pct(t)
    if not v:
        return None
    scope = "department" if re.search(r"\b(our|my|the|cse) (department|dept|branch)\b|\bdepartment\b", t, re.I) else None
    return {"value": v, "scope": scope}


def _library(t: str) -> Optional[Extracted]:
    times = TIME.findall(t)
    if not times:
        return None
    if len(times) >= 2:
        return {"value": f"{_norm_time(times[0])} – {_norm_time(times[1])}"}
    if re.search(r"\bclose|closes|closing|till|until\b", t, re.I):
        return {"value": f"closes {_norm_time(times[0])}"}
    return None


def _pass_marks(t: str) -> Optional[Extracted]:
    m = re.search(r"\b(\d{2})\b(?:\s*(?:marks|out of 100|/100))?", t, re.I)
    return {"value": f"{m.group(1)} marks"} if m else None


def _curfew(t: str) -> Optional[Extracted]:
    times = TIME.findall(t)
    return {"value": _norm_time(times[0])} if times else None


SLOTS: list[SlotDef] = [
    SlotDef("user.name", "Name", "profile", True, re.compile(r"\b(my name|call me|who am i)\b", re.I), _name),
    SlotDef(
        "user.style",
        "Answer style",
        "preference",
        True,
        re.compile(
            r"\b(i prefer|my preference|answer style|keep (?:it|answers|replies) (?:short|brief|concise)|step[- ]by[- ]step|concise answers?)\b",
            re.I,
        ),
        _style,
    ),
    SlotDef("user.attendance", "Your attendance", "profile", True, re.compile(r"\bmy (current )?attendance\b", re.I), _my_attendance),
    SlotDef(
        "user.department",
        "Department",
        "profile",
        True,
        re.compile(r"\b(i'?m|i am) (in|from) (the )?(cse|ece|eee|it|mech|civil|biotech)\b|\bmy (department|branch) is\b", re.I),
        _department,
    ),
    SlotDef(
        "event.exam",
        "Upcoming exam",
        "event",
        True,
        re.compile(r"\b(exam|quiz|test|viva|presentation)\b[^.?!]*\b(today|tomorrow|tonight|this (morning|afternoon|evening|week))\b", re.I),
        _exam,
    ),
    SlotDef("attendance.minimum", "Minimum attendance", "fact", False, re.compile(r"\battendance\b", re.I), _attendance_minimum),
    SlotDef("library.hours", "Library hours", "fact", False, re.compile(r"\blibrary\b", re.I), _library),
    SlotDef(
        "pass.marks",
        "Pass mark",
        "fact",
        False,
        re.compile(r"\bpass(ing)?\b[^.?!]*\bmarks?\b|\bmarks?\b[^.?!]*\bpass\b", re.I),
        _pass_marks,
    ),
    SlotDef("hostel.curfew", "Hostel in-time", "fact", False, re.compile(r"\b(curfew|in-?time|hostel)\b", re.I), _curfew),
    SlotDef("fat.eligibility", "FAT eligibility", "fact", False, re.compile(r"\b(fat|final assessment|finals?)\b", re.I)),
]

# slots a document passage can make a claim about (checked on upload)
DOCUMENT_SLOTS = ["attendance.minimum", "library.hours", "pass.marks", "hostel.curfew"]


def slot_def(slot: Optional[str]) -> Optional[SlotDef]:
    if not slot:
        return None
    return next((s for s in SLOTS if s.slot == slot), None)


def detect_topic(text: str) -> Optional[SlotDef]:
    """Topic of a message, even without a value (used for questions and coreference)."""
    return next((s for s in SLOTS if s.topic.search(text)), None)


def extract(text: str) -> tuple[Optional[SlotDef], Optional[Extracted]]:
    """First slot whose topic matches *and* that yields a value."""
    for s in SLOTS:
        if s.value and s.topic.search(text):
            v = s.value(text)
            if v:
                return s, v
    return None, None
