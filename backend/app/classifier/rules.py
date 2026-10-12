"""Rule-based text scorer: cue phrases → logits per memory class.

The baseline predictor (port of frontend/lib/engine/classify.ts). It's transparent —
every point of every logit comes from a named cue — which makes it a good baseline to
compare the trained scikit-learn model and the LLM classifier against.
"""

from __future__ import annotations

import re

from ..schemas import CLASSES
from ..slots import PCT, SlotDef

CUES: dict[str, list[re.Pattern[str]]] = {
    "correction": [
        re.compile(r"\bactually\b", re.I),
        re.compile(r"^\s*no\b|\bnope\b", re.I),
        re.compile(r"\bnot (right|correct|true)\b", re.I),
        re.compile(r"\b(is|was|that'?s) (wrong|incorrect|outdated|old)\b", re.I),
        re.compile(r"\bincorrect\b", re.I),
        re.compile(r"\bchanged\b", re.I),
        re.compile(r"\b(updated|revised|raised|increased|lowered|reduced|moved|postponed|extended)\b", re.I),
        re.compile(r"\bnow (it'?s|it is)\b", re.I),
        re.compile(r"\bno longer\b|\bnot anymore\b", re.I),
        re.compile(r"\binstead\b", re.I),
    ],
    "persistent": [
        re.compile(r"\bmy name is\b|\bcall me\b", re.I),
        re.compile(r"\b(i'?m|i am) (a|an|in|from)\b", re.I),
        re.compile(r"\bi (prefer|like|want|love)\b", re.I),
        re.compile(r"\bplease (always|keep|use|give)\b", re.I),
        re.compile(r"\balways\b", re.I),
        re.compile(r"\bmy (department|branch|major|semester|roll|year|attendance|cgpa|gpa|courses?)\b", re.I),
        re.compile(r"\bi study\b", re.I),
    ],
    "important": [
        re.compile(r"\bdeadlines?\b", re.I),
        re.compile(r"\brules?\b|\bpolicy\b|\bregulations?\b", re.I),
        re.compile(r"\brequire(ment|d)?\b|\bmandatory\b|\bminimum\b", re.I),
        re.compile(r"\b(professor|prof|faculty|hod|dean|registrar|warden)\b", re.I),
        re.compile(r"\b(announced|notice|circular|official)\b", re.I),
        re.compile(r"\bchanged\b", re.I),
    ],
    "temporary": [
        re.compile(r"\btoday\b", re.I),
        re.compile(r"\btomorrow\b", re.I),
        re.compile(r"\btonight\b", re.I),
        re.compile(r"\bthis (week|weekend|evening|morning|afternoon)\b", re.I),
        re.compile(r"\bright now\b|\bat the moment\b|\bfor now\b", re.I),
        re.compile(r"\bnext (class|hour|period)\b", re.I),
    ],
    "irrelevant": [
        re.compile(r"^\s*(hi|hello|hey|thanks|thank you|ok|okay|cool|lol|bye|good (morning|night))\b", re.I),
        re.compile(r"\bweather\b", re.I),
        re.compile(r"\d+\s*[+\-*x×/]\s*\d+", re.I),
        re.compile(r"\bjoke\b", re.I),
        re.compile(r"\bhow are you\b", re.I),
    ],
}

CUE_WEIGHT = {"correction": 1.6, "persistent": 2.2, "important": 1.1, "temporary": 2.6, "irrelevant": 2.4}
CUE_CAP = {"correction": 2, "persistent": 1, "important": 3, "temporary": 1, "irrelevant": 1}

_HAS_TIME = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(am|pm)\b", re.I)
_HAS_NUMBER = re.compile(r"\b\d{2,3}\b")
_FIRST_PERSON = re.compile(r"\b(i|my|we|our)\b", re.I)


def has_correction_cue(text: str) -> bool:
    return any(p.search(text) for p in CUES["correction"])


def rule_logits(text: str, question: bool, slot: SlotDef | None, extracted: bool) -> dict[str, float]:
    """Text-only evidence. World-state evidence (conflicts) is added by the caller."""
    logits = {c: 0.0 for c in CLASSES}
    logits["irrelevant"] = 0.6

    for cls in CLASSES:
        hits = sum(1 for p in CUES[cls] if p.search(text))
        logits[cls] += min(hits, CUE_CAP[cls]) * CUE_WEIGHT[cls]

    if PCT.search(text) or _HAS_TIME.search(text) or _HAS_NUMBER.search(text):
        logits["important"] += 0.5
        logits["correction"] += 0.4
    if not question and _FIRST_PERSON.search(text):
        logits["persistent"] += 0.4

    if slot and extracted:
        if slot.kind == "event":
            logits["temporary"] += 0.8
        elif slot.user:
            logits["persistent"] += 1.2
        else:
            logits["important"] += 0.8

    if question:
        logits["irrelevant"] += 1.6
        for c in CLASSES:
            if c != "irrelevant":
                logits[c] -= 0.8
    return logits
