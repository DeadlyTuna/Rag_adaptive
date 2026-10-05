"""The Python backend reproduces the frontend's reference engine step for step.

tests/golden/demo_script.json was produced by running frontend/lib/engine (TypeScript)
over a 14-message script plus feedback, a document upload and a clock jump:

    cd backend/tests/golden && node --import ./register.mjs make-golden.mts

With the same (hashed) embeddings and the rules classifier, the Python port must make
the same decisions, retrieve the same items in the same order with the same factor
values, and write the same answers.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import Clock, collect, run

GOLDEN = Path(__file__).parent / "golden" / "demo_script.json"
TOL = 0.0015  # factor/score rounding (3 dp) may differ by one unit at a boundary


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def test_python_port_matches_typescript_engine(make_engine, golden):
    clock = Clock(golden["t0"])
    eng = make_engine(clock=clock)
    seed_ids = {m.id for m in eng.world.memories}

    py_steps = []
    turn_ids = []
    for i, text in enumerate(golden["script"]):
        clock.t = golden["t0"] + (i + 1) * 60_000
        events = run(collect(eng.chat(text)))
        errors = [e for e in events if e["type"] == "error"]
        assert not errors, errors
        by = {e["type"]: e for e in events}
        turn_ids.append(by["done"]["turn"]["id"])
        py_steps.append(
            {
                "classification": by["classification"]["classification"],
                "ops": by["memory_ops"]["ops"],
                "retrieval": by["done"]["turn"]["retrieval"],
                "answer": by["done"]["turn"]["text"],
                "intent": by["done"]["turn"]["intent"],
                "citations": by["done"]["turn"]["citations"],
                "weights": eng.world.weights.dump(),
            }
        )

    # feedback, upload and expiry, at the same moments
    fb_steps = [s for s in golden["steps"] if s["kind"] == "feedback"]
    clock.t = golden["t0"] + 20 * 60_000
    fb1 = run(eng.feedback(turn_ids[7], "helpful", None, None))
    clock.t += 1000
    target = next(t for t in eng.world.turns if t.id == turn_ids[10]).retrieval.candidates[0].id
    fb2 = run(eng.feedback(turn_ids[10], "not_helpful", "wrong_source", target))
    clock.t = golden["t0"] + 30 * 60_000
    ing = run(eng.ingest_sample())
    clock.t = golden["t0"] + 3 * 86_400_000
    tk = run(eng.advance_clock(0))

    # ---- map the TypeScript side's random memory ids onto ours (same creation order)
    final_ts = next(s for s in golden["steps"] if s["kind"] == "final")
    ts_new = [m["id"] for m in final_ts["memories"] if m["id"] not in seed_ids]
    py_new = [m.id for m in eng.world.memories if m.id not in seed_ids]
    assert len(ts_new) == len(py_new), (ts_new, py_new)
    idmap = dict(zip(ts_new, py_new))

    def mid(x):
        return idmap.get(x, x) if x else x

    msg_steps = [s for s in golden["steps"] if s["kind"] == "message"]
    for i, (ts, py) in enumerate(zip(msg_steps, py_steps)):
        where = f"step {i + 1} {ts['text']!r}"
        c = py["classification"]
        assert c["label"] == ts["classification"]["label"], where
        assert c["decision"] == ts["classification"]["decision"], where
        assert c.get("slot") == ts["classification"]["slot"], where
        assert c.get("value") == ts["classification"]["value"], where
        assert c.get("coref") == ts["classification"]["coref"], where
        assert (c.get("conflict") or {}).get("withId") == mid(ts["classification"]["conflict"]), where
        for k, v in ts["classification"]["probs"].items():
            assert abs(c["probs"][k] - v) < 1e-3, (where, k)
        assert [(s["start"], s["end"], s["kind"]) for s in c["spans"]] == [(s["start"], s["end"], s["kind"]) for s in ts["classification"]["spans"]], where

        assert [(o["kind"], o["title"], o.get("detail")) for o in py["ops"]] == [(o["kind"], o["title"], o["detail"]) for o in ts["ops"]], where
        assert [o.get("memoryId") for o in py["ops"]] == [mid(o["memoryId"]) for o in ts["ops"]], where

        r = py["retrieval"]
        assert r["query"] == ts["query"], where
        assert [(x["id"], x["rank"]) for x in r["candidates"]] == [(mid(x["id"]), x["rank"]) for x in ts["candidates"]], where
        for a, b in zip(r["candidates"], ts["candidates"]):
            for f in "SRCI":
                assert abs(a["factors"][f] - b["factors"][f]) <= TOL, (where, a["id"], f)
            assert abs(a["score"] - b["score"]) <= TOL, (where, a["id"])
            assert a.get("note") == b["note"], (where, a["id"])
        assert [(x["id"], x["excluded"]) for x in r["excluded"]] == [(mid(x["id"]), x["excluded"]) for x in ts["excluded"]], where
        assert [p["id"] for p in r["preferences"]] == [mid(p) for p in ts["preferences"]], where

        assert py["answer"] == ts["answer"], where
        assert py["intent"] == ts["intent"], where
        assert [(x["n"], x["itemId"]) for x in py["citations"]] == [(x["n"], mid(x["itemId"])) for x in ts["citations"]], where
        for f in "SRCI":
            assert abs(py["weights"][f] - ts["weights"][f]) < 1e-9, where

    # ---- feedback
    for got, ts in zip([fb1, fb2], fb_steps):
        fb = got["feedback"]
        for f in "SRCI":
            assert abs(fb["deltas"][f] - ts["feedback"]["deltas"][f]) < 1e-9, ("deltas", f)
            assert abs(got["weights"][f] - ts["weights"][f]) < 1e-9, ("weights", f)
        assert (fb.get("reliability") or {}).get("to") == (ts["feedback"].get("reliability") or {}).get("to")

    # ---- document upload reconciliation + expiry
    ts_ing = next(s for s in golden["steps"] if s["kind"] == "ingest")
    assert [(e["type"], e["title"], e["detail"]) for e in ing["events"]] == [(e["type"], e["title"], e["detail"]) for e in ts_ing["events"]]
    ts_tick = next(s for s in golden["steps"] if s["kind"] == "tick")
    assert len(tk["expired"]) == ts_tick["expired"]

    # ---- the final state of memory
    py_final = {m.id: m for m in eng.world.memories}
    for m in final_ts["memories"]:
        p = py_final[mid(m["id"])]
        assert (p.status, p.text, p.value, p.cls) == (m["status"], m["text"], m["value"], m["cls"]), m["id"]
        assert abs(p.confidence - m["confidence"]) < 1e-9 and abs(p.reliability - m["reliability"]) < 1e-9, m["id"]
    assert {c.id: c.reliability for c in eng.world.chunks if c.reliability != 1} == final_ts["reliability"]
    assert {c.id: {k: mid(v) for k, v in (c.overridden_by or {}).items()} for c in eng.world.chunks if c.overridden_by} == {
        k: {s: mid(v) for s, v in o.items()} for k, o in final_ts["overrides"].items()
    }
    for f in "SRCI":
        assert abs(eng.world.weights.get(f) - final_ts["weights"][f]) < 1e-9
    assert len(eng.world.weight_history) == final_ts["weightHistory"]
    assert len(eng.world.events) == final_ts["events"]
    assert len(eng.world.queries) == final_ts["queries"]
