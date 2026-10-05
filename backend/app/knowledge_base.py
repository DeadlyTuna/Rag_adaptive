"""Knowledge base: documents → passages ("chunks") → the index.

Upload pipeline:
  1. extract text (.txt / .md directly, .pdf with pypdf)
  2. split into sections by headings (markdown `#` or numbered "3.1 Attendance" lines),
     then into ~110-word passages so each one is about a single rule
  3. detect *claims* — a passage that states a value for a known slot
     (minimum attendance, pass mark, library hours, hostel in-time)
  4. reconcile claims with what is currently believed: a matching memory gets
     confirmed (confidence → 0.95); a different value from a newer document becomes a
     document-sourced memory that replaces the old value (conflict resolved)

Port of parseUpload/ingest/chunksFor in frontend/lib/engine/{engine,seed}.ts.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from .memory_manager import Placer, event
from .retriever import short_doc
from .schemas import ActivityEvent, Chunk, Claim, DocumentMeta, Memory, Source, World
from .slots import DOCUMENT_SLOTS, slot_def
from .util import uid

WORDS_PER_CHUNK = 110


@dataclass
class Section:
    section: str
    title: str
    text: str
    importance: float = 0.5
    claims: list[Claim] = field(default_factory=list)


@dataclass
class SourceDocument:
    id: str
    title: str
    issuer: str
    published: str  # ISO date (yyyy-mm-dd)
    sections: list[Section]

    @staticmethod
    def from_json(d: dict) -> "SourceDocument":
        return SourceDocument(
            id=d["id"],
            title=d["title"],
            issuer=d["issuer"],
            published=d["published"],
            sections=[
                Section(
                    section=s["section"],
                    title=s["title"],
                    text=s["text"],
                    importance=s.get("importance", 0.5),
                    claims=[Claim(**c) for c in s.get("claims", [])],
                )
                for s in d["sections"]
            ],
        )


def published_ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso + "T09:00:00").timestamp() * 1000)


def chunks_for(doc: SourceDocument, indexed_at: int) -> list[Chunk]:
    pub = published_ms(doc.published)
    return [
        Chunk(
            id=f"{doc.id}-{s.section}",
            doc_id=doc.id,
            section=s.section,
            title=s.title,
            text=s.text,
            tokens=round(len(s.text.split()) * 1.3),
            importance=s.importance,
            reliability=1.0,
            published_at=pub,
            indexed_at=indexed_at,
            claims=[c.model_copy() for c in s.claims],
        )
        for s in doc.sections
    ]


def doc_meta_for(doc: SourceDocument, indexed_at: int, chunks: list[Chunk]) -> DocumentMeta:
    return DocumentMeta(
        id=doc.id,
        title=doc.title,
        issuer=doc.issuer,
        published_at=published_ms(doc.published),
        indexed_at=indexed_at,
        chunk_ids=[c.id for c in chunks],
    )


# ---------------------------------------------------------------------------------
# parsing uploads


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader

        try:
            reader = PdfReader(io.BytesIO(data))
            pages = [(p.extract_text() or "") for p in reader.pages]
        except Exception as e:  # noqa: BLE001 — corrupt, encrypted, not really a PDF
            raise ValueError(f"Couldn't read that PDF ({e}). Try exporting it again, or upload a .txt/.md copy.") from e
        text = "\n\n".join(pages)
        if not text.strip():
            raise ValueError("That PDF has no text layer (it's probably scanned images). Upload a .txt/.md copy instead.")
        return text
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


_MD_HEADING = re.compile(r"^#{1,4}\s+(.*)")
# "3.1 Attendance requirement" / "§3.1 Attendance" / "Section 4: Eligibility"
_NUM_HEADING = re.compile(r"^(?:§\s*|section\s+)?(\d+(?:\.\d+){0,3})[.):]?\s+([A-Z][^.!?]{2,80})$", re.I)


def parse_upload(filename: str, raw: str, now: int, doc_id: Optional[str] = None) -> SourceDocument:
    title = re.sub(r"\.(md|txt|markdown|pdf)$", "", filename, flags=re.I)
    title = re.sub(r"[_-]+", " ", title).strip() or "Untitled document"

    blocks: list[tuple[str, str, str]] = []  # (number, title, text)
    cur_num, cur_title, lines = "", "", []

    def flush() -> None:
        body = " ".join(x for x in lines if x).strip()
        if body:
            blocks.append((cur_num, cur_title, body))

    for line in raw.replace("\r", "").split("\n"):
        s = line.strip()
        h = _MD_HEADING.match(s)
        n = _NUM_HEADING.match(s) if not h and len(s) < 90 else None
        if h or n:
            flush()
            lines = []
            if h:
                cur_num, cur_title = "", h.group(1).strip()
                m2 = re.match(r"^(\d+(?:\.\d+)*)[.)]?\s+(.*)", cur_title)
                if m2:
                    cur_num, cur_title = m2.group(1), m2.group(2)
            else:
                cur_num, cur_title = n.group(1), n.group(2).strip()
            continue
        if s == "" and len(" ".join(lines).split()) > 90:
            flush()
            lines = []
            continue
        lines.append(s)
    flush()

    sections: list[Section] = []
    used: set[str] = set()
    for num, btitle, text in blocks:
        words = text.split()
        for part, i in enumerate(range(0, len(words), WORDS_PER_CHUNK)):
            chunk_text = " ".join(words[i : i + WORDS_PER_CHUNK])
            label = num or str(len(sections) + 1)
            if part > 0 or label in used:
                k = 2
                while f"{label}-{k}" in used:
                    k += 1
                label = f"{label}-{k}"
            used.add(label)
            sections.append(
                Section(
                    section=label,
                    title=btitle or " ".join(chunk_text.split()[:5]) + "…",
                    text=chunk_text,
                    importance=0.55,
                )
            )

    for s in sections:
        s.claims = detect_claims(s.text)

    if not sections:
        sections = [Section(section="1", title=title, text=raw[:800], importance=0.5)]
    return SourceDocument(
        id=doc_id or uid("doc"),
        title=title,
        issuer="Uploaded by you",
        published=datetime.fromtimestamp(now / 1000).strftime("%Y-%m-%d"),
        sections=sections,
    )


def detect_claims(text: str) -> list[Claim]:
    """Does this passage state a value for a slot we track (e.g. an attendance %)?"""
    claims: list[Claim] = []
    for slot in DOCUMENT_SLOTS:
        d = slot_def(slot)
        if d and d.value and d.topic.search(text):
            v = d.value(text)
            if v:
                claims.append(Claim(slot=slot, value=v["value"], scope=v.get("scope")))
    return claims


# ---------------------------------------------------------------------------------
# indexing + reconciliation


def _norm(s: Optional[str]) -> Optional[str]:
    return re.sub(r"\s+", "", s.lower()) if s else None


def ingest(world: World, doc: SourceDocument, now: int, placer: Placer) -> tuple[list[ActivityEvent], list[str]]:
    if any(d.id == doc.id for d in world.documents):
        return [], []
    chunks = chunks_for(doc, now)
    meta = doc_meta_for(doc, now, chunks)
    if doc.id == "circular":
        meta.sample = True
    world.documents.append(meta)
    events: list[ActivityEvent] = [event("document.indexed", now, "Document indexed", f"{doc.title} · {len(chunks)} chunks", doc.id)]

    for c in chunks:
        world.chunks.append(c)
        placer(world, c.id, None)

    # reconcile the new document's claims with what is currently believed
    for c in chunks:
        for claim in c.claims:
            d = slot_def(claim.slot)
            label = d.label if d else claim.slot
            mem = world.current_memory(claim.slot)
            if mem and _norm(mem.value) == _norm(claim.value):
                frm = mem.confidence
                mem.confidence = max(mem.confidence, 0.95)
                mem.confirmed_by = c.id
                events.append(
                    event(
                        "memory.confirmed",
                        now + 1,
                        "Fact confirmed by a document",
                        f"{mem.text} · {short_doc(doc.title)} §{c.section} · confidence {frm:.2f} → {mem.confidence:.2f}",
                        mem.id,
                    )
                )
                continue
            # the older document (or memory) that disagrees
            older = next(
                (
                    x
                    for x in world.chunks
                    if x.doc_id != doc.id and any(cl.slot == claim.slot for cl in x.claims) and not (x.overridden_by or {}).get(claim.slot)
                ),
                None,
            )
            older_value = mem.value if mem else (next((cl.value for cl in older.claims if cl.slot == claim.slot), None) if older else None)
            if not older_value or _norm(older_value) == _norm(claim.value):
                continue
            resolved = Memory(
                id=uid("mem"),
                slot=claim.slot,
                label=label,
                text=f"{label} = {claim.value}" + (" (CSE department)" if claim.scope else ""),
                value=claim.value,
                scope=claim.scope,
                cls="correction",
                kind="fact",
                source=Source(type="document", label=short_doc(doc.title), ref=c.id),
                confidence=0.95,
                importance=0.9,
                reliability=1.0,
                status="current",
                pinned=False,
                created_at=now + 1,
                last_used_at=now + 1,
                uses=[],
                previous_value=older_value,
                confirmed_by=c.id,
            )
            if mem:
                mem.status = "outdated"
                mem.superseded_by = resolved.id
                mem.superseded_at = now + 1
                resolved.supersedes = mem.id
            elif older:
                older.overridden_by = {**(older.overridden_by or {}), claim.slot: resolved.id}
                resolved.supersedes = f"chunk:{older.id}"
            world.memories.append(resolved)
            placer(world, resolved.id, mem.id if mem else (older.id if older else None))
            events.append(
                event(
                    "document.conflict",
                    now + 1,
                    "Document conflict resolved",
                    f"{label}: {older_value} → {claim.value} ({short_doc(doc.title)} §{c.section} is newer)",
                    resolved.id,
                )
            )

    world.events.extend(events)
    return events, [c.id for c in chunks]
