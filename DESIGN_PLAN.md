# Adaptive RAG — Frontend Design Plan

> The web interface for an assistant that remembers what matters, replaces facts that
> went out of date, and ranks its retrieval better after every piece of feedback.
> Built with Next.js (App Router). This document is the source of truth for the design;
> the code in `frontend/` follows it.

---

## 0. Brief, pinned down

| | |
|---|---|
| **Subject** | A college assistant answering questions about university regulations — attendance, CAT/FAT, grading, fees, hostel — from official documents *and* from what students tell it. |
| **Audience** | (1) Evaluators watching a live demo on a laptop or projector. (2) Students who would actually use it. |
| **The interface's one job** | Make the invisible learning visible. Every message shows what was remembered, what was replaced, what was retrieved, and why it ranked where it did. |
| **The story it must tell in under a minute** | Ask the attendance rule → it says 75% → tell it your department changed it to 80% → it detects the conflict, retires 75%, stores 80% → every later answer (FAT eligibility, "am I eligible?") uses 80%. |

---

## 1. Creative direction — "The knowledge terrain"

### 1.1 The idea

In ML papers, an embedding space is drawn as a 2-D projection with **density contours**.
We turn that plot into the centrepiece of the product.

* Every document chunk and every memory is a kernel on a contour map.
* A kernel's **height is its current strength**: `importance × confidence × recency`.
* So the map literally changes shape as the system learns:
  * a new memory **rises** as a peak;
  * a temporary memory **erodes** as its time runs out;
  * a correction makes the old fact **subside** into a dashed outline while the new fact rises beside it;
  * a question sends a **ping** across the surface, and the strongest nearby peaks are picked.
* Documents are **bedrock** (blue). Learned memories are **pink**. Where both mix, the contour lines go neutral.

The terrain appears on every screen: a full-bleed 3-D relief behind the landing page, a top-down
map in the console, a large map with a time scrubber on the Memory page, and a small map on the
Knowledge page where new chunks land.

### 1.2 What it should feel like

A precise scientific instrument wrapped around one living, fluid surface.
The terrain is the only loud thing on screen. Everything around it is quiet: matte panels,
hairline rules, small mono labels, exact numbers.

### 1.3 What we deliberately avoid

| Template default | Why it's out | What we do instead |
|---|---|---|
| Purple/blue "AI" gradients, gradient text | Reads as any AI product | Flat ink on a deep teal ground; colour only where it encodes meaning |
| Glass cards, particle "plexus" backgrounds | Decoration with no data behind it | The terrain is decoration *made of data* — every bump is a real memory |
| Near-black + one neon accent | The most common dark-UI default | Deep **teal** ground with three semantic signals (memory, attention, documents) |
| Serif display + mono startup pairing | The 2025 AI-startup uniform | A **variable-width grotesk** whose width carries meaning, with one variable family for text and data |
| Hero = big number + small label + gradient | Template hero | Hero headline that **performs a correction on itself**, over the live terrain |

### 1.4 The one aesthetic risk

A deep teal ground, a display face that stretches and condenses with meaning (what is current is
set wide; context is set narrow), and a hero that literally strikes out `75%` and writes `80%`
over it while the terrain behind it reshapes. Justified because it *is* the product's thesis.

---

## 2. Design tokens

### 2.1 Colour — the "Sounding" palette

Named after depth soundings on a chart: the ground is deep water, the signals are what the sonar finds.

**Surfaces & ink**

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `abyss` | `#0A2327` | Page background | — |
| `trench` | `#0F2E33` | Panels, cards | 1.14 vs abyss |
| `reef` | `#143A40` | Raised / hover surface | — |
| `shelf` | `#1F4B51` | Hairlines, borders, low contours | 1.7 vs abyss (non-text) |
| `foam` | `#E6F2EE` | Primary text | 14.3 : 1 on abyss, 12.5 : 1 on trench |
| `kelp` | `#86A9A4` | Secondary text, labels | 6.4 : 1 on abyss, 5.6 : 1 on trench |

**Signals** (UI accents — used on marks, glyphs, rings and focus, never as body-text colour)

| Token | Hex | Meaning | Contrast on trench |
|---|---|---|---|
| `rhodamine` | `#FF6B93` | Learned memory (named after the fluorescent dye used to trace neurons) | 5.3 : 1 |
| `sodium` | `#FFC14D` | Attention — the live query, and anything that just changed | 8.9 : 1 |
| `glacier` | `#8FCBFF` | Documents — the official, bedrock knowledge | 8.3 : 1 |

**Data-viz slots** — the four retrieval signals, validated with the data-viz palette validator
(dark mode, surface `#0F2E33`, formula order): *all checks pass* — worst adjacent CVD ΔE 11.2
(target ≥ 8), worst normal-vision ΔE 16.5 (floor ≥ 15), every slot ≥ 3 : 1 on the panel.

| Slot | Signal | Hex | Why this hue |
|---|---|---|---|
| 1 | **S** — semantic similarity | `#C18500` | Amber: closeness to the *query* (attention family) |
| 2 | **R** — recency | `#2FA284` | Aqua: freshness |
| 3 | **C** — confidence | `#3A80C8` | Blue: trust (documents family) |
| 4 | **I** — importance | `#D95479` | Pink: what memory cares about (memory family) |

**Terrain scale** is diverging — `glacier` (document-dominated) → `foam` (mixed) → `rhodamine`
(memory-dominated) — with a neutral midpoint, plus a scale legend on every terrain view.

