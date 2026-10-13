# Adaptive RAG backend — handoff notes

Paste this file into a new conversation to carry on. Last updated 2026-10-05.

## How it works, in one paragraph

The LLM is one part at the end of the pipeline, not the base everything sits on. Every message goes through five steps:
1. **Classify.** Is this worth remembering, and how?
2. **Update memory.** Add, replace (the old value is kept and marked outdated), reinforce, flag, or discard.
3. **Retrieve.** Find the nearest passages and memories in the vector store, then re-rank them with `Score = w1·S + w2·R + w3·C + w4·I`.
4. **Generate.** The LLM writes the answer from the numbered context and cites it as `[n]`.
5. **Learn from feedback.** This moves the four weights and each source's reliability.

All the learning lives in SQLite and the ranking weights. The LLM is never trained. Without an API key, step 4 uses template answers, so the demo still works.

## Status

- ✅ **Backend in `backend/`: built, tested and committed** (branch `backend-rag-1no7rc`).
  - 44 tests pass (`pytest tests`).
  - A parity test replays a 14-message script, plus feedback, a document upload and a clock jump, and gets exactly the same decisions, rankings and answers as the frontend's TypeScript engine.
  - The real stack (MiniLM, Chroma and the trained classifier) runs the 9-step demo.
- ✅ **Claude integration.** Defaults to `claude-opus-5-5` (the classifier uses the same model unless `ANTHROPIC_CLASSIFIER_MODEL` is set), `effort: "low"`, server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), streaming `max_tokens` 64000 and 16000 for structured output. `LLM_PROVIDER=anthropic` works without a key via an `ant auth login` profile. API errors are logged as one readable line. Old `[n]` markers are stripped from the history the model sees. A saved database that no longer validates is wiped and reseeded.
- ✅ **Memory classifier** (`python -m ml.train_classifier`).
  - Rules baseline: 39/40 on the 40 held-out sentences.
  - TF-IDF + logistic regression: 40/40, with 5-fold CV macro-F1 of 0.88 on 220 training sentences.
  - The held-out set is small, so quote the CV figure.
