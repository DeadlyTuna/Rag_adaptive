"""The engine: one object that owns the world and runs the adaptive-RAG pipeline.

A chat turn, as a stream of events (what the frontend animates):

  user            the message, as received
  classification  memory classifier → class, probabilities, slot/value, conflict, decision
  memory_ops      memory manager → add / replace / reinforce / flag / discard
  retrieval       two-stage retrieval → candidates with S, R, C, I and score
  token …         the answer, streamed (LLM, or the template fallback)
  done            the finished assistant turn, with citations

Everything that changes state happens under one asyncio lock, is persisted to SQLite
at the end of the turn, and is rolled back if the turn fails half-way.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Optional

from .classifier import classify, current_for_slot
from .classifier.llm import LLMPredictor, Precomputed
from .classifier.ml import MLPredictor
from .config import BACKEND_DIR, Settings
from .db import Database
from .embeddings import make_embedder
from .forgetting import strength_at
from .generator.llm import make_llm
from .generator.prompts import SYSTEM_PROMPT, build_messages
from .generator.template import ARITH, compose, detect_intent
from .knowledge_base import ingest, parse_upload, extract_text
from .learning import normalise, score_of
from .memory_manager import (
    apply_feedback,
    apply_statement,
    delete_memory,
    event,
    expand_query,
    mark_outdated,
    tick,
    toggle_pin,
)
from .projection import mds, place
from .retriever import Retriever, chunk_text, memory_text
from .schemas import Candidate, Citation, Classification, Memory, MemoryOp, Retrieval, Turn, WeightPoint, Weights, World
from .seed import WORLD_VERSION, create_world, sample_circular
from .util import r3, uid
from .vector_store import make_store, text_hash

log = logging.getLogger("adaptive-rag")

MODEL_PATH = BACKEND_DIR / "models" / "memory_classifier.joblib"


class FeedbackExists(Exception):
    """An answer gets one piece of feedback; the first one is returned."""

    def __init__(self, feedback: dict) -> None:
        super().__init__("This answer already has feedback.")
        self.feedback = feedback
HISTORY_TURNS = 6
TOKEN = re.compile(r"\[\d+\]|\S+\s*|\s+")


class Engine:
    def __init__(self, settings: Settings, clock: Optional[Callable[[], int]] = None) -> None:
        self.s = settings
        self._clock = clock or (lambda: int(time.time() * 1000))  # tests inject a fixed clock
        self.lock = asyncio.Lock()
        self._committed = False
        self.embedder = make_embedder(settings.embedder, settings.embedding_model)
        self.store = make_store(settings.vector_store, settings.chroma_path, self.embedder.name)
        self.retriever = Retriever(self.embedder, self.store)
        self.db = Database(settings.db_path)
        self.llm = make_llm(settings)
        self.ml = MLPredictor.load(MODEL_PATH)
        self.llm_classifier = LLMPredictor(self.llm) if self.llm else None

        world, meta = self.db.load()
        self.clock_offset = int(meta.get("clock_offset", 0))
        if world is None or world.version != WORLD_VERSION:
            world = self._fresh_world()
            self.world = world
            self._finish_world(full_layout=True)
            self.save()
        else:
            self.world = world
            self._finish_world(full_layout=False)

    # ------------------------------------------------------------------ basics
    def now(self) -> int:
        return self._clock() + self.clock_offset

    def _fresh_world(self) -> World:
        self.clock_offset = 0
        return create_world(self.now())

    def _finish_world(self, full_layout: bool) -> None:
        self.sync_index()
        ids = [c.id for c in self.world.chunks] + [m.id for m in self.world.memories]
        missing = [i for i in ids if i not in self.world.positions]
        if full_layout or len(missing) > len(ids) // 2:
            vecs = self.store_vectors(ids)
            self.world.positions = mds(ids, vecs)
        else:
            for i in missing:
                self.placer(self.world, i, None)

    def save(self) -> None:
        self.db.save(self.world, {"clock_offset": self.clock_offset})

    @property
    def classifier_name(self) -> str:
        if self.s.classifier == "llm" and self.llm_classifier:
            return f"llm ({getattr(self.llm, 'json_model', self.llm.name)})"
        if self.s.classifier in ("ml", "llm") and self.ml:
            return "ml (tf-idf + logistic regression)"
        return "rules"

    @property
    def answer_model(self) -> str:
        return self.llm.name if (self.llm and self.s.answer_mode == "llm") else "template"

    def info(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "answers": self.answer_model,
            "classifier": self.classifier_name,
            "embedder": self.embedder.name,
            "vectorStore": self.store.name,
            "indexed": self.store.count(),
            "now": self.now(),
            "clockOffset": self.clock_offset,
        }

    # ------------------------------------------------------------------ index
    def _wanted(self) -> dict[str, tuple[str, dict]]:
        want: dict[str, tuple[str, dict]] = {}
        for c in self.world.chunks:
            t = chunk_text(c)
            want[c.id] = (t, {"kind": "document", "status": "current", "pref": False, "doc": c.doc_id, "th": text_hash(t)})
        for m in self.world.memories:
            t = memory_text(m)
            want[m.id] = (t, {"kind": "memory", "status": m.status, "pref": m.kind == "preference", "doc": "", "th": text_hash(t)})
        return want

    def sync_index(self) -> None:
        """Make the vector store mirror the world: embed new/changed items, update
        statuses (so outdated memories drop out of the "live" search), delete removed."""
        want = self._wanted()
        have = self.store.ids()
        embed_ids = [i for i, (_, meta) in want.items() if i not in have or (self.store.metadata(i) or {}).get("th") != meta["th"]]
        if embed_ids:
            vecs = self.embedder.embed([want[i][0] for i in embed_ids])
            self.store.upsert(embed_ids, vecs, [want[i][1] for i in embed_ids], [want[i][0] for i in embed_ids])
        update = [i for i, (_, meta) in want.items() if i in have and i not in embed_ids and self.store.metadata(i) != meta]
        if update:
            self.store.update_meta(update, [want[i][1] for i in update])
        gone = [i for i in have if i not in want]
        if gone:
            self.store.delete(gone)

    def store_vectors(self, ids: list[str]):
        import numpy as np

        return np.stack([self.store.vector(i) for i in ids])

    def placer(self, world: World, item_id: str, near: Optional[str]) -> None:
        """Give a new passage or memory its spot on the 2-D map."""
        self.sync_index()
        v = self.store.vector(item_id)
        if v is None:
            return
        neighbours = {i: self.store.vector(i) for i in world.positions if self.store.vector(i) is not None}
        world.positions[item_id] = place(item_id, v, world.positions, neighbours, near)

    # ------------------------------------------------------------------ helpers
    def _last_topic(self) -> Optional[str]:
        w = self.world
        last_user = next((t for t in reversed(w.turns) if t.role == "user" and t.classification and t.classification.slot), None)
        last_asst = next((t for t in reversed(w.turns) if t.role == "assistant"), None)
        if last_asst and last_user and last_asst.at >= last_user.at and ((last_asst.intent or "").startswith("attendance") or last_asst.intent == "am-i-eligible"):
            return "attendance.minimum"
        return last_user.classification.slot if last_user and last_user.classification else None

    async def _classify(self, text: str, last_topic: Optional[str]) -> Classification:
        predictor = None
        if self.s.classifier == "llm" and self.llm_classifier:
            try:
                pred = await self.llm_classifier.apredict(text)
                predictor = Precomputed("llm", pred)
            except Exception as e:  # noqa: BLE001
                log.warning("LLM classifier failed (%s) — falling back to the trained model / rules.", e)
                predictor = self.ml
        elif self.s.classifier in ("ml", "llm"):
            predictor = self.ml
        return classify(text, self.world, last_topic, predictor)

    def _lookup(self, item_id: str, query: str, now: int, weights: Weights, note: str, topic: Optional[str] = None) -> Optional[Candidate]:
        cand = self.retriever.candidate_for(self.world, item_id, query, now, topic)
        if not cand:
            return None
        cand.score = r3(score_of(cand.factors, weights))
        cand.note = cand.note or note
        return cand

    def _context_lookups(self, text: str, cls: Classification, retrieval: Retrieval, ops: list[MemoryOp], now: int) -> list[Candidate]:
        """Items the LLM needs that similarity search may not rank in the top 5: the
        current belief for the question's topic, the student's own facts the question
        depends on, and the memories this message just wrote (so the reply can cite them)."""
        w = self.world
        intent = detect_intent(text, cls)
        want: list[tuple[str, str]] = []
        topic = {
            "am-i-eligible": "attendance.minimum",
            "fat-eligibility": "attendance.minimum",
            "attendance-minimum": "attendance.minimum",
            "pass-marks": "pass.marks",
            "library-hours": "library.hours",
            "curfew": "hostel.curfew",
        }.get(intent) or (cls.slot if cls.is_question else None)
        if topic:
            cur = current_for_slot(w, topic)
            if cur:
                want.append((cur[1].id, "Looked up by topic"))
            m = w.current_memory(topic)
            if m and m.supersedes and m.supersedes.startswith("chunk:"):
                want.append((m.supersedes[6:], "Looked up by topic"))
        if intent in ("am-i-eligible", "my-attendance"):
            m = w.current_memory("user.attendance")
            if m:
                want.append((m.id, "Looked up by topic"))
        if intent == "name":
            m = w.current_memory("user.name")
            if m:
                want.append((m.id, "Looked up by topic"))
        for op in ops:
            for i in (op.memory_id, op.previous_id):
                if i:
                    want.append((i, "Written by this message"))
        if cls.conflict and cls.conflict.with_kind == "document":
            want.append((cls.conflict.with_id, "Written by this message"))

        have = {c.id for c in retrieval.candidates}
        out: list[Candidate] = []
        for item_id, note in want:
            if item_id in have:
                continue
            c = self._lookup(item_id, retrieval.query, now, retrieval.weights, note, topic)
            if c:
                have.add(item_id)
                out.append(c)
        return out

    async def _pace(self, seconds: float) -> None:
        if self.s.pacing > 0:
            await asyncio.sleep(seconds * self.s.pacing)

    # ------------------------------------------------------------------ chat
    async def chat(self, message: str, user_turn_id: Optional[str] = None, assistant_turn_id: Optional[str] = None) -> AsyncIterator[dict]:
        async with self.lock:
            snapshot = self.world.model_copy(deep=True)
            self._committed = False
            taken = {t.id for t in self.world.turns}
            uid_user = user_turn_id if user_turn_id and user_turn_id not in taken else uid("turn")
            uid_asst = assistant_turn_id if assistant_turn_id and assistant_turn_id not in taken and assistant_turn_id != uid_user else uid("turn")
            try:
                async for e in self._turn(message.strip(), uid_user, uid_asst):
                    yield e
            except Exception as e:  # noqa: BLE001
                log.exception("chat turn failed")
                yield {"type": "error", "message": f"{type(e).__name__}: {e}"}
            finally:
                if not self._committed:
                    # roll back a half-applied turn (error or client disconnect)
                    self.world = snapshot
                    self.sync_index()

    async def _turn(self, text: str, user_id: str, assistant_id: str) -> AsyncIterator[dict]:
        w = self.world
        now = self.now()
        tick_events, _ = tick(w, now)
        last_topic = self._last_topic()

        user = Turn(id=user_id, role="user", text=text, at=now)
        yield {"type": "user", "turn": user.dump()}
        yield {"type": "stage", "stage": "classifying"}
        await self._pace(0.95)

        # 1. memory classifier
        cls = await self._classify(text, last_topic)
        user.classification = cls
        yield {"type": "classification", "turn_id": user.id, "classification": cls.dump()}
        yield {"type": "stage", "stage": "remembering"}
        await self._pace(0.7 if cls.is_question else 1.5)

        # 2. memory manager
        chunks_before = {c.id: (c.reliability, dict(c.overridden_by or {})) for c in w.chunks}
        placed_before = set(w.positions)
        ops, events = apply_statement(w, text, cls, now, self.placer)
        self.sync_index()
        user.memory_ops = ops
        yield {"type": "memory_ops", "turn_id": user.id, "ops": [o.dump() for o in ops]}
        # what changed in the world, so the map and the memory bank update mid-turn
        changed = [c for c in w.chunks if chunks_before.get(c.id) != (c.reliability, dict(c.overridden_by or {}))]
        yield {
            "type": "patch",
            "memories": [m.dump() for m in w.memories],
            "chunks": [c.dump() for c in changed],
            "positions": {i: list(p) for i, p in w.positions.items() if i not in placed_before},
            "events": [e.dump() for e in [*tick_events, *events]],
        }
        await self._pace(1.15 if any(o.kind != "discard" for o in ops) else 0.25)

        # 3. adaptive retrieval
        yield {"type": "stage", "stage": "retrieving"}
        query = expand_query(text, cls)
        retrieval = self.retriever.retrieve(w, query, w.weights, now)
        if cls.is_question and ARITH.search(text):
            # arithmetic needs no documents — answered directly
            retrieval.candidates, retrieval.excluded, retrieval.pool = [], [], 0
        use_llm = self.llm is not None and self.s.answer_mode == "llm"
        if use_llm and not (cls.is_question and ARITH.search(text)):
            extra = self._context_lookups(text, cls, retrieval, ops, now)
            for i, c in enumerate(extra):
                c.rank = len(retrieval.candidates) + i + 1
            retrieval.candidates.extend(extra)

        assistant = Turn(id=assistant_id, role="assistant", text="", at=now + 1, reply_to=user.id, retrieval=retrieval, status="retrieving")
        yield {"type": "retrieval", "turn_id": assistant.id, "retrieval": retrieval.dump()}
        await self._pace(1.15 if retrieval.candidates else 0.3)

        # 4. generation
        yield {"type": "stage", "stage": "generating"}
        answer = ""
        citations: list[Citation] = []
        intent = detect_intent(text, cls)
        model = "template"
        if use_llm:
            history = [t for t in w.turns if t.role in ("user", "assistant")][-HISTORY_TURNS:]
            messages = build_messages(w, text, cls, ops, retrieval.candidates, history)
            try:
                async for tok in self.llm.stream(SYSTEM_PROMPT, messages):
                    answer += tok
                    yield {"type": "token", "turn_id": assistant.id, "text": tok}
                model = self.llm.name
                citations = self._parse_citations(answer, retrieval.candidates)
            except Exception as e:  # noqa: BLE001
                log.warning("LLM generation failed (%s) — using the template answer.", e)
                if answer:
                    raise
                use_llm = False
        if not use_llm:
            composed = compose(
                w,
                text,
                cls,
                retrieval,
                ops,
                now,
                sim=self.retriever.text_sim,
                candidate_for=lambda i: self.retriever.candidate_for(w, i, retrieval.query, now),
            )
            for i, c in enumerate(composed.lookups):
                c.rank = len(retrieval.candidates) + i + 1
            retrieval.candidates.extend(composed.lookups)
            answer, citations, intent = composed.text, composed.citations, composed.intent
            for tok in TOKEN.findall(answer):
                yield {"type": "token", "turn_id": assistant.id, "text": tok}
                await self._pace(0.095 if tok.startswith("[") else 0.04)

        # citing a memory is a rehearsal: it resets its decay and stretches its half-life
        for c in citations:
            m = w.memory(c.item_id)
            if m and m.status == "current" and m.created_at < now:
                m.uses.append(now)
                m.last_used_at = now

        assistant.text = answer.strip()
        assistant.citations = citations
        assistant.intent = intent
        assistant.status = "done"
        assistant.model = model
        w.turns.extend([user, assistant])
        w.queries.append(now)
        w.events.extend(events)
        self.sync_index()
        self.save()
        self._committed = True
        yield {"type": "done", "turn": assistant.dump()}

    @staticmethod
    def _parse_citations(text: str, context: list[Candidate]) -> list[Citation]:
        seen: list[int] = []
        for m in re.finditer(r"\[(\d+)\]", text):
            n = int(m.group(1))
            if 1 <= n <= len(context) and n not in seen:
                seen.append(n)
        return [Citation(n=n, item_id=context[n - 1].id) for n in sorted(seen)]

    # ------------------------------------------------------------------ other actions
    def state(self) -> dict:
        d = self.world.dump()
        d["clockOffset"] = self.clock_offset
        d["serverNow"] = self.now()
        return d

    async def fresh_state(self) -> dict:
        """The world as of now: temporary memories whose time has passed expire on read."""
        async with self.lock:
            _, expired = tick(self.world, self.now())
            if expired:
                self.sync_index()
                self.save()
            return self.state()

    async def feedback(self, turn_id: str, verdict: str, reason: Optional[str], target_id: Optional[str]) -> Optional[dict]:
        async with self.lock:
            turn = next((t for t in self.world.turns if t.id == turn_id), None)
            if turn is not None and turn.feedback is not None:
                raise FeedbackExists(turn.feedback.dump())
            now = self.now()
            fb, events = apply_feedback(self.world, turn_id, verdict, reason, target_id, now)
            if fb is None:
                return None
            self.sync_index()
            self.save()
            self.db.log_feedback(now, turn_id, verdict, reason, target_id, fb.deltas.dump() if fb.deltas else None, fb.reliability.dump() if fb.reliability else None)
            return {"weights": self.world.weights.dump(), "feedback": fb.dump(), "deltas": fb.deltas.dump() if fb.deltas else None, "events": [e.dump() for e in events]}

    async def patch_memory(self, mem_id: str, pinned: Optional[bool], status: Optional[str]) -> Optional[dict]:
        async with self.lock:
            m = self.world.memory(mem_id)
            if not m:
                return None
            now = self.now()
            if pinned is not None and pinned != m.pinned:
                toggle_pin(self.world, mem_id, now, pinned)
            if status == "outdated":
                mark_outdated(self.world, mem_id, now)
            self.sync_index()
            self.save()
            return m.dump()

    async def delete_memory(self, mem_id: str) -> bool:
        async with self.lock:
            if not self.world.memory(mem_id):
                return False
            delete_memory(self.world, mem_id, self.now())
            self.sync_index()
            self.save()
            return True

    def memory_detail(self, mem_id: str) -> Optional[dict]:
        w = self.world
        m = w.memory(mem_id)
        if not m:
            return None
        # walk the version chain both ways
        chain: list[Memory] = [m]
        cur = m
        while cur.supersedes and not cur.supersedes.startswith("chunk:"):
            prev = w.memory(cur.supersedes)
            if not prev or prev in chain:
                break
            chain.insert(0, prev)
            cur = prev
        cur = m
        while cur.superseded_by:
            nxt = w.memory(cur.superseded_by)
            if not nxt or nxt in chain:
                break
            chain.append(nxt)
            cur = nxt
        used_in = [t.id for t in w.turns if t.role == "assistant" and any(c.item_id == mem_id for c in (t.citations or []))]
        now = self.now()
        return {
            "memory": m.dump(),
            "versions": [x.dump() for x in chain],
            "overrides": m.supersedes[6:] if (m.supersedes or "").startswith("chunk:") else None,
            "strength": round(strength_at(m, now), 4),
            "citedIn": used_in,
        }

    async def set_weights(self, weights: Weights, label: Optional[str]) -> dict:
        async with self.lock:
            now = self.now()
            w = normalise(weights)
            self.world.weights = w
            text = label or "Set by hand in the Retrieval lab"
            self.world.weight_history.append(WeightPoint(at=now, weights=w.model_copy(), label=text))
            self.world.events.append(event("weights.updated", now, "Ranking weights updated", text))
            self.save()
            return w.dump()

    async def advance_clock(self, ms: int) -> dict:
        async with self.lock:
            self.clock_offset += ms
            events, expired = tick(self.world, self.now())
            self.sync_index()
            self.save()
            return {"now": self.now(), "clockOffset": self.clock_offset, "expired": expired, "events": [e.dump() for e in events]}

    async def ingest_upload(self, filename: str, data: bytes) -> dict:
        raw = extract_text(filename, data)
        if not raw.strip():
            raise ValueError("No text could be extracted from that file.")
        async with self.lock:
            now = self.now()
            doc = parse_upload(filename, raw, now)
            return self._ingest(doc, now)

    async def ingest_sample(self) -> dict:
        async with self.lock:
            return self._ingest(sample_circular(), self.now())

    def _ingest(self, doc, now: int) -> dict:
        events, chunk_ids = ingest(self.world, doc, now, self.placer)
        self.sync_index()
        self.save()
        meta = next((d for d in self.world.documents if d.id == doc.id), None)
        return {
            "document": meta.dump() if meta else None,
            "chunks": [c.dump() for c in self.world.chunks if c.id in set(chunk_ids)],
            "events": [e.dump() for e in events],
            "alreadyIndexed": not chunk_ids,
        }

    async def reset(self) -> dict:
        async with self.lock:
            self.db.wipe()
            self.store.reset()
            self.world = self._fresh_world()
            self._finish_world(full_layout=True)
            self.save()
            return self.state()

    def rank(self, query: str, weights: Optional[Weights], expand: bool) -> dict:
        w = normalise(weights) if weights else self.world.weights
        q = expand_query(query, classify(query, self.world)) if expand else query
        return {"query": q, "candidates": [c.dump() for c in self.retriever.rank_all(self.world, q, w, self.now())]}

    async def classify_only(self, text: str, predictor: Optional[str]) -> dict:
        if predictor == "llm" and self.llm_classifier:
            pred = await self.llm_classifier.apredict(text)
            p = Precomputed("llm", pred)
        elif predictor == "rules":
            p = None
        elif predictor == "ml":
            p = self.ml
        else:
            return (await self._classify(text, self._last_topic())).dump()
        return classify(text, self.world, self._last_topic(), p).dump()

    def evaluate_classifier(self, predictor: str) -> dict:
        from .classifier.evaluate import evaluate

        p = None if predictor == "rules" else self.ml
        if predictor == "ml" and not self.ml:
            raise ValueError("No trained model — run: python -m ml.train_classifier")
        return evaluate(p, create_world(self.now()))


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
