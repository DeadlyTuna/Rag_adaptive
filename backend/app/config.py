"""Settings, read from environment variables (and backend/.env if present).

See .env.example for every option with an explanation.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


# Research extensions on top of the core pipeline (see app/novelty/). NOVELTIES=all turns
# every one on, "none" turns them off, a list picks some ("scope_time,verify"), and
# "all,-verify" is everything but one (what the benchmark's ablations use).
NOVELTY_NAMES: tuple[str, ...] = (
    "scope_time",  # 1  facts carry a scope (department) and a validity interval
    "intent_weights",  # 2  ranking weights learned per question type, shrunk to the global ones
    "verify",  # 3  corrections that contradict a reliable document are held for verification
    "learned_decay",  # 5  forgetting time constants fitted from how memories actually get reused
    "answerability",  # 6  answer confidence; ask a clarifying question or abstain when unsure
    "consolidate",  # 7  merge near-duplicate memories, archive faded ones
    "multi_user",  # 8  private memories per student; facts shared once enough students confirm
    "propagation",  # 9  feedback on a passage nudges the reliability of its near neighbours
    "reminders",  # 11 reminders scheduled from temporary memories
)


def parse_novelties(raw: str) -> frozenset[str]:
    out: set[str] = set()
    for tok in raw.split(","):
        tok = tok.strip().lower()
        drop = tok.startswith("-")
        name = tok.lstrip("-").replace("-", "_")
        if name in ("all", "*"):
            out = set() if drop else out | set(NOVELTY_NAMES)
        elif name in NOVELTY_NAMES:
            if drop:
                out.discard(name)
            else:
                out.add(name)
    return frozenset(out)


@dataclass
class Settings:
    # where the SQLite database and the Chroma index live
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(BACKEND_DIR / "data"))))

    # embeddings: "minilm" (sentence-transformers) or "hash" (no download; tests)
    embedder: str = field(default_factory=lambda: _env("EMBEDDER", "minilm"))
    embedding_model: str = field(default_factory=lambda: _env("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"))
    # vector store: "chroma" or "numpy"
    vector_store: str = field(default_factory=lambda: _env("VECTOR_STORE", "chroma"))

    # LLM: "auto" picks anthropic if ANTHROPIC_API_KEY is set, else openai-compatible if
    # OPENAI_BASE_URL is set, else none (template answers)
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "auto"))
    anthropic_api_key: str = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    anthropic_model: str = field(default_factory=lambda: _env("ANTHROPIC_MODEL", "claude-opus-5-5"))
    # empty = the same model as the answers
    anthropic_classifier_model: str = field(default_factory=lambda: _env("ANTHROPIC_CLASSIFIER_MODEL"))
    openai_base_url: str = field(default_factory=lambda: _env("OPENAI_BASE_URL"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    openai_model: str = field(default_factory=lambda: _env("OPENAI_MODEL", "llama3.2"))
    openai_classifier_model: str = field(default_factory=lambda: _env("OPENAI_CLASSIFIER_MODEL"))

    # answers: "llm" (when an LLM is configured) or "template"
    answer_mode: str = field(default_factory=lambda: _env("ANSWER_MODE", "llm"))
    # memory classifier: "rules", "ml" (trained scikit-learn model) or "llm"
    classifier: str = field(default_factory=lambda: _env("CLASSIFIER", "ml"))

    # 1.0 = the same stage timing as the frontend's demo, 0 = as fast as possible
    pacing: float = field(default_factory=lambda: _float("PIPELINE_PACING", 0.6))

    novelties: frozenset[str] = field(default_factory=lambda: parse_novelties(_env("NOVELTIES", "all")))

    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in _env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
    )

    def has(self, novelty: str) -> bool:
        return novelty in self.novelties

    @property
    def db_path(self) -> Path:
        return self.data_dir / "adaptive_rag.db"

    @property
    def chroma_path(self) -> Path:
        return self.data_dir / "chroma"

    @property
    def model_path(self) -> Path:
        return self.data_dir / "memory_classifier.joblib"
