# Research extensions

Twelve extensions on top of the core adaptive-RAG pipeline, and a benchmark that measures
them. Each one is a small module in [`backend/app/novelty/`](backend/app/novelty), switched
with the `NOVELTIES` setting:

```bash
NOVELTIES=all                 # default: every extension on
NOVELTIES=none                # the core pipeline only (still matches the TypeScript engine, tests/test_parity.py)
NOVELTIES=scope_time,verify   # a selection
NOVELTIES=all,-verify         # everything but one (what the benchmark's ablations use)
```

They run in the FastAPI backend. In the web app they show up in the console (answer
confidence, a "What if it hadn't learned?" comparison, a student switcher), on the memory
page (unverified / scoped / scheduled / shared badges, verification details, a staleness
colouring of the terrain, a consolidate button) and on the **Research** page (`/research`),
which also shows the benchmark — including on the Vercel deployment, where no backend is
connected.

| # | Extension | Module | Switch |
|---|---|---|---|
| 1 | Scope- and time-aware (bitemporal) facts | `context.py`, the view in `schemas.World` | `scope_time` |
| 2 | Ranking weights per question type, with shrinkage | `intent_weights.py` | `intent_weights` |
| 3 | Verified corrections and learned student trust (poisoning defence) | `verify.py` | `verify` |
| 4 | Counterfactual answers: "what if it hadn't learned?" | `counterfactual.py` | always available |
| 5 | Forgetting rates learned from reuse (survival analysis) | `decay.py` | `learned_decay` |
| 6 | Answer confidence; ask a clarifying question or abstain | `answerability.py` | `answerability` |
| 7 | Consolidation: merge duplicates, archive faded memories | `consolidate.py` | `consolidate` |
| 8 | Private memories per student, crowd-verified shared facts | `crowd.py`, the view | `multi_user` |
| 9 | Trust propagation to similar passages | `propagation.py` | `propagation` |
| 10 | A staleness map of the knowledge | `staleness.py`, `frontend/lib/engine/staleness.ts` | always available |
| 11 | Proactive reminders from temporary memories | `reminders.py` | `reminders` |
| 12 | A benchmark with ablations | [`backend/bench/`](backend/bench) | — |

`hooks.py` is the glue between these modules and the memory manager. With every switch
off, none of this code runs.

---

## 1 · Scope- and time-aware facts

**Problem.** In the core system, "our department raised the attendance requirement to 80%"
replaces the regulation's 75% *for everyone*, and "what was it last year?" can only be
answered with today's value.

**Idea.** A fact carries the **scope** it applies to (`appliesTo`: a department) and a
**validity interval** (`validFrom` / `validTo`: when it was true, which is not the same as
when the system learned it — *bitemporal*). Every lookup is answered *for a view*: who is
asking, about which department, as of which moment.

- `View` (in `schemas.py`) is set on the world for the length of a turn. `World.live(m)`,
  `current_memory(slot)`, `override_of(chunk, slot)` and `claim_applies(...)` answer for
  that view; with no view (novelties off) they behave exactly as before.
- Resolution: among the facts that are live for the view, a department's own rule beats
  the general one, then the most recently true one wins. A passage is "overridden" for a
  student only if the student's current belief differs from it — so a CSE exception never
  overrides the regulation for an ECE student.
- `context.py` reads scope and time out of messages: *"for ECE"*, *"last month"*,
  *"last year"*, *"on 1 September"*, *"before the change"*, and for statements *"last
  semester"*, *"from 1 December"*, *"starting next week"*, *"since August"*.
- A change announced for a later date is **scheduled**: the old fact stays current with
  `validTo` set, and `tick()` switches over when the date passes.
- Documents get validity too: a claim is true from its publication date; a circular's
  claim applies to the department it speaks for.

Try it: *"Our department changed it to 80% last semester."* then *"What was the minimum
attendance requirement last year?"* (75%) and *"… for ECE?"* (75%); *"From 1 December the
library closes at 11 pm."* then ask about the library before and after moving the clock.
`GET /api/research/resolve?slot=attendance.minimum&scope=ECE&as_of=<ms>` answers directly.

## 2 · Ranking weights per question type

**Problem.** One weight vector `w = (S, R, C, I)` is a compromise: deadline questions
should lean on recency, rule questions on reliability.

**Idea.** Questions fall into groups — *rule*, *time*, *personal*, *general* — and each
piece of feedback also trains its group's own weights (the same pairwise update as the
global weights). Retrieval blends them with empirical-Bayes shrinkage:

    w = normalise(λ · w_global + (1 − λ) · w_group),   λ = k / (k + n_group),  k = 3

