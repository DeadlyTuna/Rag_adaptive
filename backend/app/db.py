"""SQLite persistence (stdlib sqlite3, no ORM).

Every entity gets a table with *real columns* for the fields you'd query or show a
professor — a memory's text, value, source, confidence, status, previous value and
timestamps — plus a `data` JSON column holding the complete record exactly as the API
returns it. Try:

    sqlite3 data/adaptive_rag.db
    SELECT text, value, previous_value, source_type, confidence, status FROM memories;
    SELECT verdict, reason, target_id FROM feedback_log;

Saving is incremental: only rows whose content changed since the last save are written.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any, Callable, Optional

from .schemas import World

log = logging.getLogger("adaptive-rag")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, ord INTEGER, title TEXT, issuer TEXT, published_at INTEGER, indexed_at INTEGER, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY, ord INTEGER, doc_id TEXT, section TEXT, title TEXT, text TEXT,
  importance REAL, reliability REAL, published_at INTEGER, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, ord INTEGER, slot TEXT, label TEXT, text TEXT, value TEXT, cls TEXT, kind TEXT,
  source_type TEXT, source_label TEXT, confidence REAL, importance REAL, reliability REAL,
  status TEXT, pinned INTEGER, created_at INTEGER, last_used_at INTEGER, expires_at INTEGER,
  supersedes TEXT, superseded_by TEXT, previous_value TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, ord INTEGER, role TEXT, at INTEGER, text TEXT, intent TEXT, reply_to TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, ord INTEGER, type TEXT, at INTEGER, title TEXT, detail TEXT, ref_id TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS positions (id TEXT PRIMARY KEY, ord INTEGER, x REAL, y REAL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS weight_history (
  seq INTEGER PRIMARY KEY, at INTEGER, s REAL, r REAL, c REAL, i REAL, label TEXT);
CREATE TABLE IF NOT EXISTS queries (seq INTEGER PRIMARY KEY, at INTEGER);
CREATE TABLE IF NOT EXISTS feedback_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, turn_id TEXT, verdict TEXT, reason TEXT, target_id TEXT,
  deltas TEXT, reliability TEXT);
CREATE INDEX IF NOT EXISTS memories_slot_status ON memories (slot, status);
"""

Row = dict[str, Any]
Columns = Callable[[Row], dict[str, Any]]

