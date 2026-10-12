# Adaptive RAG

An assistant that gets better at answering as it talks to people: it remembers what
matters, replaces facts that went out of date, and re-ranks its retrieval from feedback —
without retraining the language model.

This repository holds the **web interface** (`frontend/`, Next.js) and the **backend**
(`backend/`, FastAPI). The interface runs end-to-end on its own with an in-browser demo
engine, and switches to the backend when `NEXT_PUBLIC_API_URL` is set. The full design — concept, tokens, motion system, page specs, data
model and API contract — is in [DESIGN_PLAN.md](DESIGN_PLAN.md).

## Run it

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Requires Node 20+ and a browser with WebGL 2 (any current
Chrome, Edge, Firefox or Safari).

## What's in the interface

| Page | What it shows |
|---|---|
| `/` | The story of the project as a scroll-driven page over a live 3-D “knowledge terrain”: why ordinary RAG goes stale, the memory classifier, how corrections replace facts, the ranking formula, the feedback loop, the architecture. |
| `/console` | Chat with the assistant. Every message is classified (with probabilities and the decision), memory writes are shown as they happen, and the inspector lists exactly which passages and memories were retrieved and how each scored on similarity, recency, confidence and importance. Answers cite their sources; feedback re-weights retrieval. |
| `/memory` | Everything it has learned: KPI row, a 3-D/2-D terrain of memory strength, an activity feed, the memory bank, facts that changed (version chains), and an **“As of” timeline** to rewind or replay how memory evolved. Click any memory for its record and forgetting curve. |
| `/retrieval` | The ranking formula with live weights, a re-ranking playground, how feedback moved the weights over time, source reliability, and a classifier playground with a confusion matrix on a labelled set. |
| `/knowledge` | The documents it answers from, their passages and embedding fingerprints, and live ingestion (drop a `.txt`/`.md` file, or add the sample department circular). |

**Guided demo** — the console has a demo script (the story from the project brief):

1. *What is the minimum attendance requirement?* → 75% from the regulations
2. *Our department changed it to 80% last semester.* → classified as a correction; 75% is marked outdated
3. *When can I write my FAT?* → uses 80%, not the PDF
4. *I prefer concise answers.* → replaces the earlier step-by-step preference
5. *I have a DBMS exam tomorrow.* → kept only until the exam is over
6. *What's 2+2?* → answered, not stored
7. *My attendance is 78%.* → remembered about you
8. *Am I eligible for FAT?* → “Not yet — 78% is below your department's 80%”
9. *Skip past the exam* → the temporary memory expires

Useful while presenting: `Ctrl/⌘ K` opens the command palette (run any step, change the
demo clock, speed up the pipeline animation, reset the demo). `+1 h / +1 d / +1 w` in the
top bar advance the demo clock. **Reset** in the left rail restores the starting state.

## The backend

`backend/` is a FastAPI service that does for real what the demo engine simulates:
sentence-transformer embeddings (all-MiniLM-L6-v2) in a Chroma vector store, a trained
memory classifier (TF-IDF + logistic regression), SQLite for memories, turns and feedback,
and an LLM that writes the cited answers.

### Run it

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # optional — every setting has a working default
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs. The first start downloads the embedding model
(about 90 MB). Then point the interface at it and restart `npm run dev`:

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The status bar then reads **Live API · <answer model>**, and every page (chat, feedback,
pin/outdate/delete, the demo clock, uploads, the retrieval lab, the classifier
playground, reset) goes through the API.

### How the LLM is connected

The LLM is the last step of the pipeline, not its foundation. Every message is
classified, written to memory, and used to retrieve and re-rank passages and memories
(`score = w1·S + w2·R + w3·C + w4·I`) before the model sees anything. The model gets a
fixed system prompt, the last few turns, and a numbered CONTEXT block, and must cite
items as `[n]`. All the learning — memories, corrections, source reliability, ranking
weights — lives in SQLite; the model itself is never trained. `backend/app/generator/`
holds the prompt (`prompts.py`) and the providers (`llm.py`), chosen in `backend/.env`:

