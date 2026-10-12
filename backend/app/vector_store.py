"""Vector store: where every passage and memory lives as a 384-dim vector.

Stage 1 of retrieval is a nearest-neighbour search here. Two backends with the same
interface:
  • ChromaStore — ChromaDB persistent collection (cosine space) on disk (default)
  • NumpyStore  — brute-force cosine over an in-memory matrix (tests, or no Chroma)

Both keep an in-memory id → vector mirror too, because re-ranking, the "looked up by
topic" items and the 2-D map need exact vectors for arbitrary ids.

Each item carries metadata so the search can be scoped:
  scope="live"     → document passages + *current*, non-preference memories
  scope="inactive" → outdated / expired memories (shown as "filtered out")
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Literal, Optional

import numpy as np

log = logging.getLogger("adaptive-rag")

Scope = Literal["live", "inactive", "all"]


def text_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def _in_scope(meta: dict, scope: Scope) -> bool:
    if scope == "all":
        return True
    if meta["kind"] == "document":
        return scope == "live"
    live = meta["status"] == "current" and not meta["pref"]
    if scope == "live":
        return live
    return meta["status"] != "current"


class NumpyStore:
    name = "numpy"

    def __init__(self) -> None:
        self.vectors: dict[str, np.ndarray] = {}
        self.meta: dict[str, dict] = {}

    # -- writes
    def upsert(self, ids: list[str], vectors: np.ndarray, metas: list[dict], texts: list[str]) -> None:
        for i, v, m in zip(ids, vectors, metas):
            self.vectors[i] = np.asarray(v, dtype=np.float32)
            self.meta[i] = dict(m)

    def update_meta(self, ids: list[str], metas: list[dict]) -> None:
        for i, m in zip(ids, metas):
            if i in self.meta:
                self.meta[i] = dict(m)

    def delete(self, ids: list[str]) -> None:
        for i in ids:
            self.vectors.pop(i, None)
            self.meta.pop(i, None)

    def reset(self) -> None:
        self.vectors.clear()
        self.meta.clear()

    # -- reads
    def ids(self) -> set[str]:
        return set(self.vectors)

    def vector(self, item_id: str) -> Optional[np.ndarray]:
        return self.vectors.get(item_id)

    def metadata(self, item_id: str) -> Optional[dict]:
        return self.meta.get(item_id)

    def search(self, q: np.ndarray, n: int, scope: Scope) -> list[tuple[str, float]]:
        ids = [i for i, m in self.meta.items() if _in_scope(m, scope)]
        if not ids or n <= 0:
            return []
        mat = np.stack([self.vectors[i] for i in ids]).astype(np.float64)
        cos = mat @ q.astype(np.float64)
        order = np.argsort(-cos)[:n]
        return [(ids[k], float(cos[k])) for k in order]

    def count(self) -> int:
        return len(self.vectors)


class ChromaStore(NumpyStore):
    """ChromaDB does the persistent ANN search; the NumpyStore parent keeps the mirror."""

    name = "chroma"

    def __init__(self, path: Path, embedder_name: str, collection: str = "adaptive-rag") -> None:
        super().__init__()
        import chromadb
        from chromadb.config import Settings

        path.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(path), settings=Settings(anonymized_telemetry=False))
        self.collection_name = collection
        self.col = self.client.get_or_create_collection(
            collection,
            configuration={"hnsw": {"space": "cosine"}},
            metadata={"embedder": embedder_name},
            embedding_function=None,
        )
        if (self.col.metadata or {}).get("embedder") != embedder_name:
            log.info("Embedding model changed — rebuilding the vector index.")
            self.reset()
        self._load_mirror()

    def _load_mirror(self) -> None:
        got = self.col.get(include=["embeddings", "metadatas"])
        for i, v, m in zip(got["ids"], got["embeddings"] if got["embeddings"] is not None else [], got["metadatas"] or []):
            self.vectors[i] = np.asarray(v, dtype=np.float32)
            self.meta[i] = dict(m or {})

    def upsert(self, ids, vectors, metas, texts) -> None:
        if not ids:
            return
        super().upsert(ids, vectors, metas, texts)
        self.col.upsert(ids=ids, embeddings=np.asarray(vectors, dtype=np.float32).tolist(), metadatas=metas, documents=texts)

    def update_meta(self, ids, metas) -> None:
        ids2 = [i for i in ids if i in self.meta]
        if not ids2:
            return
        super().update_meta(ids, metas)
        self.col.update(ids=ids2, metadatas=[self.meta[i] for i in ids2])

    def delete(self, ids) -> None:
        if not ids:
            return
        super().delete(ids)
        self.col.delete(ids=list(ids))

    def reset(self) -> None:
        super().reset()
        name = self.collection_name
        embedder = (self.col.metadata or {}).get("embedder")
        try:
            self.client.delete_collection(name)
        except Exception:  # noqa: BLE001 — already gone
            pass
        self.col = self.client.get_or_create_collection(
            name, configuration={"hnsw": {"space": "cosine"}}, metadata={"embedder": embedder or "unknown"}, embedding_function=None
        )

    def set_embedder(self, embedder_name: str) -> None:
        self.col.modify(metadata={"embedder": embedder_name})

    def search(self, q, n, scope) -> list[tuple[str, float]]:
        total = sum(1 for m in self.meta.values() if _in_scope(m, scope))
        if total == 0 or n <= 0:
            return []
        where: dict
        if scope == "live":
            where = {"$or": [{"kind": "document"}, {"$and": [{"kind": "memory"}, {"status": "current"}, {"pref": False}]}]}
        elif scope == "inactive":
            where = {"$and": [{"kind": "memory"}, {"status": {"$ne": "current"}}]}
        else:
            where = {}
        res = self.col.query(
            query_embeddings=[np.asarray(q, dtype=np.float32).tolist()],
            n_results=min(n, total),
            where=where or None,
            include=["distances"],
        )
        return [(i, 1.0 - float(d)) for i, d in zip(res["ids"][0], res["distances"][0])]


def make_store(kind: str, path: Path, embedder_name: str) -> NumpyStore:
    if kind == "numpy":
        return NumpyStore()
    try:
        return ChromaStore(path, embedder_name)
    except Exception as e:  # noqa: BLE001
        log.warning("ChromaDB unavailable (%s) — using the in-memory NumPy store.", e)
        return NumpyStore()
