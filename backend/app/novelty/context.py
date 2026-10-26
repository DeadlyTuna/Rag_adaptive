"""Novelty 1 — reading scope and time out of a message.

Questions:   "What was the minimum attendance last month?"   → as_of = now − 30 days
             "What's the attendance rule for ECE?"            → scope = ECE
             "What was it before the change?"                 → as_of = just before the current fact began
Statements:  "Our department changed it to 80% last semester." → valid from ~6 months ago
             "From 1 December the library closes at 11 pm."   → valid from 1 Dec (scheduled)

All of it is deterministic pattern matching — the point is the data model (facts with a
scope and a validity interval) and the resolver, not the parser.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Optional

from ..forgetting import DAY

DEPARTMENT = re.compile(r"\b(cse|ece|eee|mech|civil|biotech)\b", re.I)
DEPARTMENT_IT = re.compile(r"\b(IT)\b")  # case-sensitive: "it" is a pronoun

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
_MONTH = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_DAY_MONTH = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+{_MONTH}\b|\b{_MONTH}\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", re.I)
_MONTH_ONLY = re.compile(rf"\b(?:in|since|from|during|as of)\s+{_MONTH}\b", re.I)
_AGO = re.compile(r"\b(\d+|a|an|one|two|three|four|six)\s+(day|week|month|year)s?\s+ago\b", re.I)
_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "six": 6}
_UNIT = {"day": DAY, "week": 7 * DAY, "month": 30 * DAY, "year": 365 * DAY}

# relative periods: how far back "last X" reaches, and forward for "next X"
_PERIOD = {"week": 7 * DAY, "month": 30 * DAY, "semester": 182 * DAY, "term": 182 * DAY, "year": 365 * DAY}
_NEXT_START = {"week": 7 * DAY, "month": 30 * DAY, "semester": 120 * DAY, "term": 120 * DAY, "year": 365 * DAY}

PAST_QUESTION = re.compile(r"\b(was|were|used to|did|before|originally|previously|earlier)\b", re.I)
FUTURE_QUESTION = re.compile(r"\b(will|going to|from next|next (week|month|semester|term|year))\b", re.I)
BEFORE_CHANGE = re.compile(r"\bbefore (the |that |this )?(change|update|correction|it changed|they changed it)\b|\b(originally|used to be|previously)\b", re.I)


def _dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000)


def _ms(d: datetime) -> int:
    return int(d.timestamp() * 1000)


def _month_index(name: str) -> int:
    return MONTHS.index(name[:3].lower()) + 1


def _date(text: str, now: int, future: bool, start: bool = False) -> Optional[int]:
    """An explicit calendar date, resolved to the next (future=True) or the most recent
    past occurrence. A bare month means its middle, or its first day when `start`."""
    today = _dt(now).replace(hour=0, minute=0, second=0, microsecond=0)
    m = _DAY_MONTH.search(text)
    if m:
        day = int(m.group(1) or m.group(4))
        month = _month_index(m.group(2) or m.group(3))
        for year in (today.year - 1, today.year, today.year + 1) if future else (today.year + 1, today.year, today.year - 1):
            try:
                d = datetime(year, month, day)
            except ValueError:
                return None
            if (future and d >= today) or (not future and d <= today):
                return _ms(d)
        return None
    m = _MONTH_ONLY.search(text)
    if m:
        month = _month_index(m.group(1))
        year = today.year
        d = datetime(year, month, 1 if future or start else 15)
        if future and d < today:
            d = d.replace(year=year + 1)
        if not future and d > today:
            d = d.replace(year=year - 1)
        return _ms(d)
    return None


def department_in(text: str) -> Optional[str]:
    m = DEPARTMENT.search(text) or DEPARTMENT_IT.search(text)
    return m.group(1).upper() if m else None


def question_as_of(text: str, now: int) -> Optional[int]:
    """The moment a question asks about, when it isn't now."""
    t = text.lower()
    m = re.search(r"\blast (week|month|semester|term|year)\b", t)
    if m:
        return now - _PERIOD[m.group(1)]
    if re.search(r"\byesterday\b", t):
        return now - DAY
    m = _AGO.search(t)
    if m:
        n = int(m.group(1)) if m.group(1).isdigit() else _WORDS[m.group(1)]
        return now - n * _UNIT[m.group(2)]
    m = re.search(r"\bnext (week|month|semester|term|year)\b", t)
    if m and FUTURE_QUESTION.search(t):
        return now + _NEXT_START[m.group(1)]
    if re.search(r"\b(on|as of|in|during|since|from|by)\b", t):
        future = bool(FUTURE_QUESTION.search(t))
        if future or PAST_QUESTION.search(t):
            return _date(t, now, future)
    return None


def statement_valid_from(text: str, now: int) -> Optional[int]:
    """When a stated fact took (or takes) effect, if the message says so."""
    t = text.lower()
    m = re.search(r"\b(?:since |from |as of |effective |starting |beginning )?last (week|month|semester|term|year)\b", t)
    if m:
        return now - _PERIOD[m.group(1)]
    m = re.search(r"\b(?:from|starting|beginning|effective|as of) next (week|month|semester|term|year)\b", t)
    if m:
        return now + _NEXT_START[m.group(1)]
    if re.search(r"\b(?:from|starting|beginning|effective) tomorrow\b", t):
        d = _dt(now).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        return _ms(d)
    m = re.search(r"\b(from|starting|beginning|effective|as of|since)\b", t)
    if m:
        since = m.group(1) == "since"
        return _date(t[m.start() :], now, future=not since, start=since)
    return None


def is_before_change(text: str) -> bool:
    return bool(BEFORE_CHANGE.search(text))
