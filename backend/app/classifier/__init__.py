"""Memory classifier: "should I remember this — and how?"

Three interchangeable *text predictors* estimate P(class | text):
  • rules — cue-phrase scorer (transparent baseline, no training)
  • ml    — scikit-learn model trained on labelled sentences (ml/train_classifier.py)
  • llm   — an LLM asked for a structured JSON verdict

Every predictor is then combined with the same *world-state evidence* that no text
model can see on its own — is there a conflicting value already stored? does the
user refer to a previous answer? — and the same deterministic decision logic:
store / replace / reinforce / keep-temporarily / discard / flag-previous / question.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Optional, Protocol

from ..schemas import CLASSES, Classification, Conflict, Span, World
from ..slots import SLOTS, SlotDef, detect_topic, extract, slot_def
from ..text import is_question
from .rules import CUES, has_correction_cue, rule_logits

PREVIOUS_ANSWER = re.compile(r"\b(your|the) (previous|last|earlier) (answer|reply|response)\b|\bthat answer\b", re.I)
AUTHORITY = re.compile(r"\b(department|dept|professor|prof|circular|official|notice|hod|dean|registrar|warden)\b", re.I)
_COREF = re.compile(r"\b(it|that|this|the rule|the requirement|the limit)\b", re.I)


class TextPredictor(Protocol):
    name: str

    def predict(self, text: str) -> "Prediction": ...


@dataclass
class Prediction:
    probs: dict[str, float]
    # optional structured extras an LLM can provide
    slot: Optional[str] = None
    value: Optional[str] = None
    scope: Optional[str] = None
    knowledge: Optional[str] = None
    is_question: Optional[bool] = None


# ---------------------------------------------------------------------------------


def softmax(logits: dict[str, float]) -> dict[str, float]:
    m = max(logits[c] for c in CLASSES)
    exps = {c: math.exp(logits[c] - m) for c in CLASSES}
    s = sum(exps.values())
    return {c: exps[c] / s for c in CLASSES}


def _argmax(probs: dict[str, float]) -> str:
    best = CLASSES[0]
    for c in CLASSES[1:]:
        if probs[c] > probs[best]:
            best = c
    return best


def current_for_slot(world: World, slot: str):
    """What is currently believed for a slot: a current memory, else a document claim
    that no memory overrides. Returns ("memory", Memory) | ("chunk", Chunk, value) | None."""
    m = world.current_memory(slot)
    if m:
        return ("memory", m)
    for c in world.chunks:
        claim = next((cl for cl in c.claims if cl.slot == slot), None)
        if claim and not (c.overridden_by or {}).get(slot):
            return ("chunk", c, claim.value)
    return None


def current_value(world: World, slot: str) -> Optional[str]:
    cur = current_for_slot(world, slot)
    if not cur:
        return None
    return cur[1].value if cur[0] == "memory" else cur[2]


def same_value(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return False

    def n(s: str) -> str:
        return re.sub(r"\s+", " ", s.lower()).replace("percent", "%", 1).strip()

    return n(a) == n(b)


def collect_spans(text: str, slot: Optional[SlotDef]) -> list[Span]:
    spans: list[Span] = []

    def push(pattern: re.Pattern[str], kind: str) -> None:
        for m in pattern.finditer(text):
            if not m.group(0).strip():
                break
            spans.append(Span(start=m.start(), end=m.end(), kind=kind, text=m.group(0)))

    push(re.compile(r"\d{1,3}(?:\.\d+)?\s*(?:%|percent)|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d+\s*[+\-*x×/]\s*\d+\b", re.I), "value")
    push(re.compile(r"\b(today|tomorrow|tonight|this (?:week|weekend|evening|morning|afternoon)|last semester|next week)\b", re.I), "time")
    push(re.compile(r"\b(actually|changed|wrong|incorrect|updated|revised|raised|prefer|always|no longer|instead)\b", re.I), "cue")
    if slot:
        push(slot.topic, "topic")
    push(re.compile(r"\bmy name is ([A-Z][a-z]+)\b"), "entity")
    spans.sort(key=lambda s: (s.start, -s.end))
    out: list[Span] = []
    last = -1
    for s in spans:
        if s.start >= last:
            out.append(s)
            last = s.end
    # the browser slices strings in UTF-16 code units, Python in code points
    if any(ord(ch) > 0xFFFF for ch in text):

        def u16(i: int) -> int:
            return len(text[:i].encode("utf-16-le")) // 2

        out = [Span(start=u16(s.start), end=u16(s.end), kind=s.kind, text=s.text) for s in out]
    return out


# ---------------------------------------------------------------------------------


def classify(
    text: str,
    world: World,
    last_topic: Optional[str] = None,
    predictor: Optional[TextPredictor] = None,
) -> Classification:
    question = is_question(text)

    # --- slot + value, with coreference to the previous topic ("changed *it* to 80%")
    sdef, extracted = extract(text)
    coref: Optional[str] = None
    if not sdef and not question and last_topic:
        prev = slot_def(last_topic)
        if prev and prev.value and _COREF.search(text):
            v = prev.value(text + " " + ("attendance" if prev.slot == "attendance.minimum" else ""))
            if v:
                sdef, extracted = prev, v
                coref = f"“it” → {prev.label.lower()} (from your previous question)"

    # --- text evidence
    pred: Optional[Prediction] = None
    if predictor is None or predictor.name == "rules":
        logits = rule_logits(text, question, sdef, bool(extracted))
        name = "rules"
    else:
        pred = predictor.predict(text)
        name = predictor.name
        logits = {c: math.log(max(1e-4, pred.probs.get(c, 0.0))) for c in CLASSES}
        # an LLM can extract facts the regex slots don't know about
        if not sdef and pred.slot and pred.value and slot_def(pred.slot) and slot_def(pred.slot).value:
            sdef = slot_def(pred.slot)
            extracted = {"value": pred.value, "scope": pred.scope}

    topic = sdef or detect_topic(text)

    # --- world-state evidence: is something different already believed?
    conflict: Optional[Conflict] = None
    reinforce: Optional[str] = None
    if sdef and extracted and not question:
        cur = current_for_slot(world, sdef.slot)
        cur_value = (cur[1].value if cur[0] == "memory" else cur[2]) if cur else None
        if cur and same_value(cur_value, extracted["value"]):
            reinforce = cur[1].id
        elif cur and cur_value:
            if cur[0] == "memory":
                m = cur[1]
                conflict = Conflict(with_id=m.id, with_kind="memory", with_text=m.text, with_value=cur_value, with_source=m.source.label)
            else:
                c = cur[1]
                conflict = Conflict(
                    with_id=c.id,
                    with_kind="document",
                    with_text=f"{sdef.label} = {cur_value}",
                    with_value=cur_value,
                    with_source=f"{world.doc_title(c.doc_id)} §{c.section}",
                )
            if not sdef.user:
                logits["correction"] += 2.8

    previous_answer = bool(PREVIOUS_ANSWER.search(text))
    if previous_answer:
        logits["correction"] += 2.5

    # A correction needs something to correct.
    if has_correction_cue(text) and not conflict and not previous_answer:
        logits["correction"] -= 1.2
        logits["important"] += 1.0

    probs = softmax(logits)
    label = _argmax(probs)

    if question and label == "irrelevant":
        decision, reason = "question", "A question — nothing new to remember."
    elif label == "irrelevant":
        decision, reason = "discard", "Small talk or a one-off — not worth storing."
    elif label == "correction" and previous_answer and not extracted:
        decision, reason = "flag-previous", "Flags the sources behind the previous answer as unreliable for this question."
    elif conflict:
        decision, reason = "replace", f"Becomes the current value; “{conflict.with_text}” is kept as history, marked outdated."
    elif reinforce:
        decision, reason = "reinforce", "Already known — confirmed and strengthened."
    elif label == "temporary":
        decision, reason = "keep-temporarily", "Time-bound — kept until it no longer matters, then let go."
    else:
        if label == "correction":
            label = "important"
        decision = "store"
        reason = "Describes you — kept long-term." if label == "persistent" else "New knowledge — kept with high priority."

    return Classification(
        label=label,
        probs={c: round(probs[c], 4) for c in CLASSES},
        spans=collect_spans(text, topic),
        is_question=question,
        slot=topic.slot if topic else None,
        slot_label=topic.label if topic else None,
        value=extracted["value"] if extracted else None,
        scope=extracted.get("scope") if extracted else None,
        coref=coref,
        conflict=conflict,
        decision=decision,
        reason=reason,
        predictor=name,
        knowledge=pred.knowledge if pred else None,
    )


def user_confidence(text: str, cls: str, kind: str, has_value: bool) -> float:
    """Confidence for something the user just told us: 0.62 + 0.12 (specific value)
    + 0.08 (authority cue such as “department”/“circular”) = 0.82."""
    if kind == "profile":
        return 0.9
    if kind == "preference":
        return 0.92
    if cls == "temporary":
        return 0.85
    c = 0.62
    if has_value:
        c += 0.12
    if AUTHORITY.search(text):
        c += 0.08
    return round(c, 2)


def importance_for(cls: str, kind: str) -> float:
    if cls == "correction":
        return 0.9
    if cls == "important":
        return 0.85
    if cls == "temporary":
        return 0.5
    return 0.75 if kind == "preference" else 0.7


__all__ = [
    "CUES",
    "SLOTS",
    "Prediction",
    "TextPredictor",
    "classify",
    "current_for_slot",
    "current_value",
    "importance_for",
    "user_confidence",
]