**Rules**
1. Text wears ink tokens (`foam`, `kelp`). A coloured glyph, dot or line *beside* the text carries identity.
2. Colour is never the only channel: every class/status also has a glyph and a word.
3. `sodium` is the only colour that moves on its own (pings, "just changed" flashes).
4. Errors use `flare #FF8A7A` with an icon and a sentence that says how to fix it.

### 2.2 Typography

| Role | Face | Settings | Used for |
|---|---|---|---|
| **Display** | **Anybody** (variable: `wdth` 50–150, `wght` 100–900) | wght 650–760, tracking −0.03em | Hero headline, landing section headlines, page titles. Nothing else. |
| **Text** | **Recursive** Sans (variable, `MONO 0`, `CASL 0`) | wght 400 / 560 / 640 | Body, chat, UI, *and all numbers* incl. stat-tile values (proportional figures) |
| **Data** | **Recursive** Mono (same family, `MONO 1`) | wght 400–500, labels uppercase +0.12em | Eyebrows, data tags, scores, IDs, code, axis ticks (tabular figures) |

**Width carries meaning.** In headlines, the word that is *current* or *kept* is set wide
(`wdth 125–140`); context words sit at `wdth 85–100`. On reveal, display lines "inhale"
from `wdth 60` to their final width.

**Mono → Sans morph (signature detail).** Raw user input appears in Recursive Mono; once the
classifier has understood it, the text morphs (`MONO 1 → 0`, 900 ms) into the sans. Machine
text becoming knowledge.

**Scale** (fluid with `clamp()`)

| Token | Size / line-height | Face |
|---|---|---|
| `display-xl` | clamp(3.5rem, 8.4vw, 8.25rem) / 0.9 | Anybody 740 |
| `display-l` | clamp(2.5rem, 5vw, 4.5rem) / 0.95 | Anybody 700 |
| `display-m` | clamp(1.75rem, 2.6vw, 2.5rem) / 1.0 | Anybody 680 — page titles |
| `body-l` | 1.125rem / 1.6 | Recursive 400 — landing copy |
| `body` | 0.9375rem / 1.6 | Recursive 400 — chat |
| `ui` | 0.875rem / 1.45 | Recursive 400–560 |
| `small` | 0.8125rem / 1.45 | Recursive 400 |
| `label` | 0.6875rem / 1.2, uppercase, +0.12em | Recursive Mono 500 |
| `data` | 0.75rem / 1.3, tabular | Recursive Mono 400 |
| `stat` | 2rem / 1, proportional | Recursive Sans 600 |

### 2.3 Space, shape, depth, texture

* **Spacing** — 4 px base: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 72 · 96 · 128.
* **Radii** — 6 (chips) · 10 (controls) · 16 (panels) · 999 (pills).
* **Borders** — 1 px `shelf` hairlines. **No drop shadows.** Depth comes from the surface step
  (`abyss → trench → reef`) and, for the active element only, a signal ring:
  `0 0 0 1px <signal>, 0 0 24px <signal>/18%`.
* **Texture** — a 4 % film-grain overlay (SVG turbulence), fixed, non-interactive, so flat
  surfaces don't look digital-flat. Disabled in `forced-colors`.
* **Focus** — 2 px `sodium` outline, 2 px offset, on every interactive element.

### 2.4 Iconography

A small custom glyph set (16 px grid, 1.5 px stroke, round caps) — classes and events are the
vocabulary of the product, so they get their own marks. Generic UI icons (send, close, search)
come from Lucide.

| Glyph | Meaning | Colour |
|---|---|---|
| ◉ seal | Persistent memory | rhodamine |
| ◆ diamond | Important knowledge | rhodamine |
| ↻ arc | Correction / fact replaced | sodium |
| ◌ dashed ring | Temporary memory | rhodamine, dashed |
| ⊘ slashed ring | Irrelevant — not stored | kelp |
| ▭ page | Document chunk | glacier |
| ◖ tick | Conversation turn | foam |
| ⚖ balance | Ranking weights updated | foam |
| × | Memory expired | kelp |

---

## 3. Motion system

### 3.1 Principles

1. **Motion explains cause.** Every animation corresponds to a real state change in the system — stored, replaced, retrieved, decayed. No motion for its own sake.
2. **One orchestrated moment per interaction.** A send triggers one choreographed sequence, not ten unrelated effects.
3. **Springs for what you touch, curves for what happens.** Direct manipulation (sliders, drags, toggles, reorders) uses springs; system events use eased timelines.
4. **Exits are faster than entrances** (≈ 60 %).
5. **Only the terrain is ambient.** Its contours drift slowly; everything else is still until something happens.

### 3.2 Tokens

