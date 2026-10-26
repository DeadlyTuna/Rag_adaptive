"""Template answers — the no-LLM fallback (port of frontend/lib/engine/compose.ts).

Used when no LLM is configured (ANSWER_MODE=template, or no API key) and as the
safety net when an LLM call fails. It fills per-intent templates from the retrieved
context, cites every source it uses with [n], and honours remembered preferences
(concise vs step-by-step). The LLM path replaces the *wording*, not the pipeline.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Optional

from ..classifier import current_value
from ..learning import score_of
from ..memory_manager import fmt_day, fmt_weekday_time
from ..schemas import Candidate, Citation, Classification, MemoryOp, Retrieval, World
from ..text import sentences
from ..util import r3

DOC_ATT = "regs-3.1"
DOC_CONDONE = "regs-3.2"
DOC_DEBAR = "regs-3.3"
DOC_ELIG = "regs-4.3"
DOC_PASS = "regs-5.1"
DOC_SCHED = "exams-6"
DOC_LIB = "regs-9.1"
DOC_CURFEW = "hostel-1"

ARITH = re.compile(r"(-?\d+(?:\.\d+)?)\s*([+\-*x×/])\s*(-?\d+(?:\.\d+)?)")


@dataclass
class Composed:
    text: str
    citations: list[Citation]
    intent: str
    topic: Optional[str] = None
    lookups: list[Candidate] = field(default_factory=list)


def _num(v: Optional[str]) -> float:
    m = re.search(r"\d+(\.\d+)?", v or "")
    return float(m.group(0)) if m else float("nan")


def _fmt_num(r: float) -> str:
    return str(int(r)) if float(r).is_integer() else f"{r:.2f}"


def detect_intent(text: str, cls: Classification) -> str:
    """Intent routing shared with the LLM path (the frontend uses the intent to decide
    whether to show feedback buttons and what the conversation's topic is)."""
    t = text.strip()
    if not cls.is_question:
        return {
            "replace": "ack-correction",
            "store": "ack-knowledge",
            "keep-temporarily": "ack-temporary",
            "reinforce": "ack-reinforce",
            "flag-previous": "ack-flag",
        }.get(cls.decision) or (
            "greeting" if re.match(r"^\s*(hi|hello|hey)\b", t, re.I) else "thanks" if re.match(r"^\s*(thanks|thank you)\b", t, re.I) else "ack-discard"
        )
    if ARITH.search(t):
        return "arithmetic"
    if re.search(r"\b(what'?s|what is) my name\b|\bwho am i\b", t, re.I):
        return "name"
    if re.search(r"\bwhat'?s my attendance\b|\bwhat is my attendance\b", t, re.I):
        return "my-attendance"
    about_fat = re.search(r"\b(fat|final assessment|finals?)\b", t, re.I)
    if about_fat and re.search(r"\b(am i (eligible|allowed)|can i (write|sit|appear))\b", t, re.I) and not re.match(r"^\s*when\b", t, re.I):
        return "am-i-eligible"
    if about_fat:
        return "fat-eligibility"
    if re.search(r"\battendance\b", t, re.I) and not re.search(r"\bmy attendance\b", t, re.I):
        return "attendance-minimum"
    if re.search(r"\bpass(ing)?\b", t, re.I) and re.search(r"\bmarks?|score\b", t, re.I):
        return "pass-marks"
    if re.search(r"\blibrary\b", t, re.I):
        return "library-hours"
    if re.search(r"\b(curfew|in-?time|back (to|in) the hostel|hostel)\b", t, re.I) and re.search(r"\b(time|when|by|curfew|late)\b", t, re.I):
        return "curfew"
    return "generic"


def compose(
    world: World,
    user_text: str,
    cls: Classification,
    retrieval: Retrieval,
    ops: list[MemoryOp],
    now: int,
    sim: Callable[[str, str], float],
    candidate_for: Callable[[str], Optional[Candidate]],
) -> Composed:
    order: list[str] = []

    def cite(item_id: Optional[str]) -> str:
        if not item_id:
            return ""
        if not (world.chunk(item_id) or world.memory(item_id)):
            return ""
        if item_id not in order:
            order.append(item_id)
        return f" [{order.index(item_id) + 1}]"

    mem = world.current_memory
    style_m = mem("user.style")
    style = style_m.value if style_m else None
    t = user_text.strip()

    req_mem = mem("attendance.minimum")
    req_val = current_value(world, "attendance.minimum") or "75%"
    att_chunk = world.chunk(DOC_ATT)
    doc_val = next((c.value for c in (att_chunk.claims if att_chunk else []) if c.slot == "attendance.minimum"), None) or "75%"
    req_src = req_mem.id if req_mem else DOC_ATT
    req_is_learned = bool(req_mem) and req_mem.value != doc_val
    dept_rule = "your department's" if req_is_learned else "the"

    intent = "generic"

    def finish(body: str, why: str, topic: Optional[str] = None) -> Composed:
        citations = [Citation(n=i + 1, item_id=item_id) for i, item_id in enumerate(order)]
        have = {c.id for c in retrieval.candidates}
        lookups: list[Candidate] = []
        for item_id in order:
            if item_id in have:
                continue
            cand = candidate_for(item_id)
            if not cand:
                continue
            cand.score = r3(score_of(cand.factors, retrieval.weights))
            cand.note = cand.note or "Looked up by topic"
            lookups.append(cand)
        return Composed(text=body.strip(), citations=citations, intent=why, topic=topic, lookups=lookups)

    def ack() -> Optional[str]:
        nonlocal intent
        if not ops:
            return None
        op = ops[0]
        m = world.memory(op.memory_id) if op.memory_id else None
        prev = world.memory(op.previous_id) if op.previous_id else None
        novel = _novelty_ack(op, m, prev, cite)
        if novel:
            intent, text = novel
            return text
        if cls.decision == "replace":
            if not m:
                return None
            if m.kind == "preference":
                intent = "ack-preference"
                if m.value == "concise":
                    return (
                        f"Noted — I'll keep answers short and to the point from now on{cite(m.id)}. "
                        f"Your earlier preference for {m.previous_value} answers is kept as history{cite(prev.id if prev else None)}."
                    )
                return f"Noted — I'll use {m.value} answers from now on{cite(m.id)}."
            if m.kind == "profile":
                intent = "ack-profile"
                return f"Updated — {m.label.lower()} is now {m.value} (it was {m.previous_value}){cite(m.id)}."
            intent = "ack-correction"
            frm = cls.conflict
            where = frm.with_source if frm and frm.with_kind == "document" else "what I had before"
            if m.applies_to:
                # a department's exception (novelty 1): the general rule still stands for everyone else
                new_cite = cite(m.id)
                old_cite = cite(frm.with_id if frm and frm.with_kind == "document" else (prev.id if prev else None))
                return (
                    f"Got it — for {m.applies_to}, {m.label.lower()} is now {m.value}{new_cite}. "
                    f"The general {m.previous_value} from {where}{old_cite} still applies to other departments; your answers will use {m.value}."
                )
            new_cite = cite(m.id)  # numbered first, as it reads
            old_cite = cite(frm.with_id if frm and frm.with_kind == "document" else (prev.id if prev else None))
            return (
                f"Got it — {m.label.lower()} is now {m.value}{' for your department' if m.scope else ''}{new_cite}. "
                f"I've marked the earlier {m.previous_value} from {where} as outdated{old_cite}, so future answers will use {m.value}."
            )
        if cls.decision == "store":
            if not m:
                return None
            if m.kind == "profile":
                intent = "ack-profile"
                what = f"your attendance is {m.value}" if m.label == "Your attendance" else m.text.lower()
                return f"Thanks — I'll remember that {what}{cite(m.id)}."
            if m.kind == "preference":
                intent = "ack-preference"
                return f"Noted — I'll keep that in mind for every answer{cite(m.id)}."
            intent = "ack-knowledge"
            return f"Noted. I'll keep this with high priority{cite(m.id)}: “{m.text}”."
        if cls.decision == "keep-temporarily":
            if not m:
                return None
            intent = "ack-temporary"
            return f"Good luck! I'll keep that in mind until {fmt_weekday_time(m.expires_at or now)}, then let it go{cite(m.id)}."
        if cls.decision == "reinforce":
            intent = "ack-reinforce"
            return f"I already had that — I've marked it as confirmed{cite(op.memory_id or op.previous_id)}."
        if cls.decision == "flag-previous":
            intent = "ack-flag"
            if not op.subject:
                return "There's no earlier answer to flag yet — ask me something first."
            return f"Thanks for flagging it. I've lowered my trust in {op.subject}{cite(op.previous_id)} for questions like that. What's the correct information? I'll remember it."
        return None

    # ------------------------------------------------------------- statements
    if not cls.is_question:
        a = ack()
        if a:
            return finish(a, intent)
        if re.match(r"^\s*(hi|hello|hey)\b", t, re.I):
            return finish("Hi! Ask me about attendance, exams or hostel rules — or tell me something I should remember.", "greeting")
        if re.match(r"^\s*(thanks|thank you)\b", t, re.I):
            return finish("You're welcome.", "thanks")
        return finish("Noted — that's not something I need to remember, so I haven't stored it.", "ack-discard")

    # ------------------------------------------------------------- questions
    arith = ARITH.search(t)
    if arith:
        a, op, b = float(arith.group(1)), arith.group(2), float(arith.group(3))
        r = a + b if op == "+" else a - b if op == "-" else (a / b if b else float("nan")) if op == "/" else a * b
        return finish(f"{_fmt_num(r)}. That's not something I need to remember, so I didn't store it.", "arithmetic")

    if re.search(r"\b(what'?s|what is) my name\b|\bwho am i\b", t, re.I):
        m = mem("user.name")
        return finish(f"You're {m.value}{cite(m.id)}." if m else "You haven't told me your name yet.", "name")

    if re.search(r"\bwhat'?s my attendance\b|\bwhat is my attendance\b", t, re.I):
        m = mem("user.attendance")
        return finish(f"You told me your attendance is {m.value}{cite(m.id)}." if m else "You haven't told me your attendance yet.", "my-attendance")

    about_fat = bool(re.search(r"\b(fat|final assessment|finals?)\b", t, re.I))

    if about_fat and re.search(r"\b(am i (eligible|allowed)|can i (write|sit|appear))\b", t, re.I) and not re.match(r"^\s*when\b", t, re.I):
        ua = mem("user.attendance")
        if not ua:
            text = (
                f"You're eligible if your attendance is at least {req_val}{cite(req_src)} and you've attempted at least one CAT{cite(DOC_ELIG)}. "
                "Tell me your current attendance and I'll check."
            )
        elif _num(ua.value) >= _num(req_val):
            text = (
                f"Yes — your attendance of {ua.value}{cite(ua.id)} meets {dept_rule} {req_val} minimum{cite(req_src)}. "
                f"As long as you've attempted at least one CAT{cite(DOC_ELIG)}, you can write the FAT."
            )
        else:
            would_have = req_is_learned and _num(ua.value) >= _num(doc_val)
            if style == "concise":
                text = f"Not yet. Your {ua.value}{cite(ua.id)} is below {dept_rule} {req_val} minimum{cite(req_src)}, so you'd be debarred from the FAT{cite(DOC_DEBAR)}."
            elif style == "step-by-step":
                rule_note = f", your department's rule rather than the university's {doc_val}" if req_is_learned else ""
                text = (
                    "Not yet — here's the check:\n"
                    f"1. Your attendance is {ua.value}{cite(ua.id)}.\n"
                    f"2. The minimum is {req_val}{cite(req_src)}{rule_note}.\n"
                    f"3. {ua.value} is below {req_val}, so you'd be debarred from the FAT{cite(DOC_DEBAR)} unless you raise it or get medical condonation{cite(DOC_CONDONE)}."
                )
            else:
                text = (
                    f"Not yet. Your attendance is {ua.value}{cite(ua.id)}, below {dept_rule} {req_val} minimum{cite(req_src)}, "
                    f"so as things stand you'd be debarred from the FAT{cite(DOC_DEBAR)}."
                    + (f" Under the university's {doc_val} rule you would have qualified — the department's change is what rules you out." if would_have else "")
                    + f" If the shortfall is for medical reasons, you can apply for condonation through your HoD{cite(DOC_CONDONE)}."
                )
            if would_have and style == "step-by-step":
                text += f"\n(Under the university's {doc_val} rule you would have qualified — the department's change is what rules you out.)"
        return finish(text, "am-i-eligible", "attendance.minimum")

    if about_fat:
        sched = DOC_SCHED if any(c.id == DOC_SCHED for c in retrieval.candidates) else None
        if style == "concise":
            text = (
                f"Once you have at least {req_val} attendance in the course{cite(req_src)} and have attempted one CAT{cite(DOC_ELIG)}."
                + (f" FATs start on 17 November{cite(sched)}." if sched else "")
            )
        elif style == "step-by-step":
            req_cite = cite(req_src)  # numbered in reading order
            learned = f" — your department's rule, not the university's {doc_val}{cite(DOC_ATT)}" if req_is_learned else ""
            text = (
                "You can write a course's FAT when both conditions are met:\n"
                f"1. Attendance of at least {req_val} in that course{req_cite}{learned}.\n"
                f"2. At least one of CAT-1 and CAT-2 attempted{cite(DOC_ELIG)}."
                + (f"\nThis semester's FATs start on 17 November{cite(sched)}." if sched else "")
            )
        else:
            dept_note = " (your department's rule)" if req_is_learned else ""
            text = (
                f"You can write a course's FAT once you have at least {req_val} attendance in it{cite(req_src)}"
                f"{dept_note} and have attempted at least one CAT{cite(DOC_ELIG)}."
                + (f" This semester's FATs start on 17 November{cite(sched)}." if sched else "")
            )
        return finish(text, "fat-eligibility", "fat.eligibility")

    if re.search(r"\battendance\b", t, re.I) and not re.search(r"\bmy attendance\b", t, re.I):
        if req_is_learned and req_mem:
            if style == "concise":
                text = f"{req_val} — your department's rule{cite(req_mem.id)}, which replaces the university's {doc_val}{cite(DOC_ATT)}."
            elif style == "step-by-step":
                who = "You told me your department raised it" if req_mem.source.type == "user" else f"{req_mem.source.label} raised it"
                text = (
                    "Here's how it works out:\n"
                    f"1. The university regulation sets the minimum at {doc_val}{cite(DOC_ATT)}.\n"
                    f"2. {who} to {req_val}{cite(req_mem.id)}, so I treat {req_val} as the current rule.\n"
                    f"3. You need at least {req_val} in every course — theory and lab are counted separately."
                )
            else:
                text = (
                    f"The minimum attendance is {req_val}{cite(req_mem.id)} — your department's rule, which replaces the university's "
                    f"{doc_val}{cite(DOC_ATT)}. Theory and lab attendance are counted separately."
                )
        elif style == "concise":
            text = f"{req_val} in every course{cite(DOC_ATT)}."
        elif style == "step-by-step":
            text = (
                f"1. The minimum attendance is {req_val} in every course{cite(DOC_ATT)}.\n"
                "2. Theory and lab attendance are counted separately.\n"
                f"3. Below the minimum, you're debarred from that course's FAT{cite(DOC_DEBAR)}."
            )
        else:
            text = f"The minimum attendance requirement is {req_val} in every course{cite(DOC_ATT)}. If you fall below it, you're debarred from that course's FAT{cite(DOC_DEBAR)}."
        return finish(text, "attendance-minimum", "attendance.minimum")

    if re.search(r"\bpass(ing)?\b", t, re.I) and re.search(r"\bmarks?|score\b", t, re.I):
        top = retrieval.candidates[0] if retrieval.candidates else None
        m = mem("pass.marks")
        if m:
            text = f"The pass mark is now {m.value}{cite(m.id)} — {_learned_from(m)}; the regulations say 50 out of 100{cite(DOC_PASS)}. You also need at least 40 in the FAT."
        elif top and top.id != DOC_PASS and top.kind == "document":
            # answer from the top-ranked passage — so a bad ranking shows up as a bad answer
            text = f"{_best_sentence(top.text, t, sim)}{cite(top.id)}"
        else:
            text = (
                f"50 out of 100 overall, with at least 40 in the FAT{cite(DOC_PASS)}."
                if style == "concise"
                else f"You need at least 50 out of 100 in the course total and at least 40 out of 100 in the FAT{cite(DOC_PASS)}."
            )
        return finish(text, "pass-marks", "pass.marks")

    if re.search(r"\blibrary\b", t, re.I):
        m = mem("library.hours")
        if m:
            hours = re.sub(r"^closes\b", "closes at", m.value or "")
            text = (
                f"On weekdays the library now {hours}{cite(m.id)} — you told me it changed; "
                f"the regulations still say 8 am to 8 pm{cite(DOC_LIB)}. On Saturdays it's open 9 am to 5 pm."
            )
        else:
            text = f"The central library is open 8 am to 8 pm on weekdays and 9 am to 5 pm on Saturdays{cite(DOC_LIB)}."
        return finish(text, "library-hours", "library.hours")

    if re.search(r"\b(curfew|in-?time|back (to|in) the hostel|hostel)\b", t, re.I) and re.search(r"\b(time|when|by|curfew|late)\b", t, re.I):
        m = mem("hostel.curfew")
        if m:
            text = f"Residents now need to be back in the hostel by {m.value}{cite(m.id)} — {_learned_from(m)}; the hostel handbook says 9:30 pm{cite(DOC_CURFEW)}."
        else:
            text = f"Residents need to be back in the hostel by 9:30 pm every day{cite(DOC_CURFEW)}."
        return finish(text, "curfew", "hostel.curfew")

    # ------------------------------------------------------------- generic
    top = [c for c in retrieval.candidates if c.factors.S >= 0.3]
    if not top:
        return finish(
            "I couldn't find that in the documents or in what you've told me. Add a document on the Knowledge page, or tell me the answer and I'll remember it.",
            "no-answer",
        )
    parts = []
    for c in top[: 1 if style == "concise" else 2]:
        s = f"You told me: {c.title}." if c.kind == "memory" else _best_sentence(c.text, t, sim)
        parts.append(f"{s}{cite(c.id)}")
    if style == "step-by-step" and len(parts) > 1:
        text = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(parts))
    else:
        text = " ".join(parts)
    return finish(text, "generic")