- ✅ **Frontend live mode is wired** (all 9 steps below). Verified end to end with headless Chromium against uvicorn (`EMBEDDER=hash`): the 9-step script, citation chips while streaming, feedback and its 409, the clock jump expiring the exam memory, sample ingest, pin and delete, the retrieval lab and both classifier evaluations — with no browser console errors. `tsc`, ESLint and `next build` pass.
- ⚠️ **No LLM has been run live.** The Claude and OpenAI-compatible clients are tested over mocked HTTP only; the E2E run used template answers.
- ✅ **`eslint-config-next` is back to `16.3.8`**, matching Next 16.3.8. The v2 commit had set it to `^14.2.35`, which made `npm install` (and Vercel's build) fail with ERESOLVE against eslint 9. A clean `npm ci`, ESLint, `tsc` and `next build` now pass with no extra flags.

## Run it

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # optional: add ANTHROPIC_API_KEY, or point OPENAI_BASE_URL at Ollama
uvicorn app.main:app --reload --port 8000
```
Interactive API docs are at http://localhost:8000/docs.

To point the frontend at it, put `NEXT_PUBLIC_API_URL=http://localhost:8000` in `frontend/.env.local`.

- **First start** downloads all-MiniLM-L6-v2, about 90 MB. Later starts take about 10 s.
- **LLM choice:**
  - Claude: `claude-opus-5-5` with `effort: "low"`, a cached system prompt and refusal fallbacks. Set `ANTHROPIC_API_KEY`, or `LLM_PROVIDER=anthropic` after `ant auth login`. Set `ANTHROPIC_CLASSIFIER_MODEL` to use a different model for `CLASSIFIER=llm`.
  - Free and local: Ollama through `OPENAI_BASE_URL=http://localhost:11434/v1`.
  - None: template answers.

## Code map (`backend/app/`)

| File | What it does |
|---|---|
| `schemas.py` | Pydantic copy of `frontend/lib/engine/types.ts`. JSON is camelCase, and `Weights` keeps `S/R/C/I`. |
| `classifier/` | `rules.py` (cue scorer), `ml.py` (scikit-learn), `llm.py` (structured JSON). `__init__.classify()` adds world-state evidence (conflicts, previous-answer references) and makes the decision. `evaluate.py` computes the metrics. |
| `slots.py` | Topics a statement can set a value for (attendance minimum, pass mark, curfew, …). Same slot with a different value is a conflict. |
| `memory_manager.py` | Statement → memory ops, expiry (`tick`), feedback, pin, outdate, delete (delete restores what was replaced), query expansion. |
| `retriever.py` | Two-stage retrieval: vector search pool of 12, re-rank, top 5, and an "excluded" list of outdated or expired memories. |
| `embeddings.py` | MiniLM (calibrated so cosine 0.25 → S=0 and 0.75 → S=1), or the hashed embedder used in tests. |
| `vector_store.py` | ChromaDB in cosine space, or NumPy. Metadata scopes searches to `live` or `inactive`. |
| `generator/` | `prompts.py` (system prompt and numbered context), `llm.py` (Claude / OpenAI-compatible), `template.py` (fallback answers and intents). |
| `knowledge_base.py` | Uploads (.txt/.md/.pdf) → sections → about 110-word chunks → claims → reconcile: confirm a matching memory, or resolve the conflict with a document-sourced memory. |
| `projection.py` | 2-D map positions (MDS plus out-of-sample placement) in the extent ±1.45 × ±0.8. |
| `db.py` | SQLite with real columns plus a `data` JSON column. Saves are incremental. `feedback_log` is append-only. |
| `engine.py` | Orchestrator: lock, SSE event stream, rollback of a failed turn, all actions. |
| `main.py` | FastAPI routes. |

The `ml/` folder is for training, `seed/` holds the corpus, eval set and training set, and `tests/` holds the tests. The golden file is regenerated with `node --import ./register.mjs make-golden.mts` from `tests/golden`.

## API (implemented)

| Method & path | Notes |
|---|---|
| `POST /api/chat` | Body: `{message, session_id, user_turn_id?, assistant_turn_id?}`. Returns SSE frames `data: <json>\n\n` in this order: `user`, `stage`, `classification`, `stage`, `memory_ops`, **`patch`** `{memories, chunks(changed), positions(new), events}`, `stage`, `retrieval`, `stage`, `token`…, then `done` (or `error`). |
| `GET /api/state` | Returns the World plus `clockOffset` and `serverNow`, and expires due temporary memories. |
| `POST /api/feedback` | `{turn_id, verdict, reason?, target_id?}` → `{weights, feedback, deltas, events}`. A second piece of feedback on the same turn returns 409. |
| `PATCH /api/memories/{id}` | `{pinned?, status?: "outdated"}` → the Memory. |
| `DELETE /api/memories/{id}` | Returns 204. |
| `GET /api/memories/{id}` | Returns the memory, its versions, its strength and the turns it was cited in. |
| `PUT /api/weights` | `{S, R, C, I, label?}` → normalised weights. |
| `POST /api/retrieve` | `{query, weights?, expand?}` → `{query, candidates}`, every item scored. |
| `POST /api/classify` | `{text, predictor?}` → a Classification, with nothing stored. |
| `GET /api/classifier/eval?predictor=rules\|ml` | Returns accuracy, macro-F1, the confusion matrix and misses. |
| `POST /api/documents` | Multipart `file` → `{document, chunks, events}`. Unsupported types return 415; unreadable or empty files return 422. |
| `POST /api/documents/sample` | Adds the sample CSE circular (id `circular`). |
| `POST /api/clock` | `{advance_ms}` → `{now, clockOffset, expired, events}`. |
| `POST /api/reset` | Restores the seeded demo. |
| `GET /api/health` | Shows which answer model, classifier, embedder and vector store are active. |

## Frontend live mode (done — `frontend/lib/store.ts`, `lib/api/live.ts`)

What was implemented, step by step:

1. **`live.ts`.** Add `reset`, `ingestSample`, `retrieve`, `classify`, `classifierEval` and `health`. Send `label` with the weights. Send the client turn ids in `streamChat`. Add `patch` to `ChatEvent`.
2. **One `applyServerWorld(server)` helper** in the store.
   - Toast any events whose ids are new.
   - Take the server world but keep the client's `scriptDone`.
   - Set `clockOffset = serverNow - Date.now()`.
3. **`StoreHydrator`.** In live mode, fetch `/api/state` on hydrate and poll every 20 s while nothing is pending, instead of `tickNow`.
4. **`sendLive`.**
   - Pass `asstId` and `userId` to the server.
   - On `patch`, merge memories, chunks and positions, append the events, toast and pulse.
   - On `retrieval`, set provisional `citations = candidates.map(c => ({n: c.rank, itemId: c.id}))` so chips render while streaming.
   - After `done`, refresh state in its own try/catch, so a failed refresh doesn't turn a good answer into an error.
5. **Feedback, pin/outdate/remove, reset, advance and setWeights.** In live mode, call the API and then `applyServerWorld`. Feedback should set `turn.feedback` from the response so `FeedbackBar` shows the result.
6. **`KnowledgeView`.**
   - Sample: call `/api/documents/sample`.
   - Upload: build a `SeedDocument` from the returned chunks so `IngestSequence` still animates, then refresh. Don't upload a second time.
7. **`RetrievalLab`.** In live mode, fetch `/api/retrieve` once per query and re-score `factors` with the manual weights on the client.
8. **`ClassifierPlayground`.** In live mode, call `/api/classify` (debounced) and `/api/classifier/eval`. Adapt `confusion[][]` and `{expected, got}` to the component's shape. Add a toggle between "Rules" and "Trained model".
9. **Optional.** `StatusStrip` could show the answer model from `/api/health`.

Live-mode details worth knowing: `applyServerWorld` keeps the client's `scriptDone` (except on reset) and any failed turns the server rolled back; events are toasted only when their ids are new; the client clock is `serverNow - Date.now()`. `StoreHydrator` refreshes on load (no toasts) and every 20 s while idle.
