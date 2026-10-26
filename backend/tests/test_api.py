"""The HTTP API exactly as the frontend calls it (frontend/lib/api/live.ts)."""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.seed import WORLD_VERSION


@pytest.fixture
def client(tmp_path, monkeypatch):
    for k, v in {
        "DATA_DIR": str(tmp_path),
        "EMBEDDER": "hash",
        "VECTOR_STORE": "numpy",
        "LLM_PROVIDER": "none",
        "ANTHROPIC_API_KEY": "",
        "OPENAI_BASE_URL": "",
        "CLASSIFIER": "rules",
        "PIPELINE_PACING": "0",
        "NOVELTIES": os.environ.get("TEST_API_NOVELTIES", "none"),  # tests/test_novelties.py covers them
    }.items():
        monkeypatch.setenv(k, v)
    from app.main import app

    with TestClient(app) as c:
        yield c


def sse(client: TestClient, message: str, **ids) -> list[dict]:
    body = {"message": message, "session_id": "demo", **ids}
    with client.stream("POST", "/api/chat", json=body, headers={"Accept": "text/event-stream"}) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        raw = "".join(r.iter_text())
    assert "\r\n" not in raw  # the browser parser splits on "\n\n" exactly
    frames = [f for f in raw.split("\n\n") if f]
    out = []
    for f in frames:
        assert f.startswith("data: ")
        out.append(json.loads(f[6:]))
    return out


def test_health_and_state_shape(client):
    h = client.get("/api/health").json()
    assert h["answers"] == "template" and h["vectorStore"] == "numpy"
    s = client.get("/api/state").json()
    assert s["version"] == WORLD_VERSION and s["scriptDone"] == [] and isinstance(s["clockOffset"], int)
    assert set(s["weights"]) == {"S", "R", "C", "I"}
    assert set(s["weightHistory"][0]["weights"]) == {"S", "R", "C", "I"}
    ids = {c["id"] for c in s["chunks"]} | {m["id"] for m in s["memories"]}
    assert ids == set(s["positions"])
    for x, y in s["positions"].values():
        assert -1.45 <= x <= 1.45 and -0.8 <= y <= 0.8
    m = next(m for m in s["memories"] if m["id"] == "mem-library")
    assert m["supersedes"] == "chunk:regs-9.1" and m["previousValue"] == "8 am – 8 pm" and "lastUsedAt" in m


def test_chat_stream_order_and_client_ids(client):
    events = sse(client, "Our department changed the attendance requirement to 80% last semester.", user_turn_id="turn-u1", assistant_turn_id="turn-a1")
    types = [e["type"] for e in events]
    assert types[:9] == ["user", "stage", "classification", "stage", "memory_ops", "patch", "stage", "retrieval", "stage"]
    assert types[-1] == "done" and set(types[9:-1]) == {"token"}
    patch = next(e for e in events if e["type"] == "patch")
    new_mem = next(o for o in next(e for e in events if e["type"] == "memory_ops")["ops"] if o.get("memoryId"))["memoryId"]
    assert new_mem in patch["positions"] and any(m["id"] == new_mem for m in patch["memories"])
    assert [c["id"] for c in patch["chunks"]] == ["regs-3.1"]  # its claim is now overridden
    assert patch["events"][0]["type"] == "memory.replaced"
    assert [e["stage"] for e in events if e["type"] == "stage"] == ["classifying", "remembering", "retrieving", "generating"]
    user = events[0]["turn"]
    done = events[-1]["turn"]
    assert user["id"] == "turn-u1" and done["id"] == "turn-a1" and done["replyTo"] == "turn-u1"
    assert "".join(e["text"] for e in events if e["type"] == "token") == done["text"]
    cls = next(e for e in events if e["type"] == "classification")["classification"]
    assert cls["decision"] == "replace" and set(cls["probs"]) == {"persistent", "important", "correction", "temporary", "irrelevant"}
    r = next(e for e in events if e["type"] == "retrieval")["retrieval"]
    assert r["query"].startswith("Our department changed the attendance requirement to 80% last semester.")
    assert set(r["candidates"][0]["factors"]) == {"S", "R", "C", "I"} and len(r["ping"]) == 2
    # the same ids can't be reused
    again = sse(client, "Hello!", user_turn_id="turn-u1", assistant_turn_id="turn-a1")
    assert again[0]["turn"]["id"] != "turn-u1"


