"""Embeddings: text → 384-dim unit vector, and a calibrated similarity S ∈ [0, 1].

Two interchangeable embedders:
  • SentenceTransformerEmbedder — all-MiniLM-L6-v2 (the real thing, ~90 MB, CPU is fine)
  • HashEmbedder — the frontend demo's hashed bag-of-words (no download; used by tests
    and when EMBEDDER=hash). Same 384 dims so the rest of the system doesn't care.

Raw cosine similarity is not on the same scale for every model (MiniLM puts unrelated
sentences around 0.0–0.2 and close paraphrases around 0.7–0.9), so each embedder maps
cosine → S with its own calibration curve. S feeds the ranking formula, where it has to
sit on the same 0–1 scale as recency, confidence and importance.
"""

from __future__ import annotations

import logging
import math
from collections import OrderedDict
from typing import Protocol, Sequence

import numpy as np

from .text import TOKEN_WEIGHT, tokens

log = logging.getLogger("adaptive-rag")

DIMS = 384


class Embedder(Protocol):
    name: str
    dims: int

    def embed(self, texts: Sequence[str]) -> np.ndarray: ...
    def calibrate(self, cos: float) -> float: ...


class _Cache:
    """Text → vector LRU so a passage is only ever embedded once per process."""

    def __init__(self, size: int = 5000):
        self.size = size
        self.data: OrderedDict[str, np.ndarray] = OrderedDict()

    def get(self, key: str):
        v = self.data.get(key)
        if v is not None:
            self.data.move_to_end(key)
        return v

    def put(self, key: str, v: np.ndarray) -> None:
        self.data[key] = v
        if len(self.data) > self.size:
            self.data.popitem(last=False)


# ---------------------------------------------------------------------------------
# hashed bag of words (port of frontend/lib/engine/embed.ts)


def _fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


class HashEmbedder:
    name = "hash-bow-384"
    dims = DIMS

    def __init__(self) -> None:
        self.cache = _Cache()

    def _one(self, text: str) -> np.ndarray:
        hit = self.cache.get(text)
        if hit is not None:
            return hit
        toks = tokens(text)
        counts: dict[str, float] = {}

        def add(feature: str, w: float) -> None:
            counts[feature] = counts.get(feature, 0.0) + w

        # numbers only carry meaning next to words ("80%" in an attendance rule, not "2+2")
        has_words = any(not t.startswith("#") for t in toks)
        for i, t in enumerate(toks):
            is_num = t.startswith("#")
            if is_num and not has_words:
                continue
            add(t, 0.3 if is_num else TOKEN_WEIGHT.get(t, 1.0))
            if i > 0 and not is_num and not toks[i - 1].startswith("#"):
                add(toks[i - 1] + "_" + t, 0.5)

        # Mirrors the browser's Float32Array arithmetic exactly (add in double precision,
        # round to float32 on every store) so the parity test can compare to the frontend.
        acc = np.zeros(DIMS, dtype=np.float64)
        for feature, tf in counts.items():
            h = _fnv1a(feature)
            sign = -1.0 if (h >> 31) & 1 else 1.0
            i = h % DIMS
            acc[i] = np.float32(acc[i] + sign * (tf if tf <= 1 else 1 + math.log(tf)))
        norm = math.sqrt(sum(float(x) * float(x) for x in acc)) or 1.0
        v = (acc / norm).astype(np.float32)
        self.cache.put(text, v)
        return v

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, DIMS), dtype=np.float32)
        return np.stack([self._one(t) for t in texts])

    def calibrate(self, cos: float) -> float:
        # strong topical match ≈ 0.8, incidental word overlap ≈ 0
        x = max(0.0, (cos - 0.05) / 0.75)
        return min(1.0, x**0.8)


# ---------------------------------------------------------------------------------
# sentence-transformers


class SentenceTransformerEmbedder:
    dims = DIMS

    # Calibrated on the demo corpus: background passages sit at cosine ≈ 0.2 (it's a narrow
    # domain — everything mentions courses and exams), topical hits 0.45–0.6, the passage
    # that answers the question 0.65–0.75. So 0.25 → S=0 and 0.75 → S=1.
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2", lo: float = 0.25, hi: float = 0.75):
        from sentence_transformers import SentenceTransformer  # heavy import, done once

        log.info("Loading embedding model %s …", model_name)
        self.model = SentenceTransformer(model_name, device="cpu")
        self.name = model_name.split("/")[-1]
        get_dims = getattr(self.model, "get_embedding_dimension", None) or self.model.get_sentence_embedding_dimension
        dims = get_dims()
        if dims != DIMS:
            log.warning("%s has %d dims (expected %d) — fine, but the vector store must be rebuilt", model_name, dims, DIMS)
            self.dims = dims
        self.lo, self.hi = lo, hi
        self.cache = _Cache()

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        out: list[np.ndarray | None] = [self.cache.get(t) for t in texts]
        todo = [i for i, v in enumerate(out) if v is None]
        if todo:
            vecs = self.model.encode(
                [texts[i] for i in todo], normalize_embeddings=True, convert_to_numpy=True, batch_size=32, show_progress_bar=False
            ).astype(np.float32)
            for i, v in zip(todo, vecs):
                self.cache.put(texts[i], v)
                out[i] = v
        if not out:
            return np.zeros((0, self.dims), dtype=np.float32)
        return np.stack(out)  # type: ignore[arg-type]

    def calibrate(self, cos: float) -> float:
        x = max(0.0, (cos - self.lo) / (self.hi - self.lo))
        return min(1.0, x**0.9)


def make_embedder(kind: str, model_name: str) -> Embedder:
    if kind == "hash":
        return HashEmbedder()
    try:
        return SentenceTransformerEmbedder(model_name)
    except Exception as e:  # missing package, no network on first run, …
        log.warning("Could not load %s (%s) — falling back to the hashed embedder.", model_name, e)
        return HashEmbedder()


def cosine_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rows of a × rows of b (both unit-normalised) → cosine similarities."""
    return a.astype(np.float64) @ b.astype(np.float64).T