| Token | Value | Use |
|---|---|---|
| `ease.out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Entrances, reveals |
| `ease.inOut` | `cubic-bezier(0.65, 0, 0.35, 1)` | Morphs, camera moves, terrain reshaping |
| `ease.in` | `cubic-bezier(0.55, 0, 1, 0.45)` | Exits |
| `spring.snap` | stiffness 520, damping 38 | Toggles, chips, badges |
| `spring.fluid` | stiffness 220, damping 26 | Panels, list reorders, the nav indicator |
| `spring.lazy` | stiffness 90, damping 20 | Labels that follow the terrain |
| `t.instant` | 90 ms | Hover colour |
| `t.quick` | 160 ms | Small state changes |
| `t.base` | 260 ms | Panels, popovers |
| `t.slow` | 420 ms | Page content |
| `t.scene` | 900 ms | Morphs, classifier bars |
| `t.epic` | 1600 ms | Terrain subsidence, camera "lift" |
| `stagger.list` | 45 ms | Rows, cards |
| `stagger.bars` | 80 ms | Classifier / score bars |
| `stagger.words` | 70 ms | Headline words |

### 3.3 Signature sequences

**A · You tell it something → it decides whether to remember** (console)

| t (ms) | What moves |
|---|---|
| 0 | Your message drops in (height springs open), set in Recursive **Mono** — raw input. |
| 120 | An amber scan line sweeps left → right across it (520 ms). |
| 400 | Extracted pieces underline themselves (`attendance`, `80%`, `department`) with tags popping above. |
| 700 | The classifier strip unfolds; five probability bars grow (stagger 80 ms); values count up. |
| 1300 | The winning class locks in (1.04 → 1 bump); the decision line types out: *"Stored as a correction — replaces 'Minimum attendance = 75%'."* |
| 1500 | A memory chip detaches from the strip and flies into the inspector's *Memory writes* list. On the map, a new peak rises with a pink ripple. Your message morphs **Mono → Sans** (understood). |
| +correction | The old fact's row shakes (360 ms), a strike-through draws across it, it dims to 45 %. On the map, its peak **subsides** over 1.6 s into a dashed outline, tethered to the new peak. |

**B · You ask → it retrieves → it answers**

| t (ms) | What moves |
|---|---|
| 0 | Assistant placeholder: "Searching 28 passages and 14 memories…" |
| 0 | On the map, two amber rings ping out from where your question lands. |
| 350 | Leader lines draw from the ping to the top-5 peaks; rank badges pop. |
| 500 | Inspector rows enter (stagger 45 ms); each stacked score bar fills segment by segment S → R → C → I. |
| 900 | Answer streams token by token; citation chips `[1]` pop in as their token arrives. |
| end | Feedback bar fades in. Hovering a citation lights its row and its peak. |

**C · You give feedback → retrieval learns**

* "Wrong source" → pick the source → its row dims; `reliability 0.92 → 0.78` counts down; if it loses rank it slides down (layout spring).
* The four weight meters spring to new values; delta chips (`+0.04 S`, `−0.03 R`) float up and fade.
* The source's peak dims on the map. Toast: *"Feedback saved — ranking weights updated."*

**D · Time passes → it forgets** (demo clock "+1 day")

* The clock digits roll. A temporary memory's decay meter drains, then its card dissolves (blur + scale 0.96 + fade, 600 ms).
* `× Temporary memory expired` slides into the activity feed. The small hill erodes from the map.

**E · "Lift" — flat map to relief** (Memory page)

* Camera moves from top-down to a 55° tilt over 1.6 s while the height scale goes 0 → 1, so the contour map rises into a landscape. Labels re-project every frame.

**F · Landing load**

* 0 ms terrain fades up from flat as contours draw outward → 200 ms eyebrow → 350 ms headline words rise with a blur, each "inhaling" from `wdth 60` → 900 ms body + buttons → 1400 ms the live correction demo begins.

**G · Page change (app)** — content fades up 10 px with a 6 px blur clearing (420 ms); panels stagger 60 ms; the rail stays put and its active indicator springs to the new item.

### 3.4 Reduced motion

With `prefers-reduced-motion: reduce`: no ambient terrain drift (the map renders only on state
change), camera moves jump, no scan line, no flying chips, no headline inhale, numbers set
instantly, Lenis smooth-scroll disabled. Every state change still happens — as a 150 ms opacity fade.

---

## 4. Information architecture

| Route | Name | Job |
|---|---|---|
| `/` | **Landing** | Tell the story: the problem, what it remembers, corrections, ranking, the feedback loop, the architecture. |
| `/console` | **Console** | Talk to the assistant and watch each step: classification, memory writes, retrieval, scores, feedback. |
| `/memory` | **Memory** | Everything it has learned, what it replaced, what it let go — with a time scrubber to rewind. |
| `/retrieval` | **Retrieval lab** | Tune and inspect the ranking formula; see how feedback changed the weights; test the classifier. |
| `/knowledge` | **Knowledge base** | The official documents, their chunks, and live ingestion of new ones. |

**Navigation.** App pages share a 76 px left rail (logo mark, four destinations, reset at the
bottom); the active item carries a contour-ring indicator that springs between items. On phones
the rail becomes a bottom tab bar. A top status strip on every app page shows the page title,
the **demo clock** with time-warp buttons, and the engine badge (*Demo engine* / *Live API*).

**Command palette** (`Ctrl/⌘ K`): go to any page, run the next demo-script step, advance time,
toggle 2-D/3-D, reset the demo.

**Keyboard:** `Ctrl/⌘ K` palette · `/` focus composer · `Enter` send · `Shift+Enter` newline ·
`G then C/M/R/K` go to page · `Esc` close drawer/popover.

**Global memory toasts** (bottom-right, max 3): whenever memory changes off-console — e.g. a
document confirms a fact — a toast names the change; clicking opens that memory.

---

## 5. Page specs

### 5.1 Landing `/`

A scroll story over a **fixed 3-D terrain stage**. Each section sets a terrain *scene*; the
stage's camera and data glide between scenes as you scroll (Lenis smooth scroll).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◎ Adaptive RAG              How it learns · Console · Memory  [Open console]│
│                                                                          │
│ ADAPTIVE RETRIEVAL-AUGMENTED GENERATION                                  │
│                                                   ┌────────────────────┐ │
│ Correct it once.                                  │ MINIMUM ATTENDANCE │ │
│ It remembers.                                     │   7̶5̶%̶   80%        │ │
│                                                   │ ↻ your department  │ │
│ Adaptive RAG answers from your documents and      │   confidence 0.82  │ │
│ from what it learns in conversation…              ├────────────────────┤ │
│                                                   │ live mini-chat     │ │
│ [Open the console]   See how it learns ↓          │ auto-plays the fix │ │
│                                                   └────────────────────┘ │
│ ≋≋≋≋≋≋≋≋≋≋≋ 3-D terrain, low camera, peaks labelled, cursor = probe ≋≋≋≋≋≋ │
└──────────────────────────────────────────────────────────────────────────┘
```

