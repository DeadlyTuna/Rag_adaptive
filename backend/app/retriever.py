"""Adaptive retriever: semantic search, then re-ranking on four signals.

    score = w1·S + w2·R + w3·C + w4·I

  S  semantic similarity   calibrated cosine between the question and the item
  R  recency               exp(−age / τ), τ = 30 days for memories, 365 days for documents
  C  confidence            confidence × reliability (reliability is learned from feedback)
  I  importance            from the memory class / document section

Stage 1 asks the vector store for the POOL nearest items (documents + current
memories). Stage 2 re-scores that pool with the learned weights and keeps TOP_K.
Outdated and expired memories are never used, but the closest ones are reported as
"filtered out" so you can see the system *chose* not to use them.

Port of frontend/lib/engine/retrieve.ts.
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np

from .embeddings import Embedder
from .forgetting import DAY
from .learning import score_of
from .schemas import Candidate, Chunk, Memory, Preference, Retrieval, Searched, Weights, World
from .slots import detect_topic
from .util import r3
from .vector_store import NumpyStore

MEMORY_TAU = 30 * DAY
DOC_TAU = 365 * DAY
SIM_FLOOR = 0.2  # semantic stage: below this, an item is not a candidate
EXCLUDED_FLOOR = 0.3
POOL = 12
TOP_K = 5

DEFAULT_WEIGHTS = Weights(S=0.45, R=0.15, C=0.25, I=0.15)


def chunk_text(c: Chunk) -> str:
    return f"{c.title}. {c.text}"


def memory_text(m: Memory) -> str:
    return f"{m.label}: {m.text}" + (f" — {m.utterance}" if m.utterance else "")


_SHORT = [
    ("Academic Regulations 2024", "Regulations"),
    ("Examination Guidelines — Winter 2026", "Exam Guidelines"),
    ("CSE Department Handbook", "CSE Handbook"),
    ("CSE Department Circular 2025/14", "CSE Circular"),
]


def short_doc(title: str) -> str:
    for a, b in _SHORT:
        title = title.replace(a, b)
    return title


def chunk_candidate(world: World, c: Chunk, s: float, now: int, topic_slot: Optional[str] = None) -> Candidate:
    factors = Weights(
        S=r3(s),
        R=r3(math.exp(-max(0, now - c.published_at) / DOC_TAU)),
        C=r3(0.95 * c.reliability),
        I=r3(c.importance),
    )
    note = None
    overridden = list((c.overridden_by or {}).items())
    for slot, mem_id in overridden:
        m = world.memory(mem_id)
        if m and (not topic_slot or topic_slot == slot or len(overridden) == 1):
            who = "your correction" if m.source.type == "user" else m.source.label
            note = f"Overridden for {m.label.lower()} → {m.value or m.text} ({who})"
    return Candidate(
        id=c.id,
        kind="document",
        title=f"{short_doc(world.doc_title(c.doc_id))} §{c.section}",
        subtitle=c.title,
        text=c.text,
        factors=factors,
        score=0,
        rank=0,
        note=note,
    )


def memory_candidate(m: Memory, s: float, now: int) -> Candidate:
    last = max(m.created_at, m.last_used_at)
    factors = Weights(
        S=r3(s),
        R=r3(math.exp(-max(0, now - last) / MEMORY_TAU)),
        C=r3(m.confidence * m.reliability),
        I=r3(m.importance),
    )
    return Candidate(
        id=m.id,
        kind="memory",
        title=m.text,
        subtitle=f"Learned from you · {m.label}" if m.source.type == "user" else f"{m.source.label} · {m.label}",
        text=f"You said: “{m.utterance}”" if m.utterance else m.text,
        factors=factors,
        score=0,
        rank=0,
        status=m.status,
        cls=m.cls,
    )


class Retriever:
    def __init__(self, embedder: Embedder, store: NumpyStore) -> None:
        self.embedder = embedder
        self.store = store

    # -- similarity -------------------------------------------------------------
    def query_vector(self, query: str) -> np.ndarray:
        return self.embedder.embed([query])[0]

    def sim(self, q: np.ndarray, item_id: str, fallback_text: Optional[str] = None) -> float:
        v = self.store.vector(item_id)
        if v is None:
            if fallback_text is None:
                return 0.0
            v = self.embedder.embed([fallback_text])[0]
        return r3(self.embedder.calibrate(float(np.dot(q.astype(np.float64), v.astype(np.float64)))))

    def text_sim(self, a: str, b: str) -> float:
        va, vb = self.embedder.embed([a, b])
        return r3(self.embedder.calibrate(float(np.dot(va.astype(np.float64), vb.astype(np.float64)))))

    def candidate_for(self, world: World, item_id: str, query: str, now: int, topic_slot: Optional[str] = None) -> Optional[Candidate]:
        q = self.query_vector(query)
        c = world.chunk(item_id)
        if c:
            return chunk_candidate(world, c, self.sim(q, c.id, chunk_text(c)), now, topic_slot)
        m = world.memory(item_id)
        if m:
            return memory_candidate(m, self.sim(q, m.id, memory_text(m)), now)
        return None

    # -- the two-stage search ---------------------------------------------------
    def retrieve(self, world: World, query: str, weights: Weights, now: int) -> Retrieval:
        topic = detect_topic(query)
        topic_slot = topic.slot if topic else None
        q = self.query_vector(query)

        # Stage 1 — semantic: nearest neighbours in the vector store
        pool: list[Candidate] = []
        for item_id, cos in self.store.search(q, POOL, "live"):
            s = r3(self.embedder.calibrate(cos))
            if s < SIM_FLOOR:
                continue
            c = world.chunk(item_id)
            if c:
                pool.append(chunk_candidate(world, c, s, now, topic_slot))
                continue
            m = world.memory(item_id)
            if m and m.status == "current" and m.kind != "preference":
                pool.append(memory_candidate(m, s, now))
        pool.sort(key=lambda c: -c.factors.S)

        # Stage 2 — re-rank on all four signals
        for c in pool:
            c.score = r3(score_of(c.factors, weights))
        ranked = sorted(pool, key=lambda c: -c.score)[:TOP_K]
        for i, c in enumerate(ranked):
            c.rank = i + 1

        # Relevant but filtered out: outdated / expired memories
        excluded: list[Candidate] = []
        for item_id, cos in self.store.search(q, 10, "inactive"):
            m = world.memory(item_id)
            if not m or m.status == "current":
                continue
            c = memory_candidate(m, r3(self.embedder.calibrate(cos)), now)
            c.score = r3(score_of(c.factors, weights))
            if m.status == "outdated":
                by = world.memory(m.superseded_by) if m.superseded_by else None
                c.excluded = f"Replaced by “{by.text}”" if by else "Marked outdated"
            else:
                c.excluded = "Expired — it was only relevant for a short time"
            if c.factors.S >= EXCLUDED_FLOOR:
                excluded.append(c)
        excluded = sorted(excluded, key=lambda c: -c.factors.S)[:3]

        preferences = [Preference(id=m.id, text=m.text) for m in world.memories if m.status == "current" and m.kind == "preference"]

        return Retrieval(
            query=query,
            candidates=ranked,
            excluded=excluded,
            weights=weights.model_copy(),
            searched=Searched(chunks=len(world.chunks), memories=sum(1 for m in world.memories if m.status == "current")),
            pool=len(pool),
            preferences=preferences,
            ping=ping_for(world, ranked),
        )

    def rank_all(self, world: World, query: str, weights: Weights, now: int) -> list[Candidate]:
        """Every live item scored (no pool cut-off) — the Retrieval lab's table."""
        topic = detect_topic(query)
        topic_slot = topic.slot if topic else None
        q = self.query_vector(query)
        items: list[Candidate] = []
        for item_id, cos in self.store.search(q, self.store.count(), "live"):
            s = r3(self.embedder.calibrate(cos))
            if s < SIM_FLOOR:
                continue
            c = world.chunk(item_id)
            m = None if c else world.memory(item_id)
            if c:
                items.append(chunk_candidate(world, c, s, now, topic_slot))
            elif m and m.status == "current" and m.kind != "preference":
                items.append(memory_candidate(m, s, now))
        for it in items:
            it.score = r3(score_of(it.factors, weights))
        items.sort(key=lambda c: -c.score)
        for i, it in enumerate(items):
            it.rank = i + 1
        return items


def ping_for(world: World, ranked: list[Candidate]) -> tuple[float, float]:
    """Where the question "lands" on the map: the score-weighted centre of its top hits."""
    x = y = w = 0.0
    for c in ranked[:3]:
        p = world.positions.get(c.id)
        if not p:
            continue
        k = c.score * c.score
        x += p[0] * k
        y += p[1] * k
        w += k
    return (x / w, y / w) if w else (0.0, 0.0)
