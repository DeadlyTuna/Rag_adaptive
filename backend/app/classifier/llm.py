"""LLM memory classifier: ask the model for a structured verdict.

The brief suggests starting with an LLM classifier and comparing it with a trained
one — `python -m ml.compare_classifiers` scores rules vs. scikit-learn vs. this on the
same held-out sentences.
"""

from __future__ import annotations

from ..schemas import CLASSES
from ..slots import SLOTS
from . import Prediction

SYSTEM = """You decide whether a student's message to a university study assistant contains something worth remembering, and how.

Classes:
- persistent: describes the student long-term — name, department, year, their own attendance or grades, answer-style preferences ("I prefer concise answers").
- important: new knowledge about the world worth keeping — a rule, deadline, announcement, what a professor or office said.
- correction: replaces something the assistant believed or said — "actually it's 80% now", "the curfew was changed to 10 pm", "your previous answer was wrong".
- temporary: true only for a short while — "I have an exam tomorrow", "I'm in the library right now".
- irrelevant: nothing to keep — questions, greetings, thanks, small talk, arithmetic, jokes, weather.

Any question is irrelevant (asking is not telling).

Also return:
- is_question: true if the message asks something.
- slot: the topic the message states a value for, one of the listed slot ids, or "none".
- value: the stated value normalised like "80%", "10 pm", "concise", "Harsh", or "" if none.
- knowledge: the fact to store as one short sentence in the third person ("DBMS lab record deadline moved to Friday of week 12"), or "" for irrelevant.
- confidence: 0–1, how sure you are of the class.
- reason: a few words."""

SCHEMA = {
    "type": "object",
    "properties": {
        "label": {"type": "string", "enum": CLASSES},
        "confidence": {"type": "number"},
        "is_question": {"type": "boolean"},
        "slot": {"type": "string", "enum": [s.slot for s in SLOTS] + ["none"]},
        "value": {"type": "string"},
        "knowledge": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["label", "confidence", "is_question", "slot", "value", "knowledge", "reason"],
    "additionalProperties": False,
}


def _slot_list() -> str:
    return "\n".join(f"- {s.slot}: {s.label}" for s in SLOTS)


class LLMPredictor:
    name = "llm"

    def __init__(self, llm) -> None:
        self.llm = llm

    async def apredict(self, text: str) -> Prediction:
        out = await self.llm.complete_json(SYSTEM + "\n\nSlot ids:\n" + _slot_list(), f"Message: {text.strip()}", SCHEMA)
        label = out.get("label") if out.get("label") in CLASSES else "irrelevant"
        conf = min(0.97, max(0.4, float(out.get("confidence", 0.8))))
        rest = (1 - conf) / (len(CLASSES) - 1)
        probs = {c: (conf if c == label else rest) for c in CLASSES}
        slot = out.get("slot")
        return Prediction(
            probs=probs,
            slot=None if slot in (None, "", "none") else slot,
            value=out.get("value") or None,
            knowledge=out.get("knowledge") or None,
            is_question=out.get("is_question"),
        )


class Precomputed:
    """Wraps an already-awaited prediction so the synchronous classify() can use it."""

    def __init__(self, name: str, prediction: Prediction) -> None:
        self.name = name
        self.prediction = prediction

    def predict(self, text: str) -> Prediction:
        return self.prediction
