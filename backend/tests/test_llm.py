"""The LLM path: what the model is given, how its answer is cited, what happens when
it fails — and the two real SDK clients, exercised over mocked HTTP."""

from __future__ import annotations

import json
import re

import httpx2

from app.generator.llm import AnthropicLLM, OpenAICompatLLM
from conftest import chat, done_turn, run


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


# --------------------------------------------------------------------------- real SDKs, mocked HTTP


def _sse(events: list[tuple[str, dict]]) -> bytes:
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events).encode()


def test_anthropic_client_streams_with_low_effort_and_cached_system():
    seen: dict = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen["body"] = json.loads(request.content)
        msg = {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5", "content": [],
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

    llm = AnthropicLLM("sk-test", "claude-sonnet-5-5", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))

    async def go():
        return "".join([t async for t in llm.stream("SYSTEM", [{"role": "user", "content": "hi"}])])

    assert run(go()) == "80% [1]."
    body = seen["body"]
    assert body["model"] == "claude-sonnet-5-5" and body["stream"] is True
    assert body["output_config"] == {"effort": "low"}
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "temperature" not in body


def test_anthropic_structured_output_request():
    seen: dict = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx2.Response(200, json={
            "id": "msg_2", "type": "message", "role": "assistant", "model": "claude-haiku-4-5-20251001",
            "content": [{"type": "text", "text": json.dumps({"label": "temporary"})}],
            "stop_reason": "end_turn", "stop_sequence": None, "usage": {"input_tokens": 5, "output_tokens": 5},
        })

    llm = AnthropicLLM("sk-test", "claude-sonnet-5-5", "claude-haiku-4-5-20251001", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    out = run(llm.complete_json("SYS", "Message: I have a quiz today", {"type": "object", "properties": {}, "additionalProperties": False}))
    assert out == {"label": "temporary"}
    assert seen["body"]["model"] == "claude-haiku-4-5-20251001"
    assert seen["body"]["output_config"]["format"]["type"] == "json_schema"
    assert "effort" not in seen["body"]["output_config"]  # Haiku 4.5 rejects effort


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
