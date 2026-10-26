"""Domain model — a field-for-field mirror of frontend/lib/engine/types.ts.

Python attributes are snake_case; JSON is camelCase (the alias generator), so the
frontend reads the backend's payloads with no mapping layer. All times are epoch
milliseconds on the demo clock (see Engine.now()).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr
from pydantic.alias_generators import to_camel

MemoryClass = Literal["persistent", "important", "correction", "temporary", "irrelevant"]
StoredClass = Literal["persistent", "important", "correction", "temporary"]
# pending = held for verification (novelty 3); archived = faded or merged away (novelty 7)
MemoryStatus = Literal["current", "outdated", "expired", "pending", "archived"]
MemoryKind = Literal["fact", "preference", "profile", "event"]
SourceKind = Literal["document", "memory"]
Decision = Literal["store", "replace", "reinforce", "keep-temporarily", "discard", "flag-previous", "question"]
SpanKind = Literal["value", "topic", "time", "cue", "entity"]
MemoryOpKind = Literal["add", "replace", "reinforce", "expire", "flag", "confirm", "discard", "quarantine", "corroborate", "schedule"]
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
    # novelties
    "memory.quarantined",
    "memory.verified",
    "memory.rejected",
    "memory.corroborated",
    "memory.merged",
    "memory.archived",
    "memory.scheduled",
    "trust.propagated",
    "reminder.due",
]
AnswerMode = Literal["answer", "clarify", "abstain"]

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


class Verification(Model):
    """Why a correction was accepted or held back (novelty 3: poisoning defence)."""

    score: float
    threshold: float
    accepted: bool
    reasons: list[str] = Field(default_factory=list)
    against: Optional[str] = None  # the chunk / memory it contradicts
    against_value: Optional[str] = None
    resolved_by: Optional[Literal["document", "crowd", "moderator"]] = None
    resolved_at: Optional[int] = None


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
    # --- novelties: all optional, and absent from the JSON when the feature is off
    owner: Optional[str] = None  # student who told us (None = the default student)
    shared: Optional[bool] = None  # crowd- or document-verified: visible to every student it applies to
    reporters: Optional[list[str]] = None  # students who stated this value
    applies_to: Optional[str] = None  # department the fact is scoped to, e.g. "CSE"
    valid_from: Optional[int] = None  # when it became true (valid time, not when we learned it)
    valid_to: Optional[int] = None  # when it stopped being true
    verification: Optional[Verification] = None
    merged_from: Optional[list[str]] = None
    merged_into: Optional[str] = None
    archived_at: Optional[int] = None


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
    # novelty 2: which question type's weights were used, and how far they lean on it
    intent_group: Optional[str] = None
    group_share: Optional[float] = None  # 1 − λ: the share of the group's own weights


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
    # novelty 9: reliability changes spread to the target's nearest neighbours
    propagated: Optional[list[ReliabilityChange]] = None
    intent_group: Optional[str] = None


class Answerability(Model):
    """Novelty 6: how sure the system is, and whether it answered, asked or abstained."""

    confidence: float
    mode: AnswerMode
    reasons: list[str] = Field(default_factory=list)


class TurnContext(Model):
    """Novelties 1 and 8: who asked, and the scope / point in time the answer is for."""

    user: Optional[str] = None
    department: Optional[str] = None
    scope: Optional[str] = None  # department the question is about, when it names one
    as_of: Optional[int] = None  # the question asks about the past ("last month")
    label: Optional[str] = None  # "As of Sat, 26 Sep" / "For ECE"


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
    # novelties
    context: Optional[TurnContext] = None
    answerability: Optional[Answerability] = None


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


class UserProfile(Model):
    """A student (novelty 8). One demo student unless multi-user is switched on."""

    id: str
    name: str
    department: Optional[str] = None


class Trust(Model):
    """Beta(alpha, beta) belief that a student's corrections are right (novelty 3)."""

    alpha: float = 4.0
    beta: float = 1.0

    @property
    def mean(self) -> float:
        return self.alpha / (self.alpha + self.beta)


