"""Memory behaviour: corrections, history, pin/outdate/delete, feedback, expiry,
documents, persistence and rollback."""

from __future__ import annotations

import pytest

from app.engine import FeedbackExists
from app.forgetting import DAY, strength_at
from app.knowledge_base import extract_text, parse_upload
from conftest import Clock, chat, done_turn, run


def test_correction_replaces_document_claim_and_keeps_history(make_engine):
    eng = make_engine()
    turn = done_turn(chat(eng, "Our department changed the attendance requirement to 80%."))
    m = eng.world.current_memory("attendance.minimum")
    assert m.value == "80%" and m.previous_value == "75%" and m.supersedes == "chunk:regs-3.1"
    assert m.confidence == 0.82  # 0.62 + 0.12 (a value) + 0.08 ("department")
    assert eng.world.chunk("regs-3.1").overridden_by == {"attendance.minimum": m.id}
    assert turn["intent"] == "ack-correction"
    answer = done_turn(chat(eng, "What is the minimum attendance requirement?"))
    assert "80%" in answer["text"] and "75%" in answer["text"]  # new rule, and what it replaced


def test_second_correction_outdates_the_first(make_engine):
    eng = make_engine()
    chat(eng, "Our department changed the attendance requirement to 80%.")
    first = eng.world.current_memory("attendance.minimum")
    chat(eng, "Actually the department raised the attendance requirement to 85%.")
    second = eng.world.current_memory("attendance.minimum")
    assert second.value == "85%" and second.supersedes == first.id
    assert first.status == "outdated" and first.superseded_by == second.id
    excluded = done_turn(chat(eng, "What is the minimum attendance requirement?"))["retrieval"]["excluded"]
    assert any(c["id"] == first.id and c["excluded"].startswith("Replaced by") for c in excluded)


def test_outdate_releases_the_document_override(make_engine):
    eng = make_engine()
    chat(eng, "Our department changed the attendance requirement to 80%.")
    m = eng.world.current_memory("attendance.minimum")
    run(eng.patch_memory(m.id, None, "outdated"))
    assert not eng.world.chunk("regs-3.1").overridden_by
    assert "75%" in done_turn(chat(eng, "What is the minimum attendance requirement?"))["text"]


def test_deleting_a_replacement_restores_what_it_replaced(make_engine):
    eng = make_engine()
    chat(eng, "I prefer concise answers.")
    new = eng.world.current_memory("user.style")
    assert new.value == "concise" and eng.world.memory("mem-style").status == "outdated"
    assert run(eng.delete_memory(new.id))
    restored = eng.world.memory("mem-style")
    assert restored.status == "current" and restored.superseded_by is None
    assert new.id not in eng.world.positions


def test_pinned_temporary_memory_does_not_expire(make_engine):
    clock = Clock()
    eng = make_engine(clock=clock)
    chat(eng, "I have a DBMS exam tomorrow.")
    exam = eng.world.current_memory("event.exam")
    assert exam.expires_at and exam.cls == "temporary"
    run(eng.patch_memory(exam.id, True, None))
    res = run(eng.advance_clock(3 * DAY))
    assert exam.id not in res["expired"] and exam.status == "current"
    run(eng.patch_memory(exam.id, False, None))
    res = run(eng.advance_clock(0))
    assert res["expired"] == [exam.id] and exam.status == "expired"
    assert res["events"][0]["type"] == "memory.expired"


def test_reinforce_raises_confidence(make_engine):
    eng = make_engine()
    before = eng.world.memory("mem-name").confidence
    events = chat(eng, "My name is Harsh.")
    ops = next(e for e in events if e["type"] == "memory_ops")["ops"]
    assert ops[0]["kind"] == "reinforce"
    assert eng.world.memory("mem-name").confidence == pytest.approx(before + 0.04)


def test_flag_previous_lowers_trust_in_the_cited_source(make_engine):
    eng = make_engine()
    first = done_turn(chat(eng, "How many marks do I need to pass?"))
    cited = first["citations"][0]["itemId"]
    before = (eng.world.chunk(cited) or eng.world.memory(cited)).reliability
    events = chat(eng, "Actually, your previous answer was wrong.")
    cls = next(e for e in events if e["type"] == "classification")["classification"]
    assert cls["decision"] == "flag-previous"
    after = (eng.world.chunk(cited) or eng.world.memory(cited)).reliability
    assert after == pytest.approx(round(before * 0.85, 3))
    flagged = next(t for t in eng.world.turns if t.id == first["id"])
    assert flagged.feedback and flagged.feedback.reason == "wrong_source"


def test_feedback_moves_weights_once(make_engine):
    eng = make_engine()
    turn = done_turn(chat(eng, "What is the minimum attendance requirement?"))
    target = turn["retrieval"]["candidates"][1]["id"]
    w0 = eng.world.weights.model_copy()
    res = run(eng.feedback(turn["id"], "not_helpful", "wrong_source", target))
    assert res["feedback"]["reliability"]["id"] == target
    assert sum(res["weights"].values()) == pytest.approx(1.0)
    assert max(abs(res["weights"][f] - w0.get(f)) for f in "SRCI") <= 0.05 + 1e-9  # clipped step
    assert eng.world.weight_history[-1].label.startswith("Wrong source")
    with pytest.raises(FeedbackExists):
        run(eng.feedback(turn["id"], "helpful", None, None))


