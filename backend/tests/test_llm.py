"""The LLM path: what the model is given, how its answer is cited, what happens when
it fails — and the two real SDK clients, exercised over mocked HTTP."""

from __future__ import annotations

import json
import re

import httpx2

from app.generator.llm import FALLBACK_BETA, AnthropicLLM, OpenAICompatLLM, describe_llm_error, make_llm
from conftest import chat, done_turn, make_settings, run


class FakeLLM:
    """Stands in for Claude/Ollama: records what it was sent, replies with a script."""

    name = "fake-llm"
    json_model = "fake-llm"

    def __init__(self, reply=None, fail: bool = False, json_reply=None) -> None:
        self.reply = reply or (lambda messages: "The minimum attendance is 80% [1], replacing the regulations' 75% [2].")
        self.fail = fail
        self.json_reply = json_reply
        self.calls: list[tuple[str, list[dict]]] = []

    async def stream(self, system, messages, max_tokens=0):
        self.calls.append((system, messages))
        if self.fail:
            raise RuntimeError("the model is down")
        for tok in re.findall(r"\S+\s*", self.reply(messages)):
            yield tok

    async def complete_json(self, system, user, schema, max_tokens=0):
        return self.json_reply(user) if self.json_reply else {}


def context_of(llm: FakeLLM) -> str:
    return llm.calls[-1][1][-1]["content"]


def numbered(context: str) -> dict[int, str]:
    """[n] → the line describing context item n."""
    return {int(m.group(1)): m.group(0) for m in re.finditer(r"^\[(\d+)\] \(.*$", context, re.M)}


def test_llm_gets_the_correction_and_cites_it(make_engine):
    llm = FakeLLM()
    eng = make_engine(llm=llm)
    chat(eng, "Our department changed the attendance requirement to 80% last semester.")

    def reply(messages):
        items = numbered(messages[-1]["content"])
        corr = next(n for n, line in items.items() if "CORRECTION memory" in line)
        doc = next(n for n, line in items.items() if "§3.1" in line)
        return f"The minimum attendance is 80% [{corr}], which replaces the regulations' 75% [{doc}]."

    llm.reply = reply
    events = chat(eng, "What is the minimum attendance requirement?")
    turn = done_turn(events)
    ctx = context_of(llm)

    # the model saw the correction, the overridden passage, and the student's facts
    assert "CORRECTION memory" in ctx and "replaced the earlier value 75%" in ctx
    assert "OVERRIDDEN: Overridden for minimum attendance → 80% (your correction)" in ctx
    assert "ABOUT THE STUDENT" in ctx and "Name: Harsh" in ctx
    assert "ANSWER STYLE: step-by-step" in ctx
    # history is passed as alternating turns, ending with the new message
    roles = [m["role"] for m in llm.calls[-1][1]]
    assert roles[-1] == "user" and all(a != b for a, b in zip(roles, roles[1:]))

    # citations point at the right items; the streamed text is the final text
    by_id = {c["id"]: c for c in turn["retrieval"]["candidates"]}
    cited = [by_id[c["itemId"]] for c in turn["citations"]]
    assert {c["kind"] for c in cited} == {"memory", "document"}
    assert any(c["id"] == "regs-3.1" for c in cited)
    assert "".join(e["text"] for e in events if e["type"] == "token").strip() == turn["text"]
    assert turn["model"] == "fake-llm" and turn["intent"] == "attendance-minimum"
    # ranks are the numbers the model was given
    for c in turn["citations"]:
        assert by_id[c["itemId"]]["rank"] == c["n"]


def test_llm_answers_only_cite_items_that_exist(make_engine):
    llm = FakeLLM(reply=lambda m: "Pass mark is 50 [1] and 40 in the FAT [1]. Also see [9] and [0].")
    eng = make_engine(llm=llm)
    turn = done_turn(chat(eng, "How many marks do I need to pass?"))
    assert [c["n"] for c in turn["citations"]] == [1]


def test_topic_lookups_bring_in_the_students_attendance(make_engine):
    llm = FakeLLM(reply=lambda m: "Not yet [1].")
    eng = make_engine(llm=llm)
    chat(eng, "My attendance is 78%.")
    chat(eng, "Our department changed the attendance requirement to 80%.")
    turn = done_turn(chat(eng, "Am I eligible for FAT?"))
    ids = {c["id"] for c in turn["retrieval"]["candidates"]}
    mine = eng.world.current_memory("user.attendance")
    minimum = eng.world.current_memory("attendance.minimum")
    assert mine.id in ids and minimum.id in ids
    assert "Current attendance is 78%" in context_of(llm)


def test_statement_context_includes_what_was_just_stored(make_engine):
    llm = FakeLLM(reply=lambda m: "Noted [1].")
    eng = make_engine(llm=llm)
    chat(eng, "Our department changed the attendance requirement to 80%.")
    ctx = context_of(llm)
    assert "MEMORY CHANGES" in ctx and "REPLACE: Minimum attendance = 80%" in ctx
    assert "CLASSIFIER: correction → replace" in ctx


