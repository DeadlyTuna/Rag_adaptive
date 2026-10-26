"""The research extensions (app/novelty), one block per novelty, plus the whole demo with
every one of them on. tests/test_parity.py keeps checking the core with them all off."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import parse_novelties
from app.forgetting import BASE_TAU, DAY, strength_at
from app.novelty import decay, intent_weights, verify
from app.novelty.context import question_as_of, statement_valid_from
from app.novelty.staleness import chunk_staleness
from app.schemas import Memory, Source, Trust
from conftest import T0, Clock, chat, collect, done_turn, run

ALL = parse_novelties("all")


def say(eng, text: str, user: str | None = None) -> dict:
    return done_turn(run(collect(eng.chat(text, user_id=user))))


def ops_of(eng, text: str, user: str | None = None) -> tuple[list[dict], dict]:
    events = run(collect(eng.chat(text, user_id=user)))
    ops = next(e for e in events if e["type"] == "memory_ops")["ops"]
    return ops, done_turn(events)


def attendance_rules(eng):
    return [m for m in eng.world.memories if m.slot == "attendance.minimum"]


# ------------------------------------------------------------------------- switches


def test_novelty_switches_parse():
    assert parse_novelties("all") == ALL and len(ALL) == 9
    assert parse_novelties("none") == frozenset() == parse_novelties("")
    assert parse_novelties("all,-verify,-multi-user") == ALL - {"verify", "multi_user"}
    assert parse_novelties("scope-time, verify") == {"scope_time", "verify"}


def test_core_turn_carries_no_novelty_fields(make_engine):
    eng = make_engine()  # conftest: novelties off
    turn = done_turn(chat(eng, "What is the minimum attendance requirement?"))
    assert "answerability" not in turn and "context" not in turn and "intentGroup" not in turn["retrieval"]


# ------------------------------------------------------------------------- 1 scope + time


def test_time_expressions():
    now = T0
    assert question_as_of("What was the minimum attendance last month?", now) == now - 30 * DAY
    assert question_as_of("What is the minimum attendance?", now) is None
    assert statement_valid_from("Our department changed it to 80% last semester.", now) == now - 182 * DAY
    assert statement_valid_from("I have a DBMS exam tomorrow.", now) is None
    assert statement_valid_from("From 1 December the library closes at 11 pm.", now) > now


def test_department_correction_is_an_exception_not_a_new_rule(make_engine):
    eng = make_engine(novelties=frozenset({"scope_time"}))
    ack = say(eng, "Our department changed the attendance requirement to 80%.")
    m = eng.world.current_memory("attendance.minimum")
    assert m.applies_to == "CSE" and m.text == "Minimum attendance = 80% (CSE department)"
    assert "for CSE" in ack["text"] and "still applies to other departments" in ack["text"]
    assert "80%" in say(eng, "What is the minimum attendance requirement?")["text"]
    ece = say(eng, "What is the minimum attendance requirement for ECE?")
    assert ece["context"]["scope"] == "ECE" and ece["text"].startswith("For ECE:")
    assert "75%" in ece["text"] and "80%" not in ece["text"]
    # the passage is overridden only for those the correction applies to
    reg = next(c for c in ece["retrieval"]["candidates"] if c["id"] == "regs-3.1")
    assert not reg.get("note")


def test_questions_about_the_past_use_valid_time(make_engine):
    eng = make_engine(novelties=frozenset({"scope_time"}))
    chat(eng, "What is the minimum attendance requirement?")
    say(eng, "Our department changed it to 80% last semester.")
    m = eng.world.current_memory("attendance.minimum")
    assert m.valid_from == T0 - 182 * DAY  # learned today, true since last semester
    year = say(eng, "What was the minimum attendance requirement last year?")
    assert year["context"]["asOf"] == T0 - 365 * DAY and "75%" in year["text"] and "80%" not in year["text"]
    month = say(eng, "What was the minimum attendance requirement last month?")
    assert "80%" in month["text"]
    before = say(eng, "What was the minimum attendance requirement before the change?")
    assert before["text"].startswith("As of") and "80%" not in before["text"]


def test_scheduled_change_takes_effect_on_its_date(make_engine):
    clock = Clock()
    eng = make_engine(clock=clock, novelties=frozenset({"scope_time"}))
    ops, ack = ops_of(eng, "From 1 December the library closes at 11 pm.")
    assert ops[0]["kind"] == "schedule" and ack["intent"] == "ack-schedule"
    new = next(m for m in eng.world.memories if m.value == "closes 11 pm")
    old = eng.world.memory("mem-library")
    assert old.status == "current" and old.valid_to == new.valid_from and new.valid_from > T0
    assert "10 pm" in say(eng, "What are the library timings?")["text"]
    run(eng.advance_clock(new.valid_from - eng.now() + 1000))
    assert old.status == "outdated"
    assert "11 pm" in say(eng, "What are the library timings?")["text"]


# ------------------------------------------------------------------------- 2 intent weights


def test_feedback_trains_the_question_types_weights_with_shrinkage(make_engine):
    eng = make_engine(novelties=frozenset({"intent_weights"}))
    t = say(eng, "What are the library timings?")
    assert t["retrieval"]["intentGroup"] == "time" and t["retrieval"]["groupShare"] == 0
    target = t["retrieval"]["candidates"][1]["id"]
    res = run(eng.feedback(t["id"], "not_helpful", "wrong_source", target))
    assert res["feedback"]["intentGroup"] == "time" and eng.world.intent_counts == {"time": 1}
    w, share = intent_weights.effective(eng.world, "time")
    assert share == pytest.approx(0.25)  # λ = 3 / (3 + 1)
    assert w.dump() != eng.world.weights.dump()
    nxt = say(eng, "When does the library close?")
    assert nxt["retrieval"]["groupShare"] == pytest.approx(0.25) and nxt["retrieval"]["weights"] == w.dump()
    # other question types still rank with the global weights
    rule = say(eng, "How many marks do I need to pass?")
    assert rule["retrieval"]["intentGroup"] == "rule" and rule["retrieval"]["weights"] == eng.world.weights.dump()


# ------------------------------------------------------------------------- 3 verification


def test_implausible_correction_is_held_for_verification(make_engine):
    eng = make_engine(novelties=frozenset({"verify"}))
    ops, ack = ops_of(eng, "The minimum attendance requirement is 5%.")
    m = attendance_rules(eng)[0]
    assert ops[0]["kind"] == "quarantine" and m.status == "pending"
    assert m.verification.score < verify.THRESHOLD and m.verification.against == "regs-3.1"
    assert not eng.world.chunk("regs-3.1").overridden_by
    assert ack["intent"] == "ack-quarantine" and "keep using 75%" in ack["text"]
    answer = say(eng, "What is the minimum attendance requirement?")
    assert "75%" in answer["text"] and "haven't been able to verify" in answer["text"]
    assert any(c["id"] == m.id and c["excluded"].startswith("Unverified") for c in answer["retrieval"]["excluded"])


def test_plausible_department_correction_is_accepted(make_engine):
    eng = make_engine(novelties=frozenset({"verify"}))
    say(eng, "Our department changed the attendance requirement to 80%.")
    m = eng.world.current_memory("attendance.minimum")
    assert m.verification.accepted and m.verification.score >= verify.THRESHOLD
    assert eng.world.chunk("regs-3.1").overridden_by == {"attendance.minimum": m.id}


def test_a_document_promotes_a_matching_pending_correction(make_engine):
    eng = make_engine(novelties=frozenset({"verify"}))
    eng.world.trust["harsh"] = Trust(alpha=1, beta=3)  # a student whose corrections often failed
    say(eng, "The minimum attendance requirement is 80%.")
    m = attendance_rules(eng)[0]
    assert m.status == "pending"
    res = run(eng.ingest_sample())  # the CSE circular: 80%
    assert m.status == "current" and m.shared and m.verification.resolved_by == "document"
    assert any(e["type"] == "memory.verified" for e in res["events"])
    assert eng.world.trust["harsh"].alpha == 2
    assert "80%" in say(eng, "What is the minimum attendance requirement?")["text"]


def test_a_document_rejects_a_conflicting_pending_correction_and_trust_drops(make_engine):
    eng = make_engine(novelties=frozenset({"verify"}))
    say(eng, "The minimum attendance requirement is 5%.")
    m = attendance_rules(eng)[0]
    run(eng.ingest_sample())
    assert m.status == "archived" and m.verification.resolved_by == "document" and not m.verification.accepted
    assert eng.world.trust["harsh"].beta == 2


def test_repeated_rejections_stop_a_student_overriding_documents(make_engine):
    eng = make_engine(novelties=frozenset({"verify"}))
    say(eng, "The minimum attendance requirement is 80%.")
    assert attendance_rules(eng)[-1].status == "current"  # trusted: accepted
    run(eng.delete_memory(attendance_rules(eng)[-1].id))
    for _ in range(3):
        say(eng, "The minimum attendance requirement is 5%.")
        run(eng.verify_memory(attendance_rules(eng)[-1].id, accept=False))
    assert verify.trust_of(eng.world, "harsh").mean == pytest.approx(0.5)
    say(eng, "The minimum attendance requirement is 80%.")
    assert attendance_rules(eng)[-1].status == "pending"  # same claim, now held


def test_moderator_accepts_a_pending_correction(make_engine):
    eng = make_engine(novelties=frozenset({"verify"}))
    say(eng, "The pass mark is 35 marks.")
    m = next(x for x in eng.world.memories if x.slot == "pass.marks")
    assert m.status == "pending"
    res = run(eng.verify_memory(m.id, accept=True))
    assert res["memory"]["status"] == "current" and eng.world.chunk("regs-5.1").overridden_by == {"pass.marks": m.id}
    with pytest.raises(ValueError):
        run(eng.verify_memory(m.id, accept=True))


# ------------------------------------------------------------------------- 4 counterfactual


def test_counterfactual_shows_what_learning_changed(make_engine):
    eng = make_engine(novelties=ALL)
    say(eng, "Our department changed the attendance requirement to 80%.")
    say(eng, "My attendance is 78%.")
    t = say(eng, "Am I eligible for FAT?")
    assert t["text"].startswith("Not yet")
    cf = run(eng.counterfactual(t["id"]))
    v = cf["variants"]
    assert v["adaptive"]["text"].startswith("Not yet") and v["adaptive"]["sameAsAdaptive"]
    assert "Tell me your current attendance" in v["plain"]["text"] and not v["plain"]["sameAsAdaptive"]
    assert "Tell me your current attendance" in v["no_memory"]["text"]
    assert {c["title"] for c in cf["memoriesUsed"]} >= {"Current attendance is 78%"}
    assert cf["recorded"]["text"] == t["text"]
    assert run(eng.counterfactual("nope")) is None


# ------------------------------------------------------------------------- 5 learned forgetting


def _mem(mid: str, cls: str, created: int, uses: list[int]) -> Memory:
    return Memory(
        id=mid, label="x", text=mid, cls=cls, kind="fact", source=Source(type="user", label="You"), confidence=1, importance=1,
        reliability=1, status="current", created_at=created, last_used_at=max([created, *uses]), uses=uses,
    )


def test_decay_fit_is_censored_mle_shrunk_to_the_prior(make_engine):
    eng = make_engine()
    w = eng.world
    now = T0
    w.memories = [_mem("a", "important", now - 30 * DAY, [now - 20 * DAY, now - 10 * DAY]), _mem("b", "important", now - 5 * DAY, [])]
    fit = decay.fit(w, now)["important"]
    # gaps 10 + 10 days (2 events) + censored 10 + 5 days
    assert fit.events == 2 and fit.exposure == 35 * DAY and fit.memories == 2
    assert fit.tau == round((35 * DAY + decay.A * BASE_TAU["important"]) / (2 + decay.A))


def test_learned_forgetting_rates_are_used_and_refit(make_engine):
    eng = make_engine(novelties=frozenset({"learned_decay"}))
    say(eng, "What's my name?")
    assert set(eng.world.decay) == set(BASE_TAU)
    taus = decay.taus(eng.world)
    m = eng.world.memory("mem-courses")
    assert eng.memory_detail("mem-courses")["strength"] == pytest.approx(strength_at(m, eng.now(), taus), abs=1e-4)
    assert strength_at(m, eng.now(), taus) != strength_at(m, eng.now())


# ------------------------------------------------------------------------- 6 answerability


def test_confident_answer_has_high_confidence(make_engine):
    eng = make_engine(novelties=frozenset({"answerability"}))
    t = say(eng, "What is the minimum attendance requirement?")
    assert t["answerability"]["mode"] == "answer" and t["answerability"]["confidence"] >= 0.8


def test_abstains_on_an_open_question_with_no_evidence(make_engine):
    eng = make_engine(novelties=frozenset({"answerability"}))
    t = say(eng, "Who won the football world cup?")
    assert t["answerability"]["mode"] == "abstain" and t["intent"] == "abstain"
    assert "rather not guess" in t["text"] and t["citations"] == []


def test_asks_which_department_when_the_rule_depends_on_it(make_engine):
    eng = make_engine(novelties=ALL)
    say(eng, "Our department changed the attendance requirement to 80%.", "harsh")
    say(eng, "Our department changed the attendance requirement to 80%.", "arjun")  # now shared for CSE
    t = say(eng, "What is the minimum attendance requirement?", "guest")
    assert t["answerability"]["mode"] == "clarify" and t["text"].startswith("Which department are you in?")
    assert "CSE students: 80%" in t["text"] and "everyone else: 75%" in t["text"] and len(t["citations"]) == 2
    say(eng, "I'm in ECE.", "guest")
    t = say(eng, "What is the minimum attendance requirement?", "guest")
    assert t["answerability"]["mode"] == "answer" and "75%" in t["text"]


# ------------------------------------------------------------------------- 7 consolidation


def test_consolidation_merges_duplicates_and_archives_faded_memories(make_engine):
    eng = make_engine(novelties=frozenset({"consolidate"}))
    say(eng, "Prof. Rao said CAT-2 marks will be published on the student portal.")
    dup = eng.world.memories[-1]
    res = run(eng.consolidate_now())
    assert [e["type"] for e in res["events"]] == ["memory.merged"]
    keep = eng.world.memory("mem-cat2")
    assert dup.status == "archived" and dup.merged_into == "mem-cat2" and keep.merged_from == [dup.id]
    assert dup.created_at in keep.uses
    events = run(eng.advance_clock(150 * DAY))["events"]
    archived = {e["refId"] for e in events if e["type"] == "memory.archived"}
    assert "mem-hostel" in archived and eng.world.memory("mem-hostel").status == "archived"
    assert "mem-name" not in archived  # slot facts (the answer to a question) are never archived
    run(eng.patch_memory("mem-hostel", None, "current"))
    assert eng.world.memory("mem-hostel").status == "current"


# ------------------------------------------------------------------------- 8 multi-user


def test_personal_memories_are_private(make_engine):
    eng = make_engine(novelties=ALL)
    say(eng, "My attendance is 78%.", "harsh")
    assert say(eng, "What's my name?", "priya")["text"] == "You haven't told me your name yet."
    assert say(eng, "What's my attendance?", "priya")["text"] == "You haven't told me your attendance yet."
    assert "Harsh" in say(eng, "What's my name?", "harsh")["text"]
    st = eng.state("priya")
    assert not any(m.get("owner") == "harsh" or m["id"] == "mem-name" for m in st["memories"])
    assert {t["context"]["user"] for t in st["turns"]} == {"priya"}
    assert st["user"] == "priya" and st["department"] == "ECE"


def test_a_private_correction_needs_the_crowd_before_it_is_shared(make_engine):
    eng = make_engine(novelties=ALL)
    say(eng, "Our department changed the attendance requirement to 80%.", "harsh")
    assert "80%" not in say(eng, "What is the minimum attendance requirement?", "arjun")["text"]
    ops, ack = ops_of(eng, "Our department changed the attendance requirement to 80%.", "arjun")
    assert ops[0]["kind"] == "corroborate" and ack["intent"] == "ack-corroborate"
    m = attendance_rules(eng)[0]
    assert len(attendance_rules(eng)) == 1 and m.shared and m.reporters == ["harsh", "arjun"]
    assert "80%" in say(eng, "What is the minimum attendance requirement?", "arjun")["text"]
    assert "80%" not in say(eng, "What is the minimum attendance requirement?", "priya")["text"]  # ECE


def test_every_event_is_recorded_once(make_engine):
    eng = make_engine(novelties=ALL)
    say(eng, "Our department changed the attendance requirement to 80%.", "harsh")
    say(eng, "Our department changed the attendance requirement to 80%.", "arjun")  # crowd-verified inside a turn
    say(eng, "The minimum attendance requirement is 5%.", "priya")
    run(eng.verify_memory(attendance_rules(eng)[-1].id, accept=False))
    say(eng, "The pass mark is 10 marks.")
    run(eng.ingest_sample())
    ids = [e.id for e in eng.world.events]
    assert len(ids) == len(set(ids))
    assert {"memory.verified", "memory.corroborated", "memory.rejected"} <= {e.type for e in eng.world.events}


def test_a_private_correction_never_outdates_a_shared_fact(make_engine):
    eng = make_engine(novelties=ALL)
    run(eng.ingest_sample())  # CSE circular: 80% for CSE, shared
    shared = eng.world.current_memory("attendance.minimum")
    assert shared.source.type == "document" and shared.applies_to == "CSE"
    say(eng, "Our department raised the attendance requirement to 85%.", "arjun")
    assert shared.status == "current"
    assert "85%" in say(eng, "What is the minimum attendance requirement?", "arjun")["text"]
    assert "80%" in say(eng, "What is the minimum attendance requirement?", "harsh")["text"]


# ------------------------------------------------------------------------- 9 propagation


def test_outdated_feedback_spreads_to_sibling_passages(make_engine):
    eng = make_engine(novelties=frozenset({"propagation"}))
    t = say(eng, "What is the minimum attendance requirement?")
    before = {c.id: c.reliability for c in eng.world.chunks}
    res = run(eng.feedback(t["id"], "not_helpful", "outdated", "regs-3.1"))
    spread = res["feedback"]["propagated"]
    assert spread and all(eng.world.chunk(r["id"]).doc_id == "regs" for r in spread)
    for r in spread:
        assert before[r["id"]] > r["to"] > eng.world.chunk("regs-3.1").reliability
    assert any(e["type"] == "trust.propagated" for e in res["events"])


# ------------------------------------------------------------------------- 10 staleness


def test_staleness_map(make_engine):
    eng = make_engine(novelties=ALL)
    stale = {s["id"]: s["staleness"] for s in eng.research()["staleness"]}
    assert stale["regs-9.1"] > 0.75  # overridden by the library correction
    assert stale["exams-6"] < stale["regs-3.1"]  # newer document
    assert stale["mem-style-old"] == 1 and stale["mem-viva"] == 1
    assert chunk_staleness(0, 1.0, False) == 0 and chunk_staleness(0, 0.2, False) == 1


# ------------------------------------------------------------------------- 11 reminders


def test_reminders_from_a_temporary_memory(make_engine):
    eng = make_engine(novelties=frozenset({"reminders"}))
    say(eng, "I have a DBMS exam tomorrow.")
    rs = eng.world.reminders
    assert [r.title for r in rs] == ["Tomorrow: DBMS exam", "Today: DBMS exam"] and all(r.status == "scheduled" for r in rs)
    events = run(eng.advance_clock(2 * DAY))["events"]
    assert [e["title"] for e in events if e["type"] == "reminder.due"] == ["Tomorrow: DBMS exam", "Today: DBMS exam"]
    assert all(r.status == "due" for r in rs)


def test_deleting_the_memory_cancels_its_reminders(make_engine):
    eng = make_engine(novelties=frozenset({"reminders"}))
    say(eng, "I have a DBMS exam tomorrow.")
    run(eng.delete_memory(eng.world.reminders[0].memory_id))
    events = run(eng.advance_clock(2 * DAY))["events"]
    assert not [e for e in events if e["type"] == "reminder.due"]
    assert {r.status for r in eng.world.reminders} == {"cancelled"}


# ------------------------------------------------------------------------- everything at once


def test_the_demo_script_runs_with_every_novelty_on(make_engine):
    script = json.loads((Path(__file__).parent / "golden" / "demo_script.json").read_text(encoding="utf-8"))["script"]
    eng = make_engine(novelties=ALL)
    intents = [say(eng, text)["intent"] for text in script]
    assert intents == [
        "attendance-minimum", "ack-correction", "fat-eligibility", "ack-preference", "ack-temporary", "arithmetic", "ack-profile",
        "am-i-eligible", "pass-marks", "ack-flag", "library-hours", "ack-reinforce", "greeting", "ack-knowledge",
    ]


def test_novelty_state_survives_a_restart(make_engine):
    eng = make_engine(novelties=ALL)
    t = say(eng, "What are the library timings?")
    run(eng.feedback(t["id"], "not_helpful", "wrong_source", t["retrieval"]["candidates"][1]["id"]))
    say(eng, "I have a DBMS exam tomorrow.")
    say(eng, "The minimum attendance requirement is 5%.")
    eng2 = make_engine(novelties=ALL)
    w = eng2.world
    assert w.intent_counts == {"time": 1} and len(w.reminders) == 2 and w.decay
    assert [m.status for m in w.memories if m.slot == "attendance.minimum"] == ["pending"]
    assert [u.id for u in w.users] == ["harsh", "arjun", "priya", "guest"]


# ------------------------------------------------------------------------- the HTTP API


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    for k, v in {
        "DATA_DIR": str(tmp_path),
        "EMBEDDER": "hash",
        "VECTOR_STORE": "numpy",
        "LLM_PROVIDER": "none",
        "ANTHROPIC_API_KEY": "",
        "OPENAI_BASE_URL": "",
        "CLASSIFIER": "rules",
        "PIPELINE_PACING": "0",
        "NOVELTIES": "all",
    }.items():
        monkeypatch.setenv(k, v)
    from app.main import app

    with TestClient(app) as c:
        yield c


def sse_done(client, message: str, user: str | None = None) -> dict:
    body = {"message": message, **({"user_id": user} if user else {})}
    with client.stream("POST", "/api/chat", json=body) as r:
        frames = [json.loads(line[5:]) for line in r.iter_lines() if line.startswith("data:")]
    return next(f for f in frames if f["type"] == "done")["turn"]


def test_api_research_endpoints(client):
    t = sse_done(client, "What is the minimum attendance requirement?", "priya")
    assert t["context"]["user"] == "priya" and t["answerability"]["mode"] == "answer"
    sse_done(client, "The minimum attendance requirement is 5%.", "priya")

    r = client.get("/api/research").json()
    assert r["novelties"] == sorted(ALL) and set(r["intentWeights"]) == set(intent_weights.GROUPS)
    assert set(r["decay"]) == set(BASE_TAU) and r["trust"]["priya"]["mean"] == 0.8
    assert [m["value"] for m in r["pending"]] == ["5%"] and len(r["staleness"]) > 30

    pending = r["pending"][0]["id"]
    assert client.post(f"/api/memories/{pending}/verify", json={"accept": False}).json()["memory"]["status"] == "archived"
    assert client.post(f"/api/memories/{pending}/verify", json={"accept": False}).status_code == 409
    assert client.post("/api/memories/nope/verify", json={"accept": True}).status_code == 404

    cf = client.get(f"/api/turns/{t['id']}/counterfactual").json()
    assert set(cf["variants"]) == {"adaptive", "no_memory", "no_feedback", "plain"}
    assert client.get("/api/turns/nope/counterfactual").status_code == 404

    res = client.get("/api/research/resolve", params={"slot": "library.hours"}).json()
    assert res["value"] == "closes 10 pm" and res["source"]["id"] == "mem-library"
    old = client.get("/api/research/resolve", params={"slot": "library.hours", "as_of": T0 - 30 * DAY}).json()
    assert old["value"] == "8 am – 8 pm" and old["source"]["kind"] == "document"

    assert client.post("/api/memories/consolidate").status_code == 200
    priya = client.get("/api/state", params={"user": "priya"}).json()
    assert priya["user"] == "priya" and all(t["context"]["user"] == "priya" for t in priya["turns"])
    assert not any(m["id"] == "mem-name" for m in priya["memories"])
    assert any(m["id"] == "mem-name" for m in client.get("/api/state").json()["memories"])


def test_api_reminders(client):
    sse_done(client, "I have a DBMS exam tomorrow.")
    rems = client.get("/api/state").json()["reminders"]
    assert len(rems) == 2
    assert client.post(f"/api/reminders/{rems[0]['id']}/dismiss").json()["status"] == "dismissed"
    assert client.post("/api/reminders/nope/dismiss").status_code == 404


# ------------------------------------------------------------------------- with an LLM


def test_llm_is_not_called_to_abstain_and_gets_the_time_and_scope(make_engine):
    from test_llm import FakeLLM, context_of

    llm = FakeLLM(reply=lambda messages: "It was 75% [1].")
    eng = make_engine(llm=llm, novelties=ALL)
    t = say(eng, "Who won the football world cup?")
    assert t["answerability"]["mode"] == "abstain" and not llm.calls and t["model"] == "template"
    say(eng, "Our department changed the attendance requirement to 80%.")
    assert "applies to CSE students only" in context_of(llm)
    say(eng, "What was the minimum attendance requirement last year?")
    assert "(Answer for: As of" in context_of(llm)
