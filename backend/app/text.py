"""Text normalisation shared by the hashed embedder and the classifier.

A direct port of frontend/lib/engine/text.ts — small, deterministic, tuned for the
university-regulations domain.
"""

from __future__ import annotations

import re

PHRASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bfinal assessment tests?\b"), " fat "),
    (re.compile(r"\bcontinuous assessment tests?\b"), " cat "),
    (re.compile(r"\bhall[- ]tickets?\b"), " hallticket "),
    (re.compile(r"\badmit[- ]cards?\b"), " hallticket "),
    (re.compile(r"\bstep[- ]by[- ]step\b"), " stepbystep "),
    (re.compile(r"\bre[- ]?exam(ination)?s?\b"), " reexam "),
    (re.compile(r"\bmake[- ]?up\b"), " makeup "),
    (re.compile(r"\bin[- ]time\b"), " curfew "),
    (re.compile(r"\blast date\b"), " deadline "),
    (re.compile(r"\bend[- ]sem(ester)?\b"), " fat "),
    (re.compile(r"\bsmart ?watch(es)?\b"), " smartwatch "),
    (re.compile(r"(\d+(?:\.\d+)?)\s*%"), r" \1 percent "),
]

STOP = set(
    (
        "the a an is are was were be been being to of and or in on for with what whats which who whom how do does did "
        "doing i me my mine you your yours it its that this these those can could would should will shall may might am "
        "at by from as so if then than there here their they them we our us he she his her about into up out any all "
        "some just also please tell know get got go going much many more most very really thing things one ones each "
        "every only other own same such nor too don dont now when where why let lets im ive id youre theyre isnt arent "
        "wasnt werent hasnt havent doesnt didnt cant couldnt wont wouldnt shouldnt ok okay hi hello hey thanks thank yes "
        "yeah yep sure actually so well hmm oh like just still even again ever"
    ).split()
)

SYN: dict[str, str] = {}


def _syn(canon_word: str, words: str) -> None:
    for w in words.split():
        SYN[w] = canon_word


_syn("attendance", "attendance attend attended attending presence present")
_syn("require", "minimum min least required requirement requirements require need needed needs mandatory must")
_syn("fat", "fat fats final finals endsem")
_syn("cat", "cat cats")
_syn("eligible", "eligible eligibility allowed allow qualify qualified write writing sit appear")
_syn("exam", "exam exams examination examinations test tests assessment assessments quiz quizzes")
_syn("pass", "pass passing passed")
_syn("marks", "mark marks score scores scored scoring")
_syn("grade", "grade grades grading gpa cgpa")
_syn("fee", "fee fees payment pay paid dues")
_syn("deadline", "deadline deadlines due")
_syn("library", "library libraries")
_syn("hours", "hours hour timing timings open opens close closes closing closed")
_syn("hostel", "hostel hostels dorm")
_syn("curfew", "curfew return late")
_syn("department", "department departments dept branch")
_syn("debar", "debar debarred barred detained detention")
_syn("condone", "condonation condone condoned medical")
_syn("percent", "percent percentage")
_syn("prefer", "prefer preference preferences want")
_syn("concise", "concise short shorter brief briefly")
_syn("detailed", "detailed detail stepbystep steps step elaborate explanation explanations")
_syn("name", "name called")
_syn("reexam", "reexam supplementary arrear arrears")
_syn("makeup", "makeup")
_syn("hallticket", "hallticket")
_syn("calculator", "calculator calculators")
_syn("mess", "mess food breakfast lunch dinner meal meals")
_syn("visitor", "visitor visitors guest guests")
_syn("lab", "lab labs laboratory practical practicals record records viva")
_syn("project", "project projects review reviews")
_syn("semester", "semester semesters sem")
_syn("credit", "credit credits")
_syn("malpractice", "malpractice cheating copying unauthorised")
_syn("result", "result results")
_syn("leave", "leave")
_syn("change", "changed change changes updated update revised raised increased lowered reduced moved extended")

# Generic tokens carry less meaning — down-weighted in the hashed embedding.
TOKEN_WEIGHT: dict[str, float] = {
    "exam": 0.6,
    "require": 0.5,
    "student": 0.35,
    "students": 0.35,
    "course": 0.4,
    "courses": 0.4,
    "semester": 0.5,
    "change": 0.35,
    "percent": 0.55,
    "marks": 0.8,
    "hours": 0.8,
    "university": 0.4,
}

_ES = re.compile(r"(ss|x|ch|sh)es$")


def stem(w: str) -> str:
    if len(w) > 5 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 4 and _ES.search(w):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def canon(word: str) -> str:
    if word in SYN:
        return SYN[word]
    s = stem(word)
    return SYN.get(s, s)


_SPLIT = re.compile(r"[^a-z0-9.]+")
_NUM = re.compile(r"^\d+(\.\d+)?$")


def tokens(text: str) -> list[str]:
    """Content tokens (canonicalised, stop-words removed). Numbers become `#80`."""
    t = text.lower().replace("’", "'").replace("‘", "'")
    for pattern, rep in PHRASES:
        t = pattern.sub(rep, t)
    t = t.replace("'", "")
    out: list[str] = []
    for raw in _SPLIT.split(t):
        w = raw.strip(".")
        if not w:
            continue
        if _NUM.match(w):
            out.append("#" + w)
            continue
        if w in STOP or len(w) < 2:
            continue
        out.append(canon(w))
    return out


_QUESTION_START = re.compile(
    r"^(what|whats|what's|when|where|which|who|whom|why|how|can|could|should|would|is|are|am|do|does|did|will|shall|may|tell me)\b"
)


def is_question(text: str) -> bool:
    t = text.strip().lower()
    if t.endswith("?"):
        return True
    return bool(_QUESTION_START.match(t))


# punctuation followed by a non-space (7.5, 9:30, e.g.) stays inside the sentence
_SENTENCE = re.compile(r"(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+|$)")


def sentences(text: str) -> list[str]:
    found = [s.strip() for s in _SENTENCE.findall(text)]
    found = [s for s in found if s]
    return found or [text]


def capitalise(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s
