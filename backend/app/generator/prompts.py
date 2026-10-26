"""What the LLM sees. This file *is* the "augmented" part of retrieval-augmented generation.

The model gets:
  • a fixed system prompt (how to use the context, cite, respect corrections + style)
  • the last few turns of the conversation (short-term memory)
  • a numbered CONTEXT block — the re-ranked passages and memories, each with where it
    came from, how much it's trusted, and whether a correction overrides it
  • what the memory manager just did with the user's message (MEMORY CHANGES)
  • the user's message
"""

from __future__ import annotations

import re
from datetime import datetime

from ..schemas import Candidate, Classification, MemoryOp, Turn, World

SYSTEM_PROMPT = """You are Adaptive RAG, a study assistant for students at a university. You answer questions about academic regulations, exams, attendance and hostel rules, and you remember what each student tells you.

How to answer:
- Use ONLY the numbered CONTEXT items and the ABOUT THE STUDENT facts. Do not use outside knowledge for rules, numbers or dates.
- Cite every claim that comes from a CONTEXT item with its number in square brackets right after the claim, like "The minimum is 80% [2]." Only cite numbers that exist in CONTEXT. Never cite ABOUT THE STUDENT facts — they have no number.
- A memory marked CORRECTION or LEARNED overrides any document passage marked "OVERRIDDEN". When that happens, give the corrected value and say briefly that it replaces the document's value, citing both.
- Prefer current, more reliable, more recent items when two items disagree.
- Questions that need no documents (arithmetic, greetings, small talk) are answered directly and briefly, with no citations.
- If CONTEXT doesn't contain the answer, say you couldn't find it in the documents or in what the student told you, and suggest adding a document on the Knowledge page or telling you the answer.
- Follow the student's answer-style preference exactly:
    concise → one or two sentences;
    step-by-step → numbered steps, each on its own line starting with "1. ", "2. ", …;
    bullet points → short lines starting with "- ".
  With no preference, answer in two to four plain sentences.
- Plain text only: no markdown headings, bold, tables or code blocks. Keep it under 120 words.

When the student's message is a statement rather than a question:
- Read MEMORY CHANGES and acknowledge briefly and specifically what you stored, replaced or let go, citing the memory's number. One or two sentences — don't lecture.
- If a correction replaced an earlier value, name both values ("80%, replacing the regulations' 75% [1][2]").
- If the message was discarded as small talk, reply naturally and say you didn't store it only if it might have looked like information.
- If the student said a previous answer was wrong, thank them, say whose reliability you lowered, and ask what the correct information is."""


# Old answers cite numbers from *their* CONTEXT block; left in, the model would read
# them as references into this turn's numbering.
_CITE = re.compile(r"[ \t]*\[\d+(?:\s*[,–-]\s*\d+)*\]")


def strip_citations(text: str) -> str:
    # spaces only, never newlines, so numbered "1." lines keep their own lines
    return _CITE.sub("", text).strip()


def _day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000).strftime("%d %b %Y")


def describe(world: World, c: Candidate, n: int) -> str:
    if c.kind == "document":
        chunk = world.chunk(c.id)
        meta = f"document passage · {c.title} — {c.subtitle}"
        if chunk:
            meta += f" · published {_day(chunk.published_at)} · reliability {chunk.reliability:.2f}"
        lines = [f"[{n}] ({meta})", c.text]
        if c.note and c.note.startswith("Overridden"):
            lines.append(f"OVERRIDDEN: {c.note}. Use the newer value, not this passage's.")
    else:
        m = world.memory(c.id)
        kind = "CORRECTION" if m and m.cls == "correction" else "LEARNED"
        src = "told by the student" if (m and m.source.type == "user") else f"from {m.source.label}" if m else ""
        meta = f"{kind} memory · {src}"
        if m:
            meta += f" · stored {_day(m.created_at)} · confidence {m.confidence:.2f}"
            if m.previous_value:
                meta += f" · replaced the earlier value {m.previous_value}"
            if m.expires_at:
                meta += f" · temporary, until {_day(m.expires_at)}"
            if m.applies_to:
                meta += f" · applies to {m.applies_to} students only"
            if m.shared and m.source.type == "user":
                meta += f" · confirmed by {len(m.reporters or [])} students"
        lines = [f"[{n}] ({meta})", c.title]
        if m and m.utterance:
            lines.append(f'The student said: "{m.utterance}"')
    return "\n".join(lines)


def build_messages(
    world: World,
    text: str,
    cls: Classification,
    ops: list[MemoryOp],
    context: list[Candidate],
    history: list[Turn],
) -> list[dict]:
    # short-term memory: the last few exchanges, oldest first
    messages: list[dict] = []
    for t in history:
        if t.role == "user":
            messages.append({"role": "user", "content": t.text})
        elif t.text and strip_citations(t.text):
            messages.append({"role": "assistant", "content": strip_citations(t.text)})
    # the API wants strictly alternating turns that start with the user
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    clean: list[dict] = []
    for m in messages:
        if clean and clean[-1]["role"] == m["role"]:
            clean[-1]["content"] += "\n" + m["content"]
        else:
            clean.append(m)
    if clean and clean[-1]["role"] == "user":
        clean.pop()

    parts: list[str] = []
    numbered = {c.id for c in context}

    about = [m for m in world.memories if m.status == "current" and m.kind in ("profile", "preference", "event") and m.id not in numbered]
    if about:
        parts.append("ABOUT THE STUDENT (no citation numbers):\n" + "\n".join(f"- {m.text}" for m in about))

    style = world.current_memory("user.style")
    parts.append(f"ANSWER STYLE: {style.value if style else 'no preference'}")

    if context:
        parts.append("CONTEXT:\n\n" + "\n\n".join(describe(world, c, i + 1) for i, c in enumerate(context)))
    else:
        parts.append("CONTEXT: (nothing relevant was found)")

    if not cls.is_question:
        if ops:
            change_lines = []
            for op in ops:
                ref = ""
                for pos, c in enumerate(context):
                    if c.id in (op.memory_id, op.previous_id):
                        ref += f" [{pos + 1}]"
                change_lines.append(f"- {op.kind.upper()}: {op.title}{(' — ' + op.detail) if op.detail else ''}{ref}")
            parts.append("MEMORY CHANGES (what you just did with this message):\n" + "\n".join(change_lines))
        parts.append(f"CLASSIFIER: {cls.label} → {cls.decision} ({cls.reason})")

    parts.append(f"STUDENT'S MESSAGE:\n{text.strip()}")
    clean.append({"role": "user", "content": "\n\n".join(parts)})
    return clean