| # | Section | Headline / copy | Visual | Terrain scene |
|---|---|---|---|---|
| 0 | **Hero** | "Correct it once. It remembers." — *Adaptive RAG answers from your documents and from what it learns in conversation. Correct a fact and it retires the old one, keeps the new one, and ranks it higher next time — no retraining.* | The fact plate: `75%` struck, `80%` written over it, with the old value ghosted beneath (palimpsest). A mini-chat auto-plays the brief's three-message story in a loop. | Low 3-D camera, slow orbit. Cursor is a query probe: nearby peaks light up and show labels. The 75% peak subsides / 80% rises in sync with the demo. |
| 1 | **The problem** | "Ordinary RAG answers from a frozen page." — the stale-answer story. | Classic pipeline strip (PDF → chunks → embeddings → vector DB → search → LLM → answer) with packets flowing; below it the 3-message transcript where the correction is ignored and the stale `75%` is flagged. | Memories fade out; only blue document bedrock remains. |
| 2 | **What it keeps** | "It decides what's worth remembering." | The brief's six statements drop one by one onto a classifier rail and slide into lanes: *Persistent · Important · Correction · Temporary · Irrelevant*, each with its probability bars and outcome (*Kept*, *Kept for 24 h*, *Not stored*…). | Pink peaks rise for kept items; temporary ones rise small and dashed; irrelevant ones ripple and vanish. |
| 3 | **Corrections** | "Corrections replace. They don't pile up." | Conflict diagram (old 75% ⟷ conflict ⟷ new 80% → verification → outdated / current), then the stored record types itself out: Knowledge · Source · Confidence 0.82 · Status · Previous value · Timestamp. | Camera dives to the attendance cluster; the subsidence plays. |
| 4 | **Ranking** | "Ranked by more than similarity." | `score = w₁·S + w₂·R + w₃·C + w₄·I` with four live sliders. The brief's candidates (Document A 0.91, Document B 0.87, Memory C 0.82, Document D 0.79) re-rank as you drag. | Top-down; a query pings; ranked peaks get badges. |
| 5 | **The loop** | "The model stays the same. The memory around it learns." | Circular loop (Question → Retrieve → Answer → Feedback → Evaluate → Update) with a travelling pulse; two lists: *Learns* (memories, source reliability, ranking weights) vs *Stays fixed* (the language model, your original documents). | A peak flagged by feedback dims. |
| 6 | **Architecture** | "How the pieces fit." | The brief's final architecture as an interactive SVG: signal pulses travel the edges; hovering a block shows what it does and the tech behind it (FastAPI, sentence-transformers, FAISS/Chroma, SQLite, scikit-learn, Next.js). | Camera pulls back to the whole map. |
| 7 | **CTA** | "Tell it something it doesn't know." | Primary button **Open the console**; note: *The console runs a guided demo — ask about attendance, correct it, and watch the map change.* | Map settles into the hero orbit. |

### 5.2 Console `/console`

```
┌────┬───────────────────────────────────────────┬─────────────────────────────┐
│ ◎  │ Console          Sun 5 Oct 01:40 [+1h][+1d] │ MEMORY MAP          [expand]│
│    │───────────────────────────────────────────│ ┌─────────────────────────┐ │
│ ◈  │ YOU  What is the minimum attendance?       │ │  top-down terrain,      │ │
│ ◎  │      ⊘ question · not stored               │ │  ping + ranked peaks    │ │
│ ⚖  │                                             │ └─────────────────────────┘ │
│ ▭  │ RAG  The minimum attendance is 75% [1].    │ RETRIEVED FOR THIS ANSWER   │
│    │      ▲ Helpful   ▼ Not helpful             │ ■S ■R ■C ■I legend          │
│    │                                             │ 1 ▭ Regs §3.1  ▇▇▇▅▃  0.73  │
│    │ YOU  Our department changed it to 80%.     │ 2 ▭ Regs §3.3  ▇▇▅▃   0.61  │
│    │   ┌ CLASSIFIED ───────────────────────┐    │ 3 ◉ CSE, sem 3 ▇▅▃    0.44  │
│    │   │ Correction ███████████████  0.91  │    │ FILTERED OUT                 │
│    │   │ Important  ██               0.05  │    │ ↻ 75% — replaced on 5 Oct    │
│    │   │ → conflicts with "attendance 75%" │    │ RANKING WEIGHTS              │
│    │   │ → stored · confidence 0.82 [view] │    │ S .45 R .15 C .25 I .15      │
│    │   └───────────────────────────────────┘    │ MEMORY WRITES (THIS TURN)    │
│    │ ┌───────────────────────────────────────┐ │ ↻ Minimum attendance = 80%   │
│    │ │ Ask a question, or tell it something… │ │   replaces 75%               │
│    │ └───────────────────────────────────────┘ │                              │
│ ↺  │ DEMO SCRIPT ● What is the min… ○ Our dep…  │                              │
└────┴───────────────────────────────────────────┴─────────────────────────────┘
```

