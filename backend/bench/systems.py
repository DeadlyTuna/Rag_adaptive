"""The systems the benchmark compares, all over the same documents and embeddings.

  plain          an ordinary RAG system: retrieves from the documents and answers; it
                 remembers nothing and never learns from feedback
  adaptive       the core adaptive-RAG pipeline (memories, corrections, learned weights
                 and reliability, forgetting) — NOVELTIES=none
  +novelties     the core plus every research extension — NOVELTIES=all
  −<name>        all extensions but one (ablations)

Answers come from the deterministic template generator, embeddings from the hashed
embedder: no model downloads, no API keys, and the same numbers on every run.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Optional

from app.config import NOVELTY_NAMES, Settings, parse_novelties
from app.engine import Engine
from app.novelty.counterfactual import answer_on, variant_world

T0 = 1_791_000_000_000  # the same fixed "now" as the tests (3 Oct 2026)


class Clock:
    def __init__(self, t: int = T0) -> None:
        self.t = t

    def __call__(self) -> int:
        return self.t


def settings(tmp: Path, novelties: frozenset[str], embedder: str = "hash") -> Settings:
    s = Settings()
    s.data_dir = tmp
    s.embedder = embedder
    s.vector_store = "numpy"
    s.llm_provider = "none"
    s.anthropic_api_key = ""
    s.openai_base_url = ""
    s.classifier = "rules"
    s.answer_mode = "template"
    s.pacing = 0.0
    s.novelties = novelties
    return s


async def _collect(agen) -> list[dict]:
    return [e async for e in agen]


class System:
    """One fresh world per scenario."""

    def __init__(self, name: str, novelties: Optional[str], embedder: str = "hash") -> None:
        self.name = name
        self.plain = novelties is None
        self.clock = Clock()
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = Engine(settings(Path(self.tmp.name), parse_novelties(novelties or "none"), embedder), clock=self.clock)

    def close(self) -> None:
        self.tmp.cleanup()

    def chat(self, text: str, user: Optional[str] = None) -> dict:
        self.clock.t += 60_000
        if self.plain:
            # nothing is remembered or learned: answer from the documents alone
            w = variant_world(self.engine.world, "plain")
            res = answer_on(w, text, self.engine.now(), self.engine.retriever, None, lambda world, _t: world.weights)
            return {"text": res["text"], "intent": res["intent"], "retrieval": {"candidates": res["top"]}}
        events = asyncio.run(_collect(self.engine.chat(text, user_id=user)))
        errors = [e for e in events if e["type"] == "error"]
        if errors:
            raise RuntimeError(errors[0]["message"])
        return next(e for e in events if e["type"] == "done")["turn"]

    def feedback(self, turn: dict, verdict: str, reason: Optional[str] = None, target: Optional[str] = None) -> None:
        if not self.plain:
            asyncio.run(self.engine.feedback(turn["id"], verdict, reason, target))

    def advance(self, ms: int) -> None:
        asyncio.run(self.engine.advance_clock(ms))


MAIN = {"plain": None, "adaptive": "none", "+novelties": "all"}
ABLATIONS = {f"−{n}": f"all,-{n}" for n in NOVELTY_NAMES}