def test_feedback_then_conflict(client):
    done = sse(client, "What is the minimum attendance requirement?")[-1]["turn"]
    target = done["retrieval"]["candidates"][1]["id"]
    r = client.post("/api/feedback", json={"turn_id": done["id"], "verdict": "not_helpful", "reason": "wrong_source", "target_id": target})
    assert r.status_code == 200
    body = r.json()
    assert set(body["weights"]) == {"S", "R", "C", "I"} and body["feedback"]["targetId"] == target
    assert body["feedback"]["reliability"]["from"] > body["feedback"]["reliability"]["to"]
    assert client.post("/api/feedback", json={"turn_id": done["id"], "verdict": "helpful"}).status_code == 409
    assert client.post("/api/feedback", json={"turn_id": "nope", "verdict": "helpful"}).status_code == 404
    turns = client.get("/api/state").json()["turns"]
    assert next(t for t in turns if t["id"] == done["id"])["feedback"]["verdict"] == "not_helpful"


def test_memory_patch_and_delete(client):
    r = client.patch("/api/memories/mem-cat2", json={"pinned": True})
    assert r.status_code == 200 and r.json()["pinned"] is True
    r = client.patch("/api/memories/mem-cat2", json={"status": "outdated"})
    assert r.json()["status"] == "outdated"
    assert client.get("/api/memories/mem-style").json()["versions"][0]["id"] == "mem-style-old"
    assert client.delete("/api/memories/mem-cat2").status_code == 204
    assert client.delete("/api/memories/mem-cat2").status_code == 404
    state = client.get("/api/state").json()
    assert "mem-cat2" not in {m["id"] for m in state["memories"]} and "mem-cat2" not in state["positions"]


def test_weights_retrieve_classify_eval(client):
    w = client.put("/api/weights", json={"S": 2, "R": 1, "C": 1, "I": 0, "label": "Set by hand"}).json()
    assert w == pytest.approx({"S": 0.5, "R": 0.25, "C": 0.245, "I": 0.005}, abs=0.02) and sum(w.values()) == pytest.approx(1)
    assert client.get("/api/state").json()["weightHistory"][-1]["label"] == "Set by hand"

    r = client.post("/api/retrieve", json={"query": "When can I write my FAT?"}).json()
    assert r["query"].startswith("When can I write my FAT? ") and r["candidates"][0]["id"] == "regs-4.3"
    scores = [c["score"] for c in r["candidates"]]
    assert scores == sorted(scores, reverse=True)

    before = len(client.get("/api/state").json()["memories"])
    c = client.post("/api/classify", json={"text": "I have a viva tomorrow."}).json()
    assert c["label"] == "temporary" and c["decision"] == "keep-temporarily"
    assert len(client.get("/api/state").json()["memories"]) == before  # nothing stored

    e = client.get("/api/classifier/eval", params={"predictor": "rules"}).json()
    assert e["total"] == 40 and e["correct"] >= 38 and len(e["confusion"]) == 5


def test_documents_clock_reset(client):
    md = "# Library notice\n\n## Timings\nThe central library is open 8 am – 11 pm on weekdays from November.\n"
    r = client.post("/api/documents", files={"file": ("library_notice.md", md.encode(), "text/markdown")})
    assert r.status_code == 200
    body = r.json()
    assert body["document"]["title"] == "library notice" and body["chunks"][0]["claims"][0]["slot"] == "library.hours"
    assert client.post("/api/documents", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 415
    assert client.post("/api/documents", files={"file": ("empty.txt", b"   ", "text/plain")}).status_code == 422

    s1 = client.post("/api/documents/sample").json()
    assert s1["document"]["id"] == "circular" and s1["document"]["sample"] is True
    assert client.post("/api/documents/sample").json()["alreadyIndexed"] is True

    sse(client, "I have a DBMS exam tomorrow.")
    c = client.post("/api/clock", json={"advance_ms": 3 * 86_400_000}).json()
    assert c["clockOffset"] == 3 * 86_400_000 and len(c["expired"]) == 1

    fresh = client.post("/api/reset").json()
    assert fresh["clockOffset"] == 0 and fresh["turns"] == [] and not any(d["id"] == "circular" for d in fresh["documents"])


def test_cors_preflight_for_the_next_dev_server(client):
    r = client.options(
        "/api/feedback",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "http://localhost:3000"