* **Turns** are rows, not bubbles: a left gutter with the speaker label (`YOU` / `RAG`) and the time, content to the right. Reads like a lab log.
* **Classifier strip** under every user turn. Questions collapse to one line (*"⊘ question · not stored"*); statements expand to full probability bars (emphasis form: winner in its class colour, the rest in `shelf`). Shows *Conflict check* and the *decision*.
* **Assistant turns** stream; citations `[n]` are chips linked to inspector rows (hover syncs chat ↔ inspector ↔ map).
* **Feedback bar**: *Helpful* / *Not helpful* → reasons: *Wrong source*, *Outdated*, *Incomplete* → for *Wrong source*, pick which retrieved source.
* **Inspector** follows the selected assistant turn (latest by default; click any turn to time-travel its retrieval snapshot).
* **Composer**: auto-growing textarea, `Enter` to send. Above it the **demo script** — the brief's interaction story as chips; the next step glows; finished steps get a check.
* **Demo script**: ① What is the minimum attendance requirement? ② Our department changed it to 80% last semester. ③ When can I write my FAT? ④ I prefer concise answers. ⑤ I have a DBMS exam tomorrow. ⑥ What's 2+2? ⑦ My attendance is 78%. ⑧ Am I eligible for FAT? ⑨ (+1 day → the exam memory expires).
* **States**: empty (script + one-line invitation), thinking (pipeline step label), streaming, error (*"Can't reach the backend at …. Start the FastAPI server, or switch to the demo engine."* + button).

### 5.3 Memory `/memory`

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│ ◎  │ Memory                                     As of ◀━━━━━━━━━━━●━━▶ now ▶ │
│    │ Everything it has learned, what it replaced, and what it let go.        │
│    │ Type [All|Persistent|Important|Correction|Temporary]  Status [Current…] │
│    │ ┌Knowledge base┐┌Long-term mem.┐┌Corrections┐┌Conflicts res.┐┌Queries─┐ │
│    │ │ 28 chunks    ││ 14  +2 today ││ 3         ││ 3            ││ 47     │ │
│    │ │ ▁▁▂▂▂▃       ││ ▂▃▃▄▅▆       ││ ▁▁▂▂▃     ││ ▁▁▂▂▃        ││ ▃▄▅▆▇  │ │
│    │ └──────────────┘└──────────────┘└───────────┘└──────────────┘└────────┘ │
│    │ ┌──────────────── TERRAIN (3-D relief / 2-D map) ────────────┐┌ACTIVITY┐│
│    │ │                                                  [2D|3D]   ││+ Pref…  ││
│    │ │                                                            ││↻ Fact…  ││
│    │ │           scale: documents ◀━━ mixed ━━▶ memory            ││× Temp…  ││
│    │ └────────────────────────────────────────────────────────────┘└─────────┘│
│    │ MEMORY BANK (cards)                         │ FACTS THAT CHANGED          │
│    │ ↻ CORRECTION  current 0.82                  │ Minimum attendance          │
│    │ Minimum attendance = 80%                    │ 75% ──▶ 80%                 │
│    │ replaces 75% · Regs §3.1   ━━━━━━━━── 0.86  │ Answer style                │
│    │ You · 5 Oct · used 3×                       │ step-by-step ──▶ concise    │
└────┴──────────────────────────────────────────────────────────────────────────┘
```

* **"As of" scrubber** is the page's time filter (top row, scopes everything below): drag to rewind; the terrain, KPI row, memory bank and activity feed all re-render as of that moment. Event ticks on the track (`+`, `↻`, `×`) show when things happened. Play button replays history.
* **KPI row** — five stat tiles (label · value in Recursive Sans 600 · delta vs yesterday · 12-day sparkline in `kelp`, today's point in `sodium`).
* **Terrain** — large, 3-D relief by default, `2D | 3D` toggle plays the *Lift* sequence. Hover a peak → label; click → opens the memory drawer.
* **Memory bank** — cards with class glyph, status, confidence, the knowledge line, provenance (*replaces 75% · Regulations §3.1*), a strength meter that decays live, and usage. Outdated cards are struck through at 50 %; temporary cards have a dashed edge and a countdown.
* **Facts that changed** — every slot with ≥ 2 versions as a version chain; the current value carries the previous one ghosted beneath it (palimpsest).
* **Memory drawer** (click any card/peak): the brief's record (Knowledge · Source · Confidence · Status · Previous value · Timestamp) plus importance, reliability, last used, times used; a **forgetting curve** (strength over time with rehearsal bumps at each retrieval, forget threshold, projected future); retrieval history; actions **Pin memory**, **Mark outdated**, **Delete memory** (with confirm).

### 5.4 Retrieval lab `/retrieval`

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│ ◎  │ Retrieval lab                                                            │
│    │ score = 0.45·S + 0.15·R + 0.25·C + 0.15·I        [Learned | Manual]      │
│    │ ┌ WEIGHTS ─────────────┐ ┌ RANKING · "When can I write my FAT?" ──────┐ │
│    │ │ S ━━━━━━━━━●━━ 0.45  │ │ 1 ↻ Min attendance = 80%  ▇▇▇▇▅▃▂  0.81 ▲2│ │
│    │ │ R ━━━●━━━━━━━━ 0.15  │ │ 2 ▭ Regs §4.3 FAT elig.   ▇▇▇▇▅▃   0.77 ▼1│ │
│    │ │ C ━━━━━●━━━━━━ 0.25  │ │ 3 ▭ Regs §3.3 Debarment   ▇▇▇▅▃    0.66   │ │
│    │ │ I ━━━●━━━━━━━━ 0.15  │ │ … rows re-order with layout springs        │ │
│    │ │ [Apply] [Reset]      │ └────────────────────────────────────────────┘ │
│    │ └──────────────────────┘                                                │
│    │ ┌ HOW FEEDBACK MOVED THE WEIGHTS (line chart, 4 series) ───────────────┐ │
│    │ └──────────────────────────────────────────────────────────────────────┘ │
│    │ ┌ SOURCE RELIABILITY (bars) ─────┐ ┌ CLASSIFIER PLAYGROUND ─────────────┐ │
│    │ │ learned from feedback          │ │ type a sentence → class probs,     │ │
│    │ └────────────────────────────────┘ │ extracted facts, decision;         │ │
│    │                                     │ confusion matrix on a labelled set │ │
│    │                                     └────────────────────────────────────┘ │
└────┴──────────────────────────────────────────────────────────────────────────┘
```

