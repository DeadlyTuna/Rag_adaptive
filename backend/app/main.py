"""FastAPI app — the HTTP API the Next.js frontend talks to.

Run:  uvicorn app.main:app --reload --port 8000   (from the backend/ folder)
Docs: http://localhost:8000/docs  (interactive, generated from these routes)
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings
from .engine import Engine, FeedbackExists
from .schemas import ChatRequest, ClassifyRequest, ClockRequest, FeedbackRequest, MemoryPatch, Model, RetrieveRequest, Weights

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("adaptive-rag")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    engine = Engine(settings)  # loads the embedding model once, opens SQLite + Chroma
    app.state.engine = engine
    i = engine.info()
    log.info("Ready · answers: %s · classifier: %s · embeddings: %s · vector store: %s (%d items)", i["answers"], i["classifier"], i["embedder"], i["vectorStore"], i["indexed"])
    yield


app = FastAPI(title="Adaptive RAG", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=Settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def engine(request: Request) -> Engine:
    return request.app.state.engine


class WeightsUpdate(Weights):
    label: Optional[str] = None


# --------------------------------------------------------------------------- chat


@app.post("/api/chat", summary="Send a message; streams the pipeline as Server-Sent Events")
async def chat(body: ChatRequest, request: Request):
    eng = engine(request)

    async def events():
        async for e in eng.chat(body.message, body.user_turn_id, body.assistant_turn_id):
            yield f"data: {json.dumps(e, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/feedback", summary="Helpful / not helpful on an answer → updates weights and reliability")
async def feedback(body: FeedbackRequest, request: Request):
    try:
        res = await engine(request).feedback(body.turn_id, body.verdict, body.reason, body.target_id)
    except FeedbackExists as e:
        raise HTTPException(409, {"message": str(e), "feedback": e.feedback}) from e
    if res is None:
        raise HTTPException(404, f"No turn with id {body.turn_id}")
    return res


# --------------------------------------------------------------------------- state


@app.get("/api/health")
async def health(request: Request):
    return engine(request).info()


@app.get("/api/state", summary="The whole world: documents, chunks, memories, turns, events, weights, map positions")
async def state(request: Request):
    return await engine(request).fresh_state()


@app.post("/api/reset", summary="Wipe everything and restore the seeded demo")
async def reset(request: Request):
    return await engine(request).reset()


@app.post("/api/clock", summary="Demo clock: jump forward in time (expires temporary memories)")
async def clock(body: ClockRequest, request: Request):
    return await engine(request).advance_clock(body.advance_ms)


# --------------------------------------------------------------------------- memories


@app.get("/api/memories/{mem_id}", summary="A memory with its version chain, strength and where it was cited")
async def get_memory(mem_id: str, request: Request):
    res = engine(request).memory_detail(mem_id)
    if res is None:
        raise HTTPException(404, f"No memory with id {mem_id}")
    return res


@app.patch("/api/memories/{mem_id}", summary="Pin / unpin, or mark outdated")
async def patch_memory(mem_id: str, body: MemoryPatch, request: Request):
    res = await engine(request).patch_memory(mem_id, body.pinned, body.status)
    if res is None:
        raise HTTPException(404, f"No memory with id {mem_id}")
    return res


@app.delete("/api/memories/{mem_id}", status_code=204, summary="Delete (restores whatever it had replaced)")
async def delete_memory(mem_id: str, request: Request):
    if not await engine(request).delete_memory(mem_id):
        raise HTTPException(404, f"No memory with id {mem_id}")
    return Response(status_code=204)


# --------------------------------------------------------------------------- retrieval lab


@app.post("/api/retrieve", summary="Score every passage and memory for a query (no answer generated)")
async def retrieve(body: RetrieveRequest, request: Request):
    return engine(request).rank(body.query, body.weights, body.expand)


@app.put("/api/weights", summary="Set the ranking weights by hand (normalised to sum to 1)")
async def put_weights(body: WeightsUpdate, request: Request):
    return await engine(request).set_weights(Weights(S=body.S, R=body.R, C=body.C, I=body.I), body.label)


@app.post("/api/classify", summary="Classify a message without storing anything")
async def classify(body: ClassifyRequest, request: Request):
    try:
        return await engine(request).classify_only(body.text, body.predictor)
    except Exception as e:  # noqa: BLE001 — e.g. the LLM is unreachable
        raise HTTPException(502, f"Classifier failed: {e}") from e


@app.get("/api/classifier/eval", summary="Accuracy, macro-F1 and confusion matrix on the held-out set")
async def classifier_eval(request: Request, predictor: Literal["rules", "ml"] = "ml"):
    try:
        return engine(request).evaluate_classifier(predictor)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


# --------------------------------------------------------------------------- documents


@app.post("/api/documents", summary="Upload a .txt, .md or .pdf — split, embedded, indexed, reconciled")
async def upload(request: Request, file: UploadFile = File(...)):
    name = file.filename or "document.txt"
    if not name.lower().endswith((".txt", ".md", ".markdown", ".pdf")):
        raise HTTPException(415, "Upload a .txt, .md or .pdf file.")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "That file is over 10 MB.")
    try:
        return await engine(request).ingest_upload(name, data)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/api/documents/sample", summary="Index the sample CSE department circular (80% attendance)")
async def upload_sample(request: Request):
    return await engine(request).ingest_sample()


__all__ = ["app", "Model"]
