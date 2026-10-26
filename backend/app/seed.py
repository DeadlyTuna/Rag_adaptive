"""The starting world: four indexed documents plus six weeks of "earlier sessions".

Memories learned, one fact corrected (library hours), one preference changed
(bullet points → step-by-step), one temporary memory expired, and nine rounds of
feedback that shaped the ranking weights — so the dashboard has a history on day one.

Mirrors frontend/lib/engine/seed.ts so the live backend and the in-browser demo start
from the same story. Map positions are computed by the engine from real embeddings.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .forgetting import DAY, HOUR
from .knowledge_base import SourceDocument, chunks_for, doc_meta_for
from .schemas import ActivityEvent, Memory, Source, UserProfile, WeightPoint, Weights, World

WORLD_VERSION = 4
SEED_DIR = Path(__file__).resolve().parent.parent / "seed"


@lru_cache(maxsize=1)
def corpus() -> dict:
    return json.loads((SEED_DIR / "corpus.json").read_text(encoding="utf-8"))


def seed_documents() -> list[SourceDocument]:
    return [SourceDocument.from_json(d) for d in corpus()["documents"]]


def sample_circular() -> SourceDocument:
    return SourceDocument.from_json(corpus()["sample"])


def _mulberry(seed: int):
    """mulberry32 — the same PRNG the frontend uses, so the seeded history matches."""
    state = seed & 0xFFFFFFFF

    def imul(a: int, b: int) -> int:
        return (a * b) & 0xFFFFFFFF

    def rnd() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = imul(state ^ (state >> 15), 1 | state)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


def create_world(now: int) -> World:
    def d(days: float, hours: float = 0) -> int:
        return round(now - days * DAY - hours * HOUR)

    documents, chunks = [], []
    index_days = {"regs": 45, "exams": 45, "hostel": 44, "cse": 43}
    for doc in seed_documents():
        at = d(index_days.get(doc.id, 45), 3)
        cs = chunks_for(doc, at)
        chunks.extend(cs)
        documents.append(doc_meta_for(doc, at, cs))

    # reliability learned from earlier feedback
    rel = {"hostel-2": 0.85, "regs-9.1": 0.85, "regs-5.2": 0.85, "exams-3": 0.88, "cse-3": 0.85}
    for c in chunks:
        if c.id in rel:
            c.reliability = rel[c.id]

    def mem(**kw) -> Memory:
        base = dict(slot=None, source=Source(type="user", label="You"), confidence=0.9, importance=0.7, reliability=1.0, status="current", pinned=False, uses=[])
        base.update(kw)
        base.setdefault("last_used_at", base["created_at"])
        return Memory(**base)

    memories = [
        mem(id="mem-name", slot="user.name", label="Name", text="Name: Harsh", value="Harsh", cls="persistent", kind="profile",
            utterance="My name is Harsh.", created_at=d(41, 5), uses=[d(30), d(12), d(3)]),
        mem(id="mem-dept", slot="user.department", label="Department", text="Studies CSE, semester 3", value="CSE", cls="persistent",
            kind="profile", utterance="I'm in CSE, third semester.", created_at=d(41, 4), uses=[d(20), d(6)]),
        mem(id="mem-courses", label="Courses", text="Taking DBMS, Operating Systems and COA this semester", cls="persistent", kind="profile",
            utterance="This semester I'm taking DBMS, OS and COA.", created_at=d(40, 20), uses=[d(9)]),
        mem(id="mem-style-old", slot="user.style", label="Answer style", text="Prefers answers as bullet points", value="bullet points",
            cls="persistent", kind="preference", confidence=0.92, importance=0.75, utterance="I like answers as bullet points.",
            created_at=d(40, 2), status="outdated", superseded_by="mem-style", superseded_at=d(38, 6)),
        mem(id="mem-style", slot="user.style", label="Answer style", text="Prefers step-by-step explanations", value="step-by-step",
            previous_value="bullet points", supersedes="mem-style-old", cls="persistent", kind="preference", confidence=0.92,
            importance=0.75, utterance="I prefer step-by-step explanations, please.", created_at=d(38, 6),
            uses=[d(30), d(21), d(12), d(5), d(2)]),
        mem(id="mem-hostel", label="Residence", text="Lives in hostel block C", cls="persistent", kind="profile",
            utterance="I stay in block C of the hostel.", created_at=d(35, 8), uses=[d(16)]),
        mem(id="mem-library", slot="library.hours", label="Library hours", text="Library closes at 10 pm on weekdays", value="closes 10 pm",
            previous_value="8 am – 8 pm", supersedes="chunk:regs-9.1", cls="correction", kind="fact", confidence=0.78, importance=0.9,
            utterance="Actually, the library closes at 10 pm on weekdays now.", created_at=d(27, 3), uses=[d(15)]),
        mem(id="mem-cat2", label="CAT-2 marks", text="CAT-2 marks are published on the student portal", cls="important", kind="fact",
            confidence=0.7, importance=0.85, utterance="Prof. Rao said CAT-2 marks will be on the student portal.", created_at=d(19, 2),
            uses=[d(10)]),
        mem(id="mem-lab-deadline", label="Lab record deadline", text="DBMS lab record deadline moved to Friday of week 12", cls="important",
            kind="fact", confidence=0.74, importance=0.85,
            utterance="The professor changed the DBMS lab record deadline to Friday of week 12.", created_at=d(12, 7), uses=[d(4)]),
        mem(id="mem-viva", slot="event.exam", label="Upcoming exam", text="OS lab viva today", value="OS viva today", cls="temporary",
            kind="event", confidence=0.85, importance=0.5, utterance="I have an OS lab viva today.", created_at=d(9, 6),
            expires_at=d(8, 6), status="expired", expired_at=d(8, 6)),
    ]
    for m in memories:
        m.last_used_at = max([m.created_at, *m.uses])

    # the library correction overrides the regulation's claim for that slot
    lib = next((c for c in chunks if c.id == "regs-9.1"), None)
    if lib:
        lib.overridden_by = {"library.hours": "mem-library"}

    W = lambda s, r, c, i: Weights(S=s, R=r, C=c, I=i)  # noqa: E731
    weight_history = [
        WeightPoint(at=d(45), weights=W(0.4, 0.2, 0.2, 0.2), label="Initial weights"),
        WeightPoint(at=d(33, 4), weights=W(0.42, 0.19, 0.2, 0.19), label="Wrong source: Hostel Handbook §2 for a library question"),
        WeightPoint(at=d(29, 2), weights=W(0.42, 0.18, 0.21, 0.19), label="Helpful: FAT eligibility answer"),
        WeightPoint(at=d(24, 6), weights=W(0.41, 0.2, 0.22, 0.17), label="Outdated: Regulations §9.1 library hours"),
        WeightPoint(at=d(18, 1), weights=W(0.44, 0.19, 0.22, 0.15), label="Wrong source: Regulations §5.2 for a pass-mark question"),
        WeightPoint(at=d(14, 3), weights=W(0.44, 0.18, 0.23, 0.15), label="Helpful: re-examination deadline"),
        WeightPoint(at=d(9, 5), weights=W(0.45, 0.17, 0.23, 0.15), label="Wrong source: Exam Guidelines §3 for a hall-ticket question"),
        WeightPoint(at=d(6, 2), weights=W(0.45, 0.16, 0.24, 0.15), label="Helpful: lab record deadline"),
        WeightPoint(at=d(4, 8), weights=W(0.44, 0.16, 0.25, 0.15), label="Wrong source: CSE Handbook §3 for an attendance question"),
        WeightPoint(at=d(2, 3), weights=W(0.45, 0.15, 0.25, 0.15), label="Helpful: condonation answer"),
    ]

    def ev(id_, type_, at, title, detail, ref=None):
        return ActivityEvent(id=id_, type=type_, at=at, title=title, detail=detail, ref_id=ref)

    events = [
        *[ev(f"ev-doc-{doc.id}", "document.indexed", doc.indexed_at, "Document indexed", f"{doc.title} · {len(doc.chunk_ids)} chunks", doc.id) for doc in documents],
        ev("ev-name", "memory.added", d(41, 5), "Profile learned", "Name: Harsh", "mem-name"),
        ev("ev-dept", "memory.added", d(41, 4), "Profile learned", "Studies CSE, semester 3", "mem-dept"),
        ev("ev-courses", "memory.added", d(40, 20), "Profile learned", "Taking DBMS, Operating Systems and COA", "mem-courses"),
        ev("ev-style-old", "memory.preference", d(40, 2), "Preference learned", "Prefers answers as bullet points", "mem-style-old"),
        ev("ev-style", "memory.replaced", d(38, 6), "Preference updated", "Bullet points → step-by-step explanations", "mem-style"),
        ev("ev-hostel", "memory.added", d(35, 8), "Profile learned", "Lives in hostel block C", "mem-hostel"),
        ev("ev-library", "memory.replaced", d(27, 3), "Previous fact corrected", "Library hours: 8 am – 8 pm → closes at 10 pm on weekdays", "mem-library"),
        ev("ev-cat2", "memory.added", d(19, 2), "New knowledge added", "CAT-2 marks are published on the student portal", "mem-cat2"),
        ev("ev-lab", "memory.added", d(12, 7), "New knowledge added", "DBMS lab record deadline moved to Friday of week 12", "mem-lab-deadline"),
        ev("ev-viva", "memory.added", d(9, 6), "Temporary memory kept", "OS lab viva today", "mem-viva"),
        ev("ev-viva-x", "memory.expired", d(8, 6), "Temporary memory expired", "OS lab viva today", "mem-viva"),
        *[ev(f"ev-w-{i}", "weights.updated", p.at, "Ranking weights updated", p.label) for i, p in enumerate(weight_history[1:])],
    ]
    events.sort(key=lambda e: e.at)

    # past queries: 47 over six weeks, denser recently
    rnd = _mulberry(42)
    queries = []
    for _ in range(47):
        u = rnd() ** 0.7
        queries.append(round(now - (1 - u) * 41 * DAY - rnd() * 6 * HOUR - 2 * HOUR))
    queries.sort()

    return World(
        version=WORLD_VERSION,
        seeded_at=now,
        documents=documents,
        chunks=chunks,
        memories=memories,
        turns=[],
        events=events,
        queries=queries,
        weights=weight_history[-1].weights.model_copy(),
        weight_history=weight_history,
        positions={},
        script_done=[],
        # the students of the multi-user mode (novelty 8); Harsh is the demo's student and
        # owns every seeded memory. Guest hasn't said which department they're in.
        users=[
            UserProfile(id="harsh", name="Harsh", department="CSE"),
            UserProfile(id="arjun", name="Arjun", department="CSE"),
            UserProfile(id="priya", name="Priya", department="ECE"),
            UserProfile(id="guest", name="Guest"),
        ],
    )