* Sliders always sum to 1 (moving one rescales the others proportionally). *Manual* previews without changing the assistant; **Apply weights** commits; **Reset to learned** reverts.
* Ranking rows show `▲2 / ▼1` deltas for 1.5 s after each change.
* **Learning curve**: one axis (weight 0–0.6), x = feedback event #; legend + direct end labels; crosshair tooltip lists all four; annotations at notable events.
* **Classifier playground**: the brief's examples as chips; a **confusion matrix** (5×5, one-hue sequential ramp) from evaluating the classifier on a built-in labelled set, with accuracy and macro-F1 — the "compare approaches" evidence for evaluators. Table view toggle on every chart.

### 5.5 Knowledge base `/knowledge`

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│ ◎  │ Knowledge base                                                           │
│    │ ┌ Drop .txt or .md files here — or add the sample department circular ─┐ │
│    │ └──────────────────────────────────────────────────────────────────────┘ │
│    │ DOCUMENTS                   │ CHUNKS · Academic Regulations 2024 │ MAP   │
│    │ ▭ Academic Regulations 14   │ §3.1 Attendance   86 tok ▮▯▮▮▯▮▯  │ ┌───┐ │
│    │ ▭ Examination Guide…    6   │  ↻ overridden by memory: 80%       │ │   │ │
│    │ ▭ Hostel Handbook       5   │ §3.2 Condonation  64 tok ▮▮▯▯▮▯▮  │ └───┘ │
│    │ ▭ CSE Department notes  3   │ …                                  │       │
└────┴──────────────────────────────────────────────────────────────────────────┘
```

* **Ingestion sequence**: the document card *fractures* into chunk tiles (stagger) → each tile's embedding fingerprint fills left → right → tiles fly into the list as the count ticks up → new peaks rise on the map → toast *"Indexed CSE Circular 2025/14 · 3 chunks."*
* **Fingerprint**: the first 32 dimensions of each chunk's vector as a strip on the diverging scale (glacier ↔ foam ↔ rhodamine).
* The sample circular states the 80% rule — ingesting it **confirms** the user's correction (confidence 0.82 → 0.95, event *"Fact confirmed by a document"*), or, if ingested first, creates a document-vs-document conflict resolved by recency and specificity.

### 5.6 Responsive behaviour

| Width | Console | Memory | Lab | Landing |
|---|---|---|---|---|
| ≥ 1280 | chat + inspector side by side | 2-column below terrain | 2-column | full stage |
| 768–1279 | inspector becomes a slide-over (button in status strip) | single column | single column | stage, smaller type |
| < 768 | bottom tab bar; inspector as bottom sheet; script chips scroll horizontally | terrain 2-D only, 260 px | stacked | terrain behind hero only; sections static |

---

## 6. The terrain renderer (technical spec)

* **Engine**: three.js (WebGL2), mounted client-side only, one `ShaderMaterial` on a 220×220-segment plane.
* **Field**: `h(p) = Σ wᵢ · exp(−|p − cᵢ|² / 2σᵢ²)` evaluated **in the vertex shader** from a float `DataTexture` of items (`x, y, weight, memoryShare` + `σ, highlight, dim, ghost`). Two partial sums give the document/memory mix for colour.
* **Fragment shader**: anti-aliased isolines via `fwidth` (every 5th line brighter), diverging line colour by memory share, a 10 % colour wash on peaks, a radial edge fade (no hard plane edges), faint coordinate grid in 2-D mode, amber **ping rings** (two staggered rings from `uPing`), **probe glow** (landing cursor), and up to 16 **markers** (highlight ring, dashed ghost ring, selected ring, new-memory ripple, dimmed).
* **Ambient**: contour phase drifts slowly (`uTime`), so the map always looks alive. Off under reduced motion.
* **Animation**: each item's displayed weight and position springs toward its target every frame (critically damped), so any state change — new memory, supersede, expire, time scrub — reshapes the terrain fluidly with no extra code paths.
* **Cameras**: `flat` (top-down, height 0), `relief` (55° tilt, slow sway), `hero` (low, wide, slow orbit). Transitions interpolate position, target, FOV and height scale over 1.6 s.
* **Labels**: the same field is evaluated on the CPU for labelled items only; positions are projected to screen each frame and written to DOM transforms through refs (no React re-renders).
* **Picking**: nearest projected item within 28 px of the pointer.
* **Budget**: < 2 ms GPU per frame on integrated graphics; render loop pauses when offscreen (IntersectionObserver) or the tab is hidden; DPR capped at 2.
* **Fallback**: no WebGL2 → a static SVG contour snapshot with the same legend.

---

## 7. Data & state

### 7.1 Domain model (TypeScript, mirrors the backend)

```ts
type MemoryClass = 'persistent' | 'important' | 'correction' | 'temporary' | 'irrelevant';
type MemoryStatus = 'current' | 'outdated' | 'expired';