def test_falls_back_to_the_template_when_the_llm_fails(make_engine):
    eng = make_engine(llm=FakeLLM(fail=True))
    events = chat(eng, "What is the minimum attendance requirement?")
    turn = done_turn(events)
    assert turn["model"] == "template"
    assert "75%" in turn["text"] and turn["citations"]
    assert not [e for e in events if e["type"] == "error"]


def test_arithmetic_skips_retrieval_and_the_llm_context(make_engine):
    llm = FakeLLM(reply=lambda m: "4.")
    eng = make_engine(llm=llm)
    events = chat(eng, "What's 2+2?")
    r = next(e for e in events if e["type"] == "retrieval")["retrieval"]
    assert r["candidates"] == [] and r["pool"] == 0
    assert "nothing relevant was found" in context_of(llm)


def test_llm_classifier_extracts_unknown_facts(make_engine):
    llm = FakeLLM(
        json_reply=lambda user: {
            "label": "important",
            "confidence": 0.9,
            "is_question": False,
            "slot": "none",
            "value": "",
            "knowledge": "DBMS project demo is on 3 November",
            "reason": "a deadline",
        }
    )
    eng = make_engine(llm=llm, classifier="llm")
    events = chat(eng, "fyi the dbms project demo got fixed for 3rd nov")
    cls = next(e for e in events if e["type"] == "classification")["classification"]
    assert cls["predictor"] == "llm" and cls["label"] == "important" and cls["decision"] == "store"
    m = eng.world.memories[-1]
    assert m.text == "DBMS project demo is on 3 November" and m.cls == "important"


def test_history_drops_old_citation_numbers(make_engine):
    llm = FakeLLM(reply=lambda m: "The minimum attendance is 75% [1], per the regulations [2].")
    eng = make_engine(llm=llm)
    chat(eng, "What is the minimum attendance requirement?")
    chat(eng, "And the pass mark?")
    history = llm.calls[-1][1][:-1]
    old = [m["content"] for m in history if m["role"] == "assistant"]
    assert old and "The minimum attendance is 75%, per the regulations." in old
    assert not any(re.search(r"\[\d+\]", t) for t in old)


def test_unreadable_saved_state_is_reseeded(make_engine, tmp_path):
    eng = make_engine()
    chat(eng, "I have a DBMS quiz tomorrow.")
    assert any(t.text == "I have a DBMS quiz tomorrow." for t in eng.world.turns)
    eng.db.conn.execute("UPDATE memories SET data = '{\"broken\": true}'")
    eng.db.conn.commit()
    eng.db.conn.close()
    fresh = make_engine()  # same data dir
    assert fresh.world.memories and all(m.id for m in fresh.world.memories)
    assert not any(t.text == "I have a DBMS quiz tomorrow." for t in fresh.world.turns)
    assert fresh.db.load()[0] is not None  # the reseeded world was saved and reads back


# --------------------------------------------------------------------------- real SDKs, mocked HTTP


def _sse(events: list[tuple[str, dict]]) -> bytes:
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events).encode()


def _stream_handler(seen: dict, model: str = "claude-opus-5-5"):
    def handler(request: httpx2.Request) -> httpx2.Response:
        seen["body"] = json.loads(request.content)
        seen["url"] = str(request.url)
        seen["beta"] = request.headers.get("anthropic-beta", "")
        msg = {"id": "msg_1", "type": "message", "role": "assistant", "model": model, "content": [],
               "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 0}}
        body = _sse([
            ("message_start", {"type": "message_start", "message": msg}),
            ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "80% "}}),
            ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "[1]."}}),
            ("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 4}}),
            ("message_stop", {"type": "message_stop"}),
        ])
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    return handler


def _collect(llm) -> str:
    async def go():
        return "".join([t async for t in llm.stream("SYSTEM", [{"role": "user", "content": "hi"}])])

    return run(go())


def test_anthropic_client_streams_with_low_effort_cached_system_and_fallbacks():
    seen: dict = {}
    llm = AnthropicLLM("sk-test", "claude-opus-5-5", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(_stream_handler(seen))))
    assert _collect(llm) == "80% [1]."
    body = seen["body"]
    assert body["model"] == "claude-opus-5-5" and body["stream"] is True
    assert body["max_tokens"] == 64000
    # Opus 5.5 can't turn thinking off and defaults to medium effort — low is explicit
    assert body["output_config"] == {"effort": "low"} and "thinking" not in body
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "temperature" not in body
    # server-side refusal fallback
    assert body["fallbacks"] == "default"
    assert FALLBACK_BETA in seen["beta"].split(",")
    assert "beta=true" in seen["url"]


def test_anthropic_client_skips_fallbacks_for_models_without_them():
    seen: dict = {}
    llm = AnthropicLLM("sk-test", "claude-haiku-4-5", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(_stream_handler(seen, "claude-haiku-4-5"))))
    assert _collect(llm) == "80% [1]."
    assert "fallbacks" not in seen["body"] and "output_config" not in seen["body"]
    assert FALLBACK_BETA not in seen["beta"]