With no feedback on a group, `λ = 1` (the global weights); after 3 pieces it is half and
half; the group's own weights take over as evidence accumulates. The inspector shows which
group ranked an answer and how much of the weights were its own.

## 3 · Verified corrections and student trust

**Problem.** One sentence can override a regulation. That is the point of adaptive RAG —
and an easy way to poison it ("the minimum attendance is 5%").

**Idea.** A correction that contradicts a document (or a fact a document or the crowd
stands behind) is scored before it is accepted:

    score = 0.50 · trust(student) + 0.15 · authority + 0.10 · scoped + 0.25 · (1 − reliability × size)

- *trust* — a Beta(α, β) posterior over the student's past corrections, starting at
  Beta(4, 1) (mean 0.8); confirmed corrections add to α, rejected ones to β.
- *authority* — names a department, circular, professor, warden …
- *scoped* — "for our department" is a local exception, not a contradiction.
- *size* — relative change for numbers (≥ 50% counts as 1), hours for times (≥ 6 h).

At or above 0.6 it applies at once. Below, the memory is kept as **pending**: stored and
shown ("Unverified · 0.40 < 0.60"), but answers keep using the source and say so. It is
settled when a document states the same value (verified) or a different one (rejected),
when `CROWD_K = 2` students say the same thing (see 8), or by a moderator
(`POST /api/memories/{id}/verify`). Facts about the student themselves are never
second-guessed.

## 4 · Counterfactual answers

`GET /api/turns/{id}/counterfactual` re-answers a turn's question on copies of the world:
**without memories**, **without feedback learning** (initial weights, every reliability
reset) and as **plain RAG** (neither). Side by side with today's answer, that shows which
kind of adaptation changed it, and which learned memories it relied on. The comparison
uses the deterministic template generator, so a difference is never LLM sampling noise.
In the console: *What if it hadn't learned?* under any answer.

## 5 · Forgetting rates learned from reuse

**Problem.** The core system forgets on hand-set time constants (persistent 60 days,
important 45, correction 90, temporary 1.2).

**Idea.** Treat "time until a memory is used again" as a survival problem. Every gap
between uses is an observed event; the time since the last use is right-censored (it has
not been used again *yet*). For exponential times the maximum-likelihood mean is
exposure / events; with little data that is noisy, so it is shrunk towards the hand-set
prior with `A = 2` pseudo-events (a Gamma prior on the rate):

    τ_class = (exposure + A · τ_prior) / (events + A)

The fit is redone after every turn and clock change; memory strength, consolidation and
the forgetting curves in the browser all use it.

## 6 · Confidence, clarifying questions, abstaining

Every answer to a question gets a confidence from its evidence:

    confidence = 0.55 · relevance + 0.30 · trust + 0.15 · decisiveness

(relevance: the best item's similarity, 0.2 → 0 and 0.7 → 1; trust: its confidence ×
reliability; decisiveness: its lead over the runner-up, 0 → 0 and 0.1 → 1), and a mode:

- **clarify** — the answer depends on something unknown: the rule differs by department
  and the student hasn't said which one they're in. It asks, and lists what each option
  would mean, with citations.