interface Memory {
  id: string; slot: string | null;          // e.g. "attendance.minimum" — used for conflict detection
  text: string; value?: string;             // "Minimum attendance = 80%", "80%"
  cls: MemoryClass; kind: 'fact' | 'preference' | 'profile' | 'event';
  source: { type: 'user' | 'document'; label: string; ref?: string };
  confidence: number; importance: number; reliability: number;   // 0..1
  status: MemoryStatus; pinned: boolean;
  createdAt: number; lastUsedAt: number; uses: number[];          // epoch ms (demo clock)
  expiresAt?: number; supersedes?: string; supersededBy?: string; supersededAt?: number;
  previousValue?: string;
}
interface Chunk { id; docId; section; title; text; tokens; reliability; publishedAt; overriddenBy?: { slot; memoryId } }
interface Candidate { id; kind: 'document' | 'memory'; title; text; factors: { S; R; C; I }; score; rank; excluded?: string }
interface Classification { label: MemoryClass; probs: Record<MemoryClass, number>; spans: Span[]; slot?: string; value?: string; conflict?: { withId; withText; resolution }; decision: 'store' | 'replace' | 'discard' | 'keep-temporarily' | 'flag-previous' }
interface Weights { S: number; R: number; C: number; I: number }   // sum to 1
```

### 7.2 Demo engine (runs in the browser when no backend is configured)

| Piece | Method |
|---|---|
| **Embedding** | Hashed bag of normalised tokens + bigrams into 384 dims (same width as `all-MiniLM-L6-v2`), with a small synonym map (attendance ≈ presence; FAT ≈ final assessment; eligible ≈ allowed…); L2-normalised. |
| **Projection** | Classical MDS on cosine distance for the seed corpus (power iteration, 2 components); new items placed by their 3 nearest neighbours (out-of-sample), then a light repulsion pass. |
| **Classifier** | Feature-weighted scorer (cue phrases for correction / preference / profile / time-bound / chit-chat / arithmetic, plus value & slot detection) → softmax probabilities. A correction **needs something to correct**: with no conflict and no reference to a previous answer, it is relabelled *important*. |
| **Conflict resolution** | Same slot, different value → new fact `current`, old fact `outdated` (kept as history with `supersededBy`); document claims are *overridden for that slot* rather than deleted. User-correction confidence = 0.62 + 0.12 (specific value) + 0.08 (authority cue) = **0.82**. |
| **Scoring** | `S` cosine similarity · `R = exp(−age / τ)` (τ 30 d memories, 365 d documents) · `C = confidence × reliability` · `I` importance by class. `score = Σ w·factor`; outdated items are excluded and listed with the reason. Top 5 used. |
| **Learning from feedback** | Pairwise ranking update: for a rejected item *n* and the best non-rejected item *p*, `w ← normalise(max(0.02, w + η(f_p − f_n)))`, η = 0.15; `reliability(n) × 0.85`. *Helpful* nudges reliability up 0.03 for cited items. Every update is recorded for the learning curve. |
| **Forgetting** | `strength = importance × confidence × exp(−(now − lastUsed)/τ)`, τ grows ×1.2 with each use (spacing effect); temporary memories expire after 24 h; pinned memories don't decay. |
| **Answers** | Intent templates (attendance, FAT eligibility, eligibility check against your stated attendance, pass marks, name, arithmetic, generic summary of the top passages) that cite their sources and respect remembered preferences (*concise* vs *step-by-step*). |
| **Seed** | 4 documents / 28 chunks (Academic Regulations 2024, Examination Guidelines, Hostel Handbook, CSE Department notes), 12 memories from "earlier sessions" (incl. one past correction and one expired temporary memory), 6 weeks of activity, 47 past queries, 9 past feedback events. Persisted to `localStorage`; **Reset demo** restores the seed. |

### 7.3 Pipeline events (shared by the demo engine and the real backend)

`stage` → `classification` → `memory_ops` → `retrieval` → `token`* → `done` (or `error`).
The store consumes these in order, so the UI choreography is identical in demo and live modes.

---

## 8. Backend contract (FastAPI)

Set `NEXT_PUBLIC_API_URL` to switch from the in-browser demo engine to the real backend.

| Method & path | Body → Response |
|---|---|
| `POST /api/chat` | `{ message, session_id }` → **SSE stream** of the events in §7.3 |
| `POST /api/feedback` | `{ turn_id, verdict: 'helpful'│'not_helpful', reason?, target_id? }` → `{ weights, deltas, memory_ops }` |
| `GET /api/state` | → `{ memories, chunks, documents, events, weights, weight_history, stats }` |
| `GET /api/memories/{id}` | → `Memory` + versions + retrieval history |
| `PATCH /api/memories/{id}` | `{ pinned? , status? }` → `Memory` |
| `DELETE /api/memories/{id}` | → `204` |
| `POST /api/retrieve` | `{ query, weights? }` → `Candidate[]` (Retrieval lab) |
| `PUT /api/weights` | `Weights` → `Weights` |
| `POST /api/classify` | `{ text }` → `Classification` (playground) |
| `POST /api/documents` | multipart file → `{ document, chunks }` |
| `POST /api/clock` | `{ advance_ms }` → `{ now, memory_ops }` (demo only) |

---

## 9. Stack & structure

| Concern | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, Turbopack), React 19, TypeScript |
| Styling | **Tailwind CSS 4** (CSS-first `@theme` tokens) + a few hand-written CSS modules for the signature pieces |
| Motion | **Motion** (`motion/react`) — springs, layout animations, `AnimatePresence`; **Lenis** for landing scroll |
| 3-D | **three.js** (raw, no React wrapper — fewer moving parts with React 19) |
| State | **Zustand** with `persist` |
| Palette | **cmdk** |
| Icons | Lucide (generic UI) + custom glyph set |
| Fonts | `next/font/google`: Anybody (wdth axis), Recursive (MONO, CASL axes) |

```
frontend/
  app/
    layout.tsx            fonts, grain, providers
    globals.css           tokens (@theme), base, utilities
    page.tsx              landing (scroll story)
    (app)/layout.tsx      rail + status strip + palette + toasts
    (app)/template.tsx    page-enter transition
    (app)/console/page.tsx
    (app)/memory/page.tsx
    (app)/retrieval/page.tsx
    (app)/knowledge/page.tsx
  components/
    terrain/              TerrainCanvas, shaders, camera presets, labels
    shell/                Rail, StatusStrip, CommandPalette, Toaster, DemoClock
    console/              Turn, ClassifierStrip, Composer, Inspector, ScoreBar, Feedback, DemoScript
    memory/               StatTile, Scrubber, MemoryCard, MemoryDrawer, ActivityFeed, VersionChain, ForgettingCurve
    retrieval/            WeightConsole, RankingList, LearningCurve, ReliabilityBars, ClassifierPlayground, ConfusionMatrix
    knowledge/            DropZone, DocumentList, ChunkList, Fingerprint, IngestSequence
    landing/              Hero, FactPlate, AutoDemo, Pipeline, Sorter, Correction, RankingToy, Loop, Architecture
    ui/                   Panel, Button, Chip, Glyph, Meter, Slider, Segmented, NumberTicker, MorphText, DisplayText, Tooltip, Drawer
  lib/
    engine/               embed, project, classify, retrieve, compose, learn, seed, engine
    api/                  client interface, demo client, http client (SSE)
    store.ts  motion.ts  format.ts  time.ts
