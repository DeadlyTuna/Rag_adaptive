# Presentation: Adaptive RAG feature tour

A 33-slide tour of every page of the website, built from screenshots of the running app (live
backend, template answers).

| File | What it is |
|---|---|
| [`Adaptive-RAG-Feature-Tour.pptx`](Adaptive-RAG-Feature-Tour.pptx) | The deck, with speaker notes on every slide. Present from this. |
| [`Adaptive-RAG-Feature-Tour.pdf`](Adaptive-RAG-Feature-Tour.pdf) | The same slides as a PDF (no notes), easy to read on a phone. |
| [`screenshots/app/`](screenshots/app) | Viewport screenshots: `L*` landing page, `C*` console (demo steps 1–8, citations, inspector). |
| [`screenshots/full-page/`](screenshots/full-page) | Full pages: memory page with the 3-D terrain, retrieval lab, console, API docs. |
| [`tools/`](tools) | The scripts that produced the screenshots and the deck. |

## Slides

| # | Section | Content |
|---|---|---|
| 1–4 | Introduction | Title, the problem with ordinary RAG, the five-step idea, the five pages |
| 5–9 | Landing page | Hero and live correction demo, what it keeps, corrections, ranking, learning loop and architecture |
| 10–17 | Console | Annotated overview, demo steps 1–8, the classifier verdict, traceable citations, the inspector, feedback |
| 18–23 | Memory and terrain | The memory page, what the knowledge terrain shows and how it is built, forgetting curve, memory bank, timeline rewind |
| 24–26 | Retrieval lab | The four ranking signals, what feedback changed, classifier accuracy |
| 27–33 | Under the hood | Knowledge base, architecture, API, connecting an LLM, testing, limitations, close |

The knowledge page, demo step 9 (the clock jump) and the command palette are described but not
screenshotted.

## How it was made

- `tools/capture-screenshots.mjs` drives headless Chromium (Playwright, WebGL via SwiftShader)
  through the site against the FastAPI backend, running the guided demo script.
- `tools/build-deck.js` builds the deck with [pptxgenjs](https://gitbrent.github.io/PptxGenJS/)
  in the website's own colour palette.

Both scripts ran in a Claude Code cloud sandbox and still contain that environment's file paths
at the top. Point those constants at local folders before re-running them.