| Setting | What answers |
|---|---|
| `ANTHROPIC_API_KEY=…` | **Claude**, through the official `anthropic` SDK. Defaults to `claude-opus-5-5` at `effort: low`, streamed, with the system prompt cached and server-side refusal fallbacks (`fallbacks: "default"`) turned on. `LLM_PROVIDER=anthropic` with no key uses an `ant auth login` profile instead. |
| `OPENAI_BASE_URL=http://localhost:11434/v1` | Any **OpenAI-compatible** server — e.g. a free local model in Ollama (`ollama pull llama3.2:3b`). |
| `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/` | **Gemini** through the same OpenAI-compatible client (`LLM_PROVIDER=openai`, `OPENAI_API_KEY=<Gemini key>`, `OPENAI_MODEL=gemini-3.8-flash`). The free tier allows about 20 requests per model per day, one per chat message; switch `OPENAI_MODEL` to another Gemini model when one runs out. |
| neither | **Template answers** built from the same retrieved context, so the whole demo still works offline. |

`CLASSIFIER=llm` also lets the model classify messages (structured JSON output);
the default is the trained scikit-learn model. If the LLM fails, the turn falls back to
the template answer and the log says why.

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | One message → Server-Sent Events: `user`, `classification`, `memory_ops`, `patch`, `retrieval`, `token`…, `done` |
| `GET /api/state` | The whole world (documents, chunks, memories, turns, events, weights, map positions) |
| `POST /api/feedback` | Helpful / not helpful → moves the weights and a source's reliability |
| `GET · PATCH · DELETE /api/memories/{id}` | Inspect, pin / mark outdated, delete |
| `PUT /api/weights` · `POST /api/retrieve` | Retrieval lab |
| `POST /api/classify` · `GET /api/classifier/eval` | Classifier playground and its accuracy on 40 held-out sentences |
| `POST /api/documents` · `POST /api/documents/sample` | Upload `.txt` / `.md` / `.pdf`, or add the sample circular |
| `POST /api/clock` · `POST /api/reset` · `GET /api/health` | Demo clock, reset, what's running |

Field-level details are in [BACKEND_HANDOFF.md](BACKEND_HANDOFF.md).

### Tests

```bash
cd backend
pytest tests
```

44 tests, on hashed embeddings and an in-memory vector store, so nothing is downloaded and
no API key is needed. They cover the memory manager, the API routes, a parity test that
replays the demo script against the frontend engine's recorded output, and the LLM path
(the prompt and citations with a fake model; the Claude and OpenAI-compatible clients over
mocked HTTP).

## Project structure

```
backend/
  app/                 FastAPI app: engine, classifier, memory manager, retriever, generator, db
  ml/                  training script for the memory classifier
  seed/                corpus, classifier training set, held-out evaluation set
  tests/               pytest suite
frontend/
  app/                 routes: landing, (app)/console, memory, retrieval, knowledge
  components/
    terrain/           WebGL knowledge terrain (three.js + custom shaders)
    landing/           scroll story sections and the fixed 3-D stage
    console/           transcript, classifier strip, inspector, composer, feedback
    memory/            scrubber, KPI tiles, memory bank, drawer, forgetting curve
    retrieval/         weights, ranking, learning curve, classifier playground
    knowledge/         ingestion sequence, passages, fingerprints
    shell/             rail, status strip, command palette, toasts
    ui/                glyphs, buttons, panels, score bars, motion primitives
  lib/
    engine/            the demo engine (classify, retrieve, compose, learn, forget, seed)
    api/live.ts        HTTP/SSE client for the FastAPI backend
    store.ts           Zustand store that stages each message for animation
```

Built with Next.js 16, React 19, Tailwind CSS 4, Motion, three.js, Lenis, Zustand and cmdk.
Typefaces: Anybody (display) and Recursive (text and data).