```

---

## 10. Quality bar

* **Accessibility** — WCAG AA contrast (tokens above), visible focus everywhere, full keyboard
  operation, `aria-live` announcements for memory changes, every chart has a table view,
  colour never the only channel, reduced motion respected, `forced-colors` safe.
* **Performance** — landing LCP text renders before WebGL (terrain is lazy-loaded); terrain
  < 2 ms/frame and paused offscreen; no layout shift from fonts (`next/font`, `display: swap`
  with size-adjust); app pages are client components hydrated once.
* **Verification** — `next build` + type-check clean; manual walkthrough of the demo script in
  the browser at 1440, 1024 and 390 px wide; reduced-motion pass.

## 11. Build order

1. Tokens, fonts, global CSS, glyphs, base UI primitives.
2. Demo engine + store (seed, classify, retrieve, compose, learn, forget) — the data everything animates.
3. Terrain renderer (shader, cameras, labels, picking).
4. App shell (rail, status strip + demo clock, palette, toasts, page transition).
5. Console (turns, classifier strip, inspector, feedback, demo script).
6. Memory (scrubber, KPI row, terrain, bank, drawer, version chains, activity).
7. Retrieval lab (weights, ranking, learning curve, reliability, classifier playground).
8. Knowledge base (documents, chunks, ingestion sequence).
9. Landing scroll story.
10. Responsive, reduced-motion and accessibility pass; screenshots; build.

## 12. Implementation notes (as built)

* All of §11 is built. `next build`, `tsc` and ESLint (including the React Compiler rules) pass.
* Verified in headless Chrome at 1440×900 and 390×844: every route, the full nine-step demo
  script end to end (no console errors), feedback, time warp, document ingestion, the memory
  drawer, the 2-D/3-D toggle and the weight playground.
* The classifier scores **39/40 (97.5%), macro-F1 0.97** on the built-in labelled set
  (`lib/engine/evalset.ts`) — a small, hand-written set; the point is the harness, so an
  LLM classifier on the backend can be scored on the same sentences.
* Small deviations from the plan: the stage's landing labels are shown only in the
  *corrections* and *loop* scenes (elsewhere they competed with the copy); headline colour is
  reserved for the hero's “remembers.” — section headlines carry meaning through width alone;
  map positions are MDS blended with a rank-equalised layout so the terrain uses its whole area.
* World-changing actions (feedback, pin, delete, ingest, clock) wait while a message is being
  processed, so the staged pipeline can't overwrite them.