def test_discarded_small_talk_is_not_stored(make_engine):
    eng = make_engine()
    n = len(eng.world.memories)
    events = chat(eng, "What's the weather like today?")
    assert len(eng.world.memories) == n
    turn = done_turn(events)
    assert turn["intent"] != "arithmetic"


def test_forgetting_curve_and_spacing_effect(make_engine):
    eng = make_engine()
    m = eng.world.memory("mem-cat2").model_copy(deep=True)
    t = m.created_at
    s0 = strength_at(m, t)
    assert s0 == pytest.approx(m.importance * m.confidence)
    no_use = m.model_copy(update={"uses": []})
    assert strength_at(no_use, t + 30 * DAY) < strength_at(m, t + 30 * DAY)  # rehearsal helps
    assert strength_at(m.model_copy(update={"pinned": True}), t + 400 * DAY) == pytest.approx(s0)


# --------------------------------------------------------------------------- documents


def test_markdown_upload_with_numbered_sections_and_claims(make_engine):
    eng = make_engine()
    md = (
        "# Hostel rules 2026\n\n"
        "1.1 Curfew\nAll residents must be back inside the hostel by 10 pm on weekdays.\n\n"
        "1.2 Guests\nGuests may visit the common room between 4 pm and 7 pm.\n"
    ).encode()
    res = run(eng.ingest_upload("hostel_rules.md", md))
    sections = [c["section"] for c in res["chunks"]]
    assert sections == ["1.1", "1.2"]
    assert res["chunks"][0]["claims"][0] == {"slot": "hostel.curfew", "value": "10 pm"}
    conflict = [e for e in res["events"] if e["type"] == "document.conflict"]
    assert conflict and "9:30 pm → 10 pm" in conflict[0]["detail"]
    assert "10 pm" in done_turn(chat(eng, "When is the hostel curfew?"))["text"] or eng.world.current_memory("hostel.curfew").value == "10 pm"
    assert all(c["id"] in eng.world.positions for c in res["chunks"])


def test_sample_circular_confirms_a_matching_correction(make_engine):
    eng = make_engine()
    chat(eng, "Our department changed the attendance requirement to 80%.")
    m = eng.world.current_memory("attendance.minimum")
    res = run(eng.ingest_sample())
    assert any(e["type"] == "memory.confirmed" for e in res["events"])
    assert m.confidence == 0.95 and m.confirmed_by
    again = run(eng.ingest_sample())
    assert again["alreadyIndexed"] is True


def test_sample_circular_on_its_own_resolves_the_conflict(make_engine):
    eng = make_engine()
    res = run(eng.ingest_sample())
    conflict = next(e for e in res["events"] if e["type"] == "document.conflict")
    assert "75% → 80%" in conflict["detail"]
    m = eng.world.current_memory("attendance.minimum")
    assert m.source.type == "document" and m.value == "80%"


def make_pdf(line: str) -> bytes:
    """A minimal, valid one-page PDF with a text layer (with a correct xref table)."""
    content = f"BT /F1 12 Tf 72 720 Td ({line}) Tj ET".encode()
    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        b"<</Length " + str(len(content)).encode() + b">>stream\n" + content + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<</Size {len(objects) + 1}/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def test_pdf_text_extraction():
    text = extract_text("regs.pdf", make_pdf("The minimum pass mark is 45 marks."))
    assert "minimum pass mark is 45" in text
    doc = parse_upload("regs.pdf", text, 0)
    assert doc.sections[0].claims[0].slot == "pass.marks"


def test_broken_pdf_is_a_clear_error():
    with pytest.raises(ValueError, match="Couldn't read that PDF"):
        extract_text("broken.pdf", b"%PDF-1.4 this is not really a pdf")


# --------------------------------------------------------------------------- persistence


def test_state_survives_a_restart(make_engine):
    eng = make_engine()
    chat(eng, "Our department changed the attendance requirement to 80%.")
    run(eng.advance_clock(3_600_000))
    mem_id = eng.world.current_memory("attendance.minimum").id
    again = make_engine()  # same data dir
    assert again.world.current_memory("attendance.minimum").id == mem_id
    assert again.clock_offset == 3_600_000
    assert len(again.world.turns) == 2 and again.world.positions[mem_id] == eng.world.positions[mem_id]
    assert again.store.count() == len(again.world.chunks) + len(again.world.memories)


def test_reset_restores_the_seed(make_engine):
    eng = make_engine()
    chat(eng, "Our department changed the attendance requirement to 80%.")
    run(eng.reset())
    assert eng.world.current_memory("attendance.minimum") is None
    assert eng.world.turns == [] and eng.clock_offset == 0
    assert {m.id for m in eng.world.memories} >= {"mem-name", "mem-style", "mem-library"}


def test_failed_turn_is_rolled_back(make_engine, monkeypatch):
    eng = make_engine()
    n_mem, n_turns = len(eng.world.memories), len(eng.world.turns)

    def boom(*a, **k):
        raise RuntimeError("index unavailable")

    monkeypatch.setattr(eng.retriever, "retrieve", boom)
    events = chat(eng, "Our department changed the attendance requirement to 80%.")
    assert events[-1]["type"] == "error" and "index unavailable" in events[-1]["message"]
    assert len(eng.world.memories) == n_mem and len(eng.world.turns) == n_turns
    assert eng.world.current_memory("attendance.minimum") is None
