"""Domain model — a field-for-field mirror of frontend/lib/engine/types.ts.

Python attributes are snake_case; JSON is camelCase (the alias generator), so the
frontend reads the backend's payloads with no mapping layer. All times are epoch
milliseconds on the demo clock (see Engine.now()).
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

MemoryClass = Literal["persistent", "important", "correction", "temporary", "irrelevant"]
StoredClass = Literal["persistent", "important", "correction", "temporary"]
MemoryStatus = Literal["current", "outdated", "expired"]
MemoryKind = Literal["fact", "preference", "profile", "event"]
SourceKind = Literal["document", "memory"]
Decision = Literal["store", "replace", "reinforce", "keep-temporarily", "discard", "flag-previous", "question"]
SpanKind = Literal["value", "topic", "time", "cue", "entity"]
MemoryOpKind = Literal["add", "replace", "reinforce", "expire", "flag", "confirm", "discard"]
TurnStatus = Literal["classifying", "retrieving", "streaming", "done", "error"]
Verdict = Literal["helpful", "not_helpful"]
Reason = Literal["wrong_source", "outdated", "incomplete"]
Stage = Literal["classifying", "remembering", "retrieving", "generating"]
EventType = Literal[
    "memory.added",
    "memory.preference",
    "memory.replaced",
    "memory.expired",
    "memory.reinforced",
    "memory.flagged",
    "memory.pinned",
    "memory.deleted",
    "memory.outdated",
    "memory.confirmed",
    "weights.updated",
    "document.indexed",
    "document.conflict",
]

CLASSES: list[str] = ["persistent", "important", "correction", "temporary", "irrelevant"]
FACTORS: list[str] = ["S", "R", "C", "I"]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, validate_assignment=False)

    def dump(self) -> dict[str, Any]:
        """JSON-ready dict in the frontend's shape (camelCase, no nulls)."""
        return self.model_dump(by_alias=True, exclude_none=True, mode="json")


class Weights(Model):
    # keep the brief's capital letters (to_camel would turn "S" into "s")
    model_config = ConfigDict(alias_generator=None, populate_by_name=True)

    S: float
    R: float
    C: float
    I: float  # noqa: E741 — the brief's name for importance

    def get(self, f: str) -> float:
        return float(getattr(self, f))

    def as_dict(self) -> dict[str, float]:
        return {f: self.get(f) for f in FACTORS}


class Claim(Model):
    slot: str
    value: str
    scope: Optional[str] = None


class DocumentMeta(Model):
    id: str
    title: str
    issuer: str
    published_at: int
    indexed_at: int
    chunk_ids: list[str]
    sample: Optional[bool] = None


class Chunk(Model):
    id: str
    doc_id: str
    section: str
    title: str
    text: str
    tokens: int
    importance: float
    reliability: float
    published_at: int
    indexed_at: int
    claims: list[Claim] = Field(default_factory=list)
    # slot → id of the memory that overrides this chunk's claim
    overridden_by: Optional[dict[str, str]] = None


class Source(Model):
    type: Literal["user", "document"]
    label: str
    ref: Optional[str] = None


class Memory(Model):
    id: str
    slot: Optional[str] = None
    label: str
    text: str
    value: Optional[str] = None
    scope: Optional[str] = None
    cls: StoredClass
    kind: MemoryKind
    source: Source
    utterance: Optional[str] = None
    confidence: float
    importance: float
    reliability: float
    status: MemoryStatus
    pinned: bool = False
    created_at: int
    last_used_at: int
    uses: list[int] = Field(default_factory=list)
    expires_at: Optional[int] = None
    expired_at: Optional[int] = None
    supersedes: Optional[str] = None  # memory id or "chunk:<id>"
    superseded_by: Optional[str] = None
    superseded_at: Optional[int] = None
    previous_value: Optional[str] = None
    confirmed_by: Optional[str] = None  # chunk id


class Span(Model):
    start: int
    end: int
    kind: SpanKind
    text: str


class Conflict(Model):
    with_id: str
    with_kind: SourceKind
    with_text: str
    with_value: str
    with_source: str


class Classification(Model):
    label: MemoryClass
    probs: dict[str, float]
    spans: list[Span] = Field(default_factory=list)
    is_question: bool
    slot: Optional[str] = None
    slot_label: Optional[str] = None
    value: Optional[str] = None
    scope: Optional[str] = None
    coref: Optional[str] = None
    conflict: Optional[Conflict] = None
    decision: Decision
    reason: str
    # backend-only extras (ignored by the frontend's types, useful in the inspector/API)
    predictor: Optional[str] = None
    knowledge: Optional[str] = None


