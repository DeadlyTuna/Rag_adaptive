"""Shared fixtures. Tests run on the fast, download-free stack: hashed embeddings,
the in-memory NumPy vector store, no LLM, no stage pacing, and a controllable clock."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Callable, Optional

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import Settings  # noqa: E402
from app.engine import Engine  # noqa: E402

T0 = 1_791_000_000_000  # a fixed "now" (Oct 2026) so tests are deterministic


class Clock:
    def __init__(self, t: int = T0) -> None:
        self.t = t

    def __call__(self) -> int:
        return self.t


def make_settings(tmp: Path, **over) -> Settings:
    s = Settings()
    s.data_dir = tmp
    s.embedder = "hash"
    s.vector_store = "numpy"
    s.llm_provider = "none"
    s.anthropic_api_key = ""
    s.openai_base_url = ""
    s.classifier = "rules"
    s.answer_mode = "template"
    s.pacing = 0.0
    for k, v in over.items():
        setattr(s, k, v)
    return s


@pytest.fixture
def make_engine(tmp_path) -> Callable[..., Engine]:
    def _make(clock: Optional[Clock] = None, llm=None, **over) -> Engine:
        eng = Engine(make_settings(tmp_path, **over), clock=clock or Clock())
        if llm is not None:
            from app.classifier.llm import LLMPredictor

            eng.llm = llm
            eng.llm_classifier = LLMPredictor(llm)
            eng.s.answer_mode = "llm"
        return eng

    return _make


def run(coro):
    return asyncio.run(coro)


async def collect(agen) -> list[dict]:
    return [e async for e in agen]


def chat(eng: Engine, text: str) -> list[dict]:
    return run(collect(eng.chat(text)))


def done_turn(events: list[dict]) -> dict:
    done = [e for e in events if e["type"] == "done"]
    assert done, f"no done event: {[e for e in events if e['type'] == 'error']}"
    return done[0]["turn"]