class DecayFit(Model):
    """Forgetting time constant learned from how often memories get used (novelty 5)."""

    tau: float  # learned base τ (ms)
    prior: float  # the hand-set τ it is shrunk towards
    events: int  # re-uses observed
    exposure: float  # total time at risk (ms)
    memories: int


class Reminder(Model):
    """A nudge derived from a temporary memory (novelty 11)."""

    id: str
    memory_id: str
    owner: Optional[str] = None
    at: int
    title: str
    text: str
    status: Literal["scheduled", "due", "dismissed", "cancelled"] = "scheduled"


@dataclass
class View:
    """Who is asking, and about which scope and time. Set on the World for the length
    of a turn; every lookup below then answers *for this view*. No view (the default,
    and always when the novelties are off) means the original single-user behaviour."""

    user: Optional[str] = None  # None: no privacy filter
    department: Optional[str] = None
    scope: Optional[str] = None  # department asked about (defaults to `department`)
    as_of: Optional[int] = None  # answer as of this moment (None: now)
    now: int = 0
    scoped: bool = False  # apply scope/validity rules (novelty 1)

    @property
    def target(self) -> Optional[str]:
        return self.scope or self.department


DEFAULT_USER = "harsh"


def owner_of(m: "Memory") -> Optional[str]:
    """The student a memory belongs to, or None when everyone may see it."""
    if m.shared or m.source.type == "document":
        return None
    return m.owner or DEFAULT_USER


def valid_at(m: "Memory", t: int) -> bool:
    """Was this memory true at time t? (valid time, novelty 1)"""
    if m.status == "pending":
        return False
    start = m.valid_from if m.valid_from is not None else m.created_at
    if t < start:
        return False
    end = m.valid_to
    if end is None:
        end = m.superseded_at if m.status == "outdated" else m.expired_at if m.status == "expired" else None
    return end is None or t < end


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
    # novelties (empty when off)
    users: list[UserProfile] = Field(default_factory=list)
    trust: dict[str, Trust] = Field(default_factory=dict)
    intent_weights: dict[str, Weights] = Field(default_factory=dict)
    intent_counts: dict[str, int] = Field(default_factory=dict)
    decay: dict[str, DecayFit] = Field(default_factory=dict)
    reminders: list[Reminder] = Field(default_factory=list)

    _view: Optional[View] = PrivateAttr(default=None)

    # ---- the view (novelties 1 and 8)
    @property
    def view(self) -> Optional[View]:
        return self._view

    def set_view(self, view: Optional[View]) -> None:
        self._view = view

    def visible(self, m: Memory) -> bool:
        v = self._view
        if v is None or v.user is None:
            return True
        return owner_of(m) in (None, v.user) or v.user in (m.reporters or [])

    def applies(self, m: Memory) -> bool:
        v = self._view
        if v is None or not v.scoped or not m.applies_to:
            return True
        return v.target == m.applies_to

    def live(self, m: Memory) -> bool:
        """Usable as a current belief: current status — or, for a question about the
        past, true at that time — and visible and applicable to whoever is asking."""
        v = self._view
        if v is None:
            return m.status == "current"
        if v.as_of is not None:
            ok = valid_at(m, v.as_of)
        else:
            ok = m.status == "current" and (m.valid_from is None or m.valid_from <= v.now)
        return ok and self.visible(m) and self.applies(m)

    # lookups used everywhere
    def chunk(self, cid: str) -> Optional[Chunk]:
        return next((c for c in self.chunks if c.id == cid), None)

    def memory(self, mid: str) -> Optional[Memory]:
        m = next((m for m in self.memories if m.id == mid), None)
        return m if m is not None and self.visible(m) else None

    def current_memory(self, slot: str) -> Optional[Memory]:
        v = self._view
        if v is None:
            return next((m for m in self.memories if m.slot == slot and m.status == "current"), None)
        found = [m for m in self.memories if m.slot == slot and self.live(m)]
        if not found:
            return None
        if v.scoped:
            # the most specific (scoped beats global), then the most recently true
            return max(found, key=lambda m: (m.applies_to is not None, m.valid_from or m.created_at, m.created_at))
        return found[0]

    def claim_applies(self, c: Chunk, claim: Claim) -> bool:
        v = self._view
        if v is None or not v.scoped:
            return True
        if v.as_of is not None and c.published_at > v.as_of:
            return False
        return not claim.scope or doc_department(self, c.doc_id) in (None, v.target)

    def overrides(self, c: Chunk) -> list[tuple[str, Optional[Memory]]]:
        """(slot, memory) for each of this passage's claims a memory overrides."""
        if self._view is None:
            return [(slot, self.memory(mid)) for slot, mid in (c.overridden_by or {}).items()]
        out: list[tuple[str, Optional[Memory]]] = []
        for claim in c.claims:
            m = self.override_of(c, claim.slot)
            if m:
                out.append((claim.slot, m))
        return out

    def override_of(self, c: Chunk, slot: str) -> Optional[Memory]:
        """The memory that overrides this passage's claim for whoever is asking. With a
        view it is derived from the current belief, so a private or out-of-scope
        correction never overrides the passage for anyone else."""
        if self._view is None:
            mid = (c.overridden_by or {}).get(slot)
            return self.memory(mid) if mid else None
        claim = next((cl for cl in c.claims if cl.slot == slot), None)
        if not claim or not self.claim_applies(c, claim):
            return None
        m = self.current_memory(slot)
        if not m or not m.value:
            return None
        if _norm(m.value) == _norm(claim.value):
            return None
        return m

    def doc_title(self, doc_id: str) -> str:
        d = next((d for d in self.documents if d.id == doc_id), None)
        return d.title if d else "Document"

    def user(self, uid_: Optional[str]) -> Optional[UserProfile]:
        return next((u for u in self.users if u.id == uid_), None)

    def conversation(self) -> list[Turn]:
        """The turns of whoever is asking (all turns when there is one student)."""
        v = self._view
        if v is None or v.user is None:
            return self.turns
        return [t for t in self.turns if ((t.context.user if t.context else None) or DEFAULT_USER) == v.user]