def _json_handler(seen: dict, model: str):
    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, json={
            "id": "msg_2", "type": "message", "role": "assistant", "model": model,
            "content": [{"type": "text", "text": json.dumps({"label": "temporary"})}],
            "stop_reason": "end_turn", "stop_sequence": None, "usage": {"input_tokens": 5, "output_tokens": 5},
        })

    return handler


SCHEMA = {"type": "object", "properties": {}, "additionalProperties": False}


def test_anthropic_structured_output_defaults_to_the_answer_model():
    seen: dict = {}
    llm = AnthropicLLM("sk-test", "claude-opus-5-5", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(_json_handler(seen, "claude-opus-5-5"))))
    out = run(llm.complete_json("SYS", "Message: I have a quiz today", SCHEMA))
    assert out == {"label": "temporary"}
    body = seen["body"]
    assert body["model"] == "claude-opus-5-5" and body["max_tokens"] == 16000
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["effort"] == "low"


def test_anthropic_classifier_model_is_configurable():
    seen: dict = {}
    llm = AnthropicLLM("sk-test", "claude-opus-5-5", "claude-haiku-4-5", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(_json_handler(seen, "claude-haiku-4-5"))))
    run(llm.complete_json("SYS", "Message: hi", SCHEMA))
    assert seen["body"]["model"] == "claude-haiku-4-5"
    assert "effort" not in seen["body"]["output_config"]  # Haiku 4.5 rejects effort


def test_anthropic_provider_works_without_a_key(tmp_path, monkeypatch):
    # the SDK can resolve ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile itself
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    s = make_settings(tmp_path, llm_provider="anthropic", anthropic_api_key="", anthropic_model="claude-opus-5-5", anthropic_classifier_model="")
    llm = make_llm(s)
    assert isinstance(llm, AnthropicLLM) and llm.name == "claude-opus-5-5" and llm.json_model == "claude-opus-5-5"
    # auto mode still needs a key (or an OpenAI-compatible URL) before it picks a provider
    assert make_llm(make_settings(tmp_path, llm_provider="auto")) is None


def test_anthropic_errors_become_readable_log_lines():
    def fail(status):
        return httpx2.MockTransport(lambda r: httpx2.Response(status, json={"type": "error", "error": {"type": "x", "message": "nope"}}))

    async def go(status):
        llm = AnthropicLLM("sk-bad", "claude-opus-5-5", http_client=httpx2.AsyncClient(transport=fail(status)))
        llm.client = llm.client.with_options(max_retries=0)
        try:
            await llm.complete_json("S", "u", SCHEMA)
        except Exception as e:  # noqa: BLE001
            return describe_llm_error(e)

    assert "ANTHROPIC_API_KEY" in run(go(401))
    assert "ANTHROPIC_MODEL" in run(go(404))
    assert "rate limited" in run(go(429))
    assert "nope" in run(go(400))
    assert "no Claude credentials" in describe_llm_error(TypeError("Could not resolve authentication method. Expected one of api_key, auth_token, or credentials"))


def test_openai_compatible_client_streams_tokens():
    seen: dict = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        chunks = [
            {"id": "c1", "object": "chat.completion.chunk", "created": 1, "model": "llama3.2", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "80% "}, "finish_reason": None}]},
            {"id": "c1", "object": "chat.completion.chunk", "created": 1, "model": "llama3.2", "choices": [{"index": 0, "delta": {"content": "[2]."}, "finish_reason": None}]},
            {"id": "c1", "object": "chat.completion.chunk", "created": 1, "model": "llama3.2", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
        ]
        body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())

    llm = OpenAICompatLLM("http://localhost:11434/v1", "", "llama3.2", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))

    async def go():
        return "".join([t async for t in llm.stream("SYSTEM", [{"role": "user", "content": "hi"}])])

    assert run(go()) == "80% [2]."
    assert seen["url"].endswith("/v1/chat/completions")
    assert seen["body"]["messages"][0] == {"role": "system", "content": "SYSTEM"}
    # room for hidden reasoning tokens on thinking models such as Gemini
    assert seen["body"]["max_tokens"] >= 8000


def test_strip_citations_keeps_lines_and_handles_groups():
    from app.generator.prompts import strip_citations

    assert strip_citations("80% [1], per the rules [2, 3].\n1. Attend [4]\n2. Pass [1-3]") == "80%, per the rules.\n1. Attend\n2. Pass"


def test_a_locked_database_is_not_wiped(make_engine, monkeypatch):
    import sqlite3

    import pytest

    eng = make_engine()
    chat(eng, "I have a DBMS quiz tomorrow.")
    monkeypatch.setattr(eng.db, "_load", lambda: (_ for _ in ()).throw(sqlite3.OperationalError("database is locked")))
    with pytest.raises(sqlite3.OperationalError):
        eng.db.load()
    monkeypatch.undo()
    world, _ = eng.db.load()
    assert any(t.text == "I have a DBMS quiz tomorrow." for t in world.turns)