# table → (World field, extra columns from the record)
KEYED: dict[str, tuple[str, Columns]] = {
    "documents": (
        "documents",
        lambda d: {"title": d["title"], "issuer": d["issuer"], "published_at": d["publishedAt"], "indexed_at": d["indexedAt"]},
    ),
    "chunks": (
        "chunks",
        lambda d: {
            "doc_id": d["docId"],
            "section": d["section"],
            "title": d["title"],
            "text": d["text"],
            "importance": d["importance"],
            "reliability": d["reliability"],
            "published_at": d["publishedAt"],
        },
    ),
    "memories": (
        "memories",
        lambda d: {
            "slot": d.get("slot"),
            "label": d["label"],
            "text": d["text"],
            "value": d.get("value"),
            "cls": d["cls"],
            "kind": d["kind"],
            "source_type": d["source"]["type"],
            "source_label": d["source"]["label"],
            "confidence": d["confidence"],
            "importance": d["importance"],
            "reliability": d["reliability"],
            "status": d["status"],
            "pinned": int(d.get("pinned", False)),
            "created_at": d["createdAt"],
            "last_used_at": d["lastUsedAt"],
            "expires_at": d.get("expiresAt"),
            "supersedes": d.get("supersedes"),
            "superseded_by": d.get("supersededBy"),
            "previous_value": d.get("previousValue"),
        },
    ),
    "turns": (
        "turns",
        lambda d: {"role": d["role"], "at": d["at"], "text": d["text"], "intent": d.get("intent"), "reply_to": d.get("replyTo")},
    ),
    "events": (
        "events",
        lambda d: {"type": d["type"], "at": d["at"], "title": d["title"], "detail": d["detail"], "ref_id": d.get("refId")},
    ),
}


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.executescript(SCHEMA)
        self.conn.commit()
        self._lock = threading.Lock()
        self._hashes: dict[str, dict[str, str]] = {t: {} for t in [*KEYED, "positions"]}
        self._lens = {"weight_history": 0, "queries": 0}

    # ---------------------------------------------------------------------------
    def load(self) -> tuple[Optional[World], dict[str, Any]]:
        """The saved world, or (None, {}) when there is none or it can't be read — in which
        case the database is wiped so the caller reseeds from a clean slate."""
        try:
            return self._load()
        except Exception as e:  # noqa: BLE001 — a schema change or a corrupt row
            why = f"{e.error_count()} invalid fields" if hasattr(e, "error_count") else str(e)
            log.warning("Saved state couldn't be loaded (%s) — starting from the seeded demo.", why)
            self.wipe()
            return None, {}

    def _load(self) -> tuple[Optional[World], dict[str, Any]]:
        cur = self.conn.cursor()
        meta = {k: json.loads(v) for k, v in cur.execute("SELECT key, value FROM meta")}
        if "world" not in meta:
            return None, meta
        w = dict(meta["world"])
        for table, (field, _) in KEYED.items():
            rows = cur.execute(f"SELECT id, ord, data FROM {table} ORDER BY ord").fetchall()
            w[_camel(field)] = [json.loads(r[2]) for r in rows]
            self._hashes[table] = {r[0]: _h(r[1], r[2]) for r in rows}
        pos = cur.execute("SELECT id, ord, data FROM positions ORDER BY ord").fetchall()
        w["positions"] = {r[0]: json.loads(r[2]) for r in pos}
        self._hashes["positions"] = {r[0]: _h(r[1], r[2]) for r in pos}
        wh = cur.execute("SELECT at, s, r, c, i, label FROM weight_history ORDER BY seq").fetchall()
        w["weightHistory"] = [{"at": a, "weights": {"S": s, "R": r, "C": c, "I": i}, "label": lab} for a, s, r, c, i, lab in wh]
        q = cur.execute("SELECT at FROM queries ORDER BY seq").fetchall()
        w["queries"] = [r[0] for r in q]
        self._lens = {"weight_history": len(wh), "queries": len(q)}
        return World.model_validate(w), meta

    def save(self, world: World, extra_meta: dict[str, Any]) -> None:
        d = world.dump()
        with self._lock, self.conn:
            cur = self.conn.cursor()
            head = {
                "version": d["version"],
                "seededAt": d["seededAt"],
                "weights": d["weights"],
                "scriptDone": d.get("scriptDone", []),
            }
            for k, v in {"world": head, **extra_meta}.items():
                cur.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (k, json.dumps(v)))

            for table, (field, columns) in KEYED.items():
                self._sync(cur, table, d[_camel(field)], columns)
            pos_rows = [{"id": k, "x": v[0], "y": v[1], "_data": v} for k, v in d["positions"].items()]
            self._sync(cur, "positions", pos_rows, lambda r: {"x": r["x"], "y": r["y"]}, data_key="_data")

            wh = d["weightHistory"]
            if len(wh) < self._lens["weight_history"]:
                cur.execute("DELETE FROM weight_history")
                self._lens["weight_history"] = 0
            for i, p in enumerate(wh[self._lens["weight_history"] :], start=self._lens["weight_history"]):
                w = p["weights"]
                cur.execute(
                    "INSERT OR REPLACE INTO weight_history (seq, at, s, r, c, i, label) VALUES (?,?,?,?,?,?,?)",
                    (i, p["at"], w["S"], w["R"], w["C"], w["I"], p["label"]),
                )
            self._lens["weight_history"] = len(wh)

            qs = d["queries"]
            if len(qs) < self._lens["queries"]:
                cur.execute("DELETE FROM queries")
                self._lens["queries"] = 0
            cur.executemany(
                "INSERT OR REPLACE INTO queries (seq, at) VALUES (?, ?)",
                [(i, at) for i, at in enumerate(qs[self._lens["queries"] :], start=self._lens["queries"])],
            )
            self._lens["queries"] = len(qs)

    def _sync(self, cur: sqlite3.Cursor, table: str, records: list[Row], columns: Columns, data_key: Optional[str] = None) -> None:
        seen: set[str] = set()
        known = self._hashes[table]
        for ord_, rec in enumerate(records):
            data = json.dumps(rec[data_key] if data_key else rec, ensure_ascii=False, separators=(",", ":"))
            h = _h(ord_, data)
            rid = rec["id"]
            seen.add(rid)
            if known.get(rid) == h:
                continue
            cols = {"id": rid, "ord": ord_, **columns(rec), "data": data}
            names = ", ".join(cols)
            marks = ", ".join("?" for _ in cols)
            cur.execute(f"INSERT OR REPLACE INTO {table} ({names}) VALUES ({marks})", list(cols.values()))
            known[rid] = h
        gone = [rid for rid in known if rid not in seen]
        for rid in gone:
            cur.execute(f"DELETE FROM {table} WHERE id = ?", (rid,))
            known.pop(rid, None)

    def log_feedback(self, at: int, turn_id: str, verdict: str, reason: Optional[str], target_id: Optional[str], deltas: Any, reliability: Any) -> None:
        with self._lock, self.conn:
            self.conn.execute(
                "INSERT INTO feedback_log (at, turn_id, verdict, reason, target_id, deltas, reliability) VALUES (?,?,?,?,?,?,?)",
                (at, turn_id, verdict, reason, target_id, json.dumps(deltas), json.dumps(reliability)),
            )

    def wipe(self) -> None:
        with self._lock, self.conn:
            for t in ["meta", *KEYED, "positions", "weight_history", "queries", "feedback_log"]:
                self.conn.execute(f"DELETE FROM {t}")
        self._hashes = {t: {} for t in [*KEYED, "positions"]}
        self._lens = {"weight_history": 0, "queries": 0}


def _camel(s: str) -> str:
    head, *rest = s.split("_")
    return head + "".join(p.title() for p in rest)


def _h(ord_: int, data: str) -> str:
    return hashlib.sha1(f"{ord_}|{data}".encode("utf-8")).hexdigest()