_DEPT = re.compile(r"\b(CSE|ECE|EEE|IT|MECH|CIVIL|BIOTECH)\b")


def doc_department(world: "World", doc_id: str) -> Optional[str]:
    """The department a document speaks for ("CSE Department Circular" → CSE)."""
    d = next((d for d in world.documents if d.id == doc_id), None)
    if not d:
        return None
    m = _DEPT.search(f"{d.title} {d.issuer}")
    return m.group(1) if m else None


def _norm(s: Optional[str]) -> str:
    return re.sub(r"\s+", "", (s or "").lower()).replace("percent", "%")


# ---- request bodies -------------------------------------------------------------


_ID = r"^[A-Za-z0-9_.:-]{1,80}$"


class ChatRequest(Model):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str = "demo"
    # novelty 8: which student is talking (multi-user mode)
    user_id: Optional[str] = Field(default=None, pattern=_ID)
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
    # "current" restores an archived memory (novelty 7)
    status: Optional[Literal["outdated", "current"]] = None


class RetrieveRequest(Model):
    query: str = Field(min_length=1, max_length=2000)
    weights: Optional[Weights] = None
    expand: bool = True  # add the context terms the console would (shown as "+ …")


class ClassifyRequest(Model):
    text: str = Field(min_length=1, max_length=2000)
    predictor: Optional[Literal["rules", "ml", "llm"]] = None


class ClockRequest(Model):
    advance_ms: int = Field(ge=0, le=365 * 24 * 3_600_000)


class VerifyRequest(Model):
    accept: bool


class ResolveRequest(Model):
    slot: str
    user_id: Optional[str] = Field(default=None, pattern=_ID)
    scope: Optional[str] = None
    as_of: Optional[int] = None
