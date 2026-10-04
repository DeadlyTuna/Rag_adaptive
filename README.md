# Adaptive RAG

An assistant that gets better at answering as it talks to people: it remembers what
matters, replaces facts that went out of date, and re-ranks its retrieval from feedback —
without retraining the language model.

This repository currently holds the **web interface** (`frontend/`, Next.js). It runs
end-to-end on its own with an in-browser demo engine, and switches to the FastAPI backend
when one is available. The full design — concept, tokens, motion system, page specs, data
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

## Connecting the backend

By default everything runs in the browser (`lib/engine/`): hashed 384-dimensional
embeddings, an MDS projection for the map, a feature-based memory classifier, conflict
resolution, four-signal re-ranking, pairwise weight updates from feedback, and forgetting
curves. To use the real FastAPI service instead:

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The client (`frontend/lib/api/live.ts`) expects the endpoints in DESIGN_PLAN.md §8 —
most importantly `POST /api/chat` streaming Server-Sent Events in the order
`user → classification → memory_ops → retrieval → token… → done`, and `GET /api/state`
returning the world (documents, chunks, memories, events, weights). The interface
animates the same stages in both modes.

## Project structure

```
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