- **abstain** — an open question with nothing relevant behind it: it says so instead of
  stitching an answer together (and doesn't call the LLM).
- **answer** — otherwise.

## 7 · Consolidation

Overnight (when the clock jumps a day or more) or on demand
(`POST /api/memories/consolidate`): memories of the same student and kind whose embeddings
are ≥ 0.82 similar are **merged** — the better-supported one survives, takes the other's
uses (so it decays slower) and a small confidence boost — and memories whose strength has
fallen below 0.15 are **archived** (out of retrieval, still listed, restorable). Slot facts
(the current answer to a question), pinned memories and corrections are never touched.

## 8 · Private memories, crowd-verified facts

With `multi_user`, every request names a student (`user_id`; the app has a switcher with
four demo students: Harsh and Arjun in CSE, Priya in ECE, and a Guest with no department).

- Everything about a student — name, attendance, preferences, exams — is **private**.
- A world fact one student reports ("our department raised it to 80%") changes **only
  their** answers. When a second student independently states the same value for the same
  scope, it becomes **shared** with everyone it applies to ("Confirmed by 2 students").
  A document stating the same value shares it at once.
- A student's private correction never outdates a shared fact for anyone else.
- `GET /api/state?user=…` returns one student's view: their memories and conversation,
  the shared facts, and passages overridden only by corrections that apply to them.

## 9 · Trust propagation

Feedback lowers (or raises) one passage's reliability. Passages that are about the same
thing tend to be right or wrong together — rules go out of date an edition at a time — so
part of the change spreads to the passage's nearest neighbours in the same document
(similarity ≥ 0.3) or anywhere (≥ 0.6), up to three:

    Δr_neighbour = β · similarity · Δr_target,   β = 0.5 for "outdated", 0.3 otherwise

## 10 · Staleness map

Every passage and memory gets a staleness in [0, 1]: a passage from its age, its lost
reliability and whether a correction overrides it; a memory from how far its strength has
decayed (pending 0.5; replaced, expired or archived 1). The memory page's **Map colour →
Staleness** paints it over the terrain (warm and raised = stale); the Research page lists
the stalest items. Same formula in Python and TypeScript, so it works in the demo too.

## 11 · Reminders

A temporary memory knows when it matters, so the system can speak first: "I have a DBMS
exam tomorrow" schedules reminders for the evening before (18:00) and the morning of
(07:00), skipping any already past. When the clock passes one it falls due and appears as
a notification; deleting the memory cancels them.

## 12 · The benchmark

```bash
cd backend
python -m bench.run              # ~30 s → bench/RESULTS.md, bench/results.json, frontend/lib/research/benchmark.json
python -m bench.run --quick      # the three main systems only
python -m bench.run --embedder minilm
```

Scripted conversations ([`bench/scenarios.py`](backend/bench/scenarios.py)) with probes:
questions whose answer must contain the right value and must not contain the wrong one.
It compares **plain RAG** (documents only, nothing remembered or learned), the **core
adaptive** system and **+novelties**, and runs every extension-but-one as an ablation.
Hashed embeddings and template answers make every run identical.

| What is measured | plain | adaptive | +novelties |
|---|---|---|---|
| Correction uptake | 0/7 | 7/7 | 6/7 |
| Correction persistence | 0/2 | 2/2 | 2/2 |
| Poisoning resisted | 6/6 | 0/6 | 5/6 |
| Cross-student poisoning resisted | 3/3 | 0/3 | 3/3 |
| Scope accuracy | 2/3 | 1/3 | 3/3 |
| Time accuracy | 1/4 | 2/4 | 4/4 |
| Privacy kept | 2/3 | 1/3 | 3/3 |
| Expiry handled | 1/2 | 2/2 | 2/2 |
| Asks when it depends | 0/1 | 0/1 | 1/1 |
| Unanswerable → declined | 4/5 | 4/5 | 4/5 |
| Answerable → answered | 2/5 | 2/5 | 2/5 |

Plus experiments ([`bench/experiments.py`](backend/bench/experiments.py)):

- **Ranking (2):** trained on simulated feedback for 16 questions with known answers,
  tested on 16 others — MRR 0.908 with the initial weights, 0.919 with learned global
  weights, **0.953** with per-question-type weights (hit@1 0.875 → 0.875 → 0.938).
- **Forgetting (5):** 100 synthetic memories reused at known rates; τ fitted on 60 days
  recovers the true mean gaps (8 → 10.1 d, 20 → 24.9 d, 35 → 33.7 d, 1.5 → 1.5 d) and
  predicts the next 30 days far better than the hand-set τ (held-out log-likelihood
  −237.0 vs −276.8; the true rates score −235.5).
- **Consolidation (7):** 15 → 11 current memories after a night, 4 merged; copies of the
  same answer in the top 5 drop from 2 to 1.
- **Confidence (6):** mean confidence 0.83 on right answers, 0.58 on wrong ones (AUROC 0.66).
- **Propagation (9), counterfactual attribution (4), staleness (10), reminders (11):**
  see [`bench/RESULTS.md`](backend/bench/RESULTS.md).

**Limitations, measured rather than hidden.** The verifier holds one genuine change that
has no authority cue ("the university changed the pass mark to 40") and lets through an
attack phrased like a department change ("our department reduced the minimum attendance
to 50%") — with multi-user on, that attack only affects its author. Plain RAG is immune to
poisoning only because it learns nothing at all. The abstain/answerable misses are shared
by every system: the hashed embedder knows no synonyms and the template answerer routes by
keywords; with `--embedder minilm` and an LLM writing answers those change, which is why
the benchmark is about the comparisons between systems.

## Tests

`backend/tests/test_novelties.py` has a test per behaviour above (and runs the whole demo
with every extension on); `tests/test_bench.py` checks that the benchmark still separates
the systems; `tests/test_parity.py` checks the core is unchanged with them off.