def _learned_from(m) -> str:
    return "you told me it changed" if m.source.type == "user" else f"according to {m.source.label}"


def _novelty_ack(op: MemoryOp, m, prev, cite: Callable[[Optional[str]], str]) -> Optional[tuple[str, str]]:
    """Acknowledgements for what only the novelties do: hold a correction for
    verification (3), schedule a future change (1), corroborate another student (8)."""
    if not m:
        return None
    if op.kind == "quarantine" and m.verification:
        v = m.verification
        return "ack-quarantine", (
            f"I've noted that you say {m.label.lower()} is {m.value}{cite(m.id)}, but that contradicts {op.subject or 'the documents'}"
            f"{cite(v.against)}, which says {v.against_value}. Until a document or another student confirms the change, I'll keep using {v.against_value}."
        )
    if op.kind == "schedule" and m.valid_from:
        text = f"Noted — from {fmt_day(m.valid_from)}: {m.text}{cite(m.id)}."
        if prev:
            text += f" Until then, what I had before still applies: {prev.text}{cite(prev.id)}."
        elif m.previous_value:
            text += f" Until then, {m.previous_value} still applies."
        return "ack-schedule", text
    if op.kind == "corroborate":
        n = len(m.reporters or [])
        if m.shared:
            where = f" in {m.applies_to}" if m.applies_to else ""
            return "ack-corroborate", f"Thanks — {n} students have now told me this, so it's confirmed and shared with everyone{where}: {m.text}{cite(m.id)}."
        return "ack-corroborate", f"Thanks — that matches what another student told me{cite(m.id)}. Once enough students confirm it, I'll share it with everyone."
    return None


def _best_sentence(text: str, query: str, sim: Callable[[str, str], float]) -> str:
    ss = sentences(text)
    best, best_s = (ss[0] if ss else text), -1.0
    for s in ss:
        v = sim(query, s)
        if v > best_s:
            best_s, best = v, s
    return best.rstrip()
