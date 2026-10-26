"""Novelty 6 — knowing when not to answer.

Every answer to a question gets a confidence from the evidence behind it:

    confidence = 0.55 · relevance   how well the best item matches  (similarity 0.2 → 0, 0.7 → 1)
               + 0.30 · trust       its confidence × reliability (the C factor)
               + 0.15 · decisiveness its lead over the runner-up     (score gap 0 → 0, 0.1 → 1)

and one of three modes:

  answer   the usual
  clarify  the answer depends on something the system doesn't know — e.g. the rule
           differs by department and the student hasn't said which one they're in.
           It asks, and shows what each option would mean, instead of guessing.
  abstain  an open question with nothing relevant behind it: it says so instead of
           stitching an answer out of loosely related passages.
"""

from __future__ import annotations

from typing import Optional

from ..schemas import Answerability, Classification, Retrieval, View, World, doc_department
from ..slots import slot_def
from ..util import r2

ABSTAIN_BELOW = 0.45  # open questions with less confidence than this are not answered
MIN_RELEVANCE = 0.3  # nor are ones whose best match is less similar than this

TOPIC = {
    "am-i-eligible": "attendance.minimum",
    "fat-eligibility": "attendance.minimum",
    "attendance-minimum": "attendance.minimum",
    "pass-marks": "pass.marks",
    "library-hours": "library.hours",
    "curfew": "hostel.curfew",
}


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def scoped_variants(world: World, slot: str) -> list[tuple[str, str, str]]:
    """(department, value, item id) for every department-specific value of a slot."""
    out: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for m in world.memories:
        if m.slot == slot and m.applies_to and m.value and m.status == "current" and world.visible(m) and m.applies_to not in seen:
            seen.add(m.applies_to)
            out.append((m.applies_to, m.value, m.id))
    for c in world.chunks:
        for cl in c.claims:
            dept = doc_department(world, c.doc_id) if cl.slot == slot and cl.scope else None
            if dept and dept not in seen:
                seen.add(dept)
                out.append((dept, cl.value, c.id))
    return out


def general_value(world: World, slot: str) -> Optional[tuple[str, str]]:
    """(value, item id) of the rule that applies when no department rule does."""
    for m in world.memories:
        if m.slot == slot and not m.applies_to and m.value and m.status == "current" and world.visible(m):
            return m.value, m.id
    for c in world.chunks:
        for cl in c.claims:
            if cl.slot == slot and not cl.scope:
                return cl.value, c.id
    return None


def assess(world: World, cls: Classification, intent: str, retrieval: Retrieval, view: Optional[View]) -> Optional[Answerability]:
    if not cls.is_question:
        return None
    if intent == "arithmetic":
        return Answerability(confidence=1.0, mode="answer", reasons=["Arithmetic — no sources needed"])
    slot = TOPIC.get(intent) or cls.slot
    d = slot_def(slot)
    if slot and d and not d.user and view and view.scoped and view.target is None:
        variants = scoped_variants(world, slot)
        if variants:
            depts = ", ".join(v[0] for v in variants)
            return Answerability(
                confidence=0.5,
                mode="clarify",
                reasons=[f"{d.label} differs by department ({depts} has its own rule)", "I don't know which department you're in"],
            )
    cands = retrieval.candidates
    if not cands:
        if intent == "generic":
            return Answerability(confidence=0.0, mode="abstain", reasons=["Nothing in the documents or memories matched"])
        return Answerability(confidence=0.0, mode="answer", reasons=["Nothing stored about this yet — the answer says what's missing"])
    top = cands[0]
    second = cands[1] if len(cands) > 1 else None
    relevance = _clamp((top.factors.S - 0.2) / 0.5)
    trust = top.factors.C
    decisiveness = _clamp((top.score - second.score) / 0.1) if second else 1.0
    conf = r2(0.55 * relevance + 0.30 * trust + 0.15 * decisiveness)
    reasons = [
        f"Best evidence: {top.title} (similarity {top.factors.S:.2f}, trust {trust:.2f})",
        f"Lead over the next item: {top.score - second.score:+.3f}" if second else "No competing item",
    ]
    if intent == "generic" and (top.factors.S < MIN_RELEVANCE or conf < ABSTAIN_BELOW):
        reasons.append("An open question with weak evidence — better to say so than to guess")
        return Answerability(confidence=conf, mode="abstain", reasons=reasons)
    return Answerability(confidence=conf, mode="answer", reasons=reasons)


def clarify_text(world: World, slot: str) -> tuple[str, list[str]]:
    """The clarifying question, and the items it cites (in citation order)."""
    d = slot_def(slot)
    label = d.label.lower() if d else "the answer"
    cited: list[str] = []

    def cite(i: str) -> str:
        if i not in cited:
            cited.append(i)
        return f" [{cited.index(i) + 1}]"

    parts = [f"{dept} students: {value}{cite(i)}" for dept, value, i in scoped_variants(world, slot)]
    g = general_value(world, slot)
    if g:
        parts.append(f"everyone else: {g[0]}{cite(g[1])}")
    text = (
        f"Which department are you in? The {label} depends on it — " + "; ".join(parts) + ". "
        "Tell me (for example “I'm in CSE”) and I'll remember it for next time."
    )
    return text, cited


def abstain_text(retrieval: Retrieval) -> str:
    top = retrieval.candidates[0] if retrieval.candidates else None
    closest = f" The closest thing I found was {top.title} (similarity {top.factors.S:.2f}), which doesn't answer it." if top else ""
    return (
        "I don't have reliable information about that, so I'd rather not guess." + closest + " "
        "Add a document on the Knowledge page, or tell me the answer and I'll remember it."
    )