class Candidate(Model):
    id: str
    kind: SourceKind
    title: str
    subtitle: str
    text: str
    factors: Weights
    score: float
    rank: int
    status: Optional[MemoryStatus] = None
    cls: Optional[StoredClass] = None
    excluded: Optional[str] = None
    note: Optional[str] = None


class Preference(Model):
    id: str
    text: str


class Searched(Model):
    chunks: int
    memories: int


class Retrieval(Model):
    query: str
    candidates: list[Candidate]
    excluded: list[Candidate]
    weights: Weights
    searched: Searched
    pool: int
    preferences: list[Preference]
    ping: tuple[float, float]


class MemoryOp(Model):
    kind: MemoryOpKind
    memory_id: Optional[str] = None
    previous_id: Optional[str] = None
    title: str
    detail: Optional[str] = None
    subject: Optional[str] = None


class Citation(Model):
    n: int
    item_id: str


class ReliabilityChange(Model):
    id: str
    from_: float = Field(alias="from")
    to: float


class Feedback(Model):
    verdict: Verdict
    reason: Optional[Reason] = None
    target_id: Optional[str] = None
    deltas: Optional[Weights] = None
    reliability: Optional[ReliabilityChange] = None
    at: int


class Turn(Model):
    id: str
    role: Literal["user", "assistant"]
    text: str
    at: int
    # user
    classification: Optional[Classification] = None
    memory_ops: Optional[list[MemoryOp]] = None
    # assistant
    reply_to: Optional[str] = None
    retrieval: Optional[Retrieval] = None
    citations: Optional[list[Citation]] = None
    intent: Optional[str] = None
    status: Optional[TurnStatus] = None
    feedback: Optional[Feedback] = None
    error: Optional[str] = None
    # backend-only: which generator wrote the answer ("claude-sonnet-5-5", "template", …)
    model: Optional[str] = None


class ActivityEvent(Model):
    id: str
    type: EventType
    at: int
    title: str
    detail: str
    ref_id: Optional[str] = None


class WeightPoint(Model):
    at: int
    weights: Weights
    label: str


class World(Model):
    version: int
    seeded_at: int
    documents: list[DocumentMeta]
    chunks: list[Chunk]
    memories: list[Memory]
    turns: list[Turn]
    events: list[ActivityEvent]
    queries: list[int]
    weights: Weights
    weight_history: list[WeightPoint]
    positions: dict[str, tuple[float, float]]
    script_done: list[str] = Field(default_factory=list)

    # lookups used everywhere
    def chunk(self, cid: str) -> Optional[Chunk]:
        return next((c for c in self.chunks if c.id == cid), None)

    def memory(self, mid: str) -> Optional[Memory]:
        return next((m for m in self.memories if m.id == mid), None)

    def current_memory(self, slot: str) -> Optional[Memory]:
        return next((m for m in self.memories if m.slot == slot and m.status == "current"), None)

    def doc_title(self, doc_id: str) -> str:
        d = next((d for d in self.documents if d.id == doc_id), None)
        return d.title if d else "Document"


# ---- request bodies -------------------------------------------------------------


_ID = r"^[A-Za-z0-9_.:-]{1,80}$"


class ChatRequest(Model):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str = "demo"
    # optional: let the client name the two turns so its ids never change mid-stream
    user_turn_id: Optional[str] = Field(default=None, pattern=_ID)
    assistant_turn_id: Optional[str] = Field(default=None, pattern=_ID)


class FeedbackRequest(Model):
    turn_id: str
    verdict: Verdict
    reason: Optional[Reason] = None
    target_id: Optional[str] = None


class MemoryPatch(Model):
    pinned: Optional[bool] = None
    status: Optional[Literal["outdated"]] = None


class RetrieveRequest(Model):
    query: str = Field(min_length=1, max_length=2000)
    weights: Optional[Weights] = None
    expand: bool = True  # add the context terms the console would (shown as "+ …")


class ClassifyRequest(Model):
    text: str = Field(min_length=1, max_length=2000)
    predictor: Optional[Literal["rules", "ml", "llm"]] = None


class ClockRequest(Model):
    advance_ms: int = Field(ge=0, le=365 * 24 * 3_600_000)
