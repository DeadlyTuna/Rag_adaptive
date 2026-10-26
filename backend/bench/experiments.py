"""Quantitative experiments for the novelties that aren't pass/fail probes."""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

from app.forgetting import BASE_TAU, DAY
from app.novelty import decay
from app.novelty.counterfactual import counterfactuals
from app.novelty.staleness import staleness_map
from app.schemas import Memory, Source

from .systems import System

HERE = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------- 2: ranking


def _rank_of(sys_: System, q: str, gold: str) -> int:
    for c in sys_.engine.rank(q, None, True)["candidates"]:
        if c["id"] == gold:
            return c["rank"]
    return 10**6


def _mrr(sys_: System, items: list[dict]) -> tuple[float, float]:
    ranks = [_rank_of(sys_, it["q"], it["gold"]) for it in items]
    return round(sum(1 / r for r in ranks) / len(ranks), 3), round(sum(r == 1 for r in ranks) / len(ranks), 3)


def ranking(embedder: str = "hash", epochs: int = 2) -> dict:
    """Train the ranking weights from simulated feedback on half the questions (a student
    who marks an answer helpful when its top source is right, and "wrong source" on the top
    source otherwise), then measure MRR and hit@1 on the other half."""
    qs = json.loads((HERE / "qa.json").read_text(encoding="utf-8"))["questions"]
    train, test = qs[0::2], qs[1::2]
    out = {}
    for name, nov in {"initial weights": "none", "global weights learned": "none", "per-question-type weights learned": "intent_weights"}.items():
        sys_ = System(name, nov, embedder)
        try:
            if name != "initial weights":
                for _ in range(epochs):
                    for it in train:
                        turn = sys_.chat(it["q"])
                        cands = turn["retrieval"]["candidates"]
                        if not cands:
                            continue
                        if cands[0]["id"] == it["gold"]:
                            sys_.feedback(turn, "helpful")
                        elif any(c["id"] == it["gold"] for c in cands):
                            sys_.feedback(turn, "not_helpful", "wrong_source", cands[0]["id"])
            mrr, hit1 = _mrr(sys_, test)
            out[name] = {"mrr": mrr, "hit@1": hit1, "weights": sys_.engine.world.weights.dump(), "groups": {g: w.dump() for g, w in sys_.engine.world.intent_weights.items()}}
        finally:
            sys_.close()
    out["_about"] = f"{len(train)} training / {len(test)} test questions, {epochs} passes of simulated feedback"
    return out


# ---------------------------------------------------------------------------- 5: forgetting


def _synthetic_memories(rng: random.Random, now: int, gaps: dict[str, float], n: int, horizon: int) -> list[Memory]:
    mems = []
    for cls, gap in gaps.items():
        for i in range(n):
            created = now - rng.uniform(0.3, 1.0) * horizon
            uses, t = [], created
            while True:
                t += rng.expovariate(1 / gap)
                if t > now:
                    break
                uses.append(int(t))
            mems.append(
                Memory(
                    id=f"{cls}-{i}", label="x", text="x", cls=cls, kind="fact", source=Source(type="user", label="You"),
                    confidence=1, importance=1, reliability=1, status="current", created_at=int(created), last_used_at=max([int(created), *uses]), uses=uses,
                )
            )
    return mems


def _heldout_loglik(mems: list[Memory], split: int, end: int, taus: dict[str, float]) -> float:
    """Log-likelihood of each memory's next use after `split` (or of no use by `end`)
    under exponential reuse with the given τ per class."""
    ll = 0.0
    for m in mems:
        before = [t for t in [m.created_at, *m.uses] if t <= split]
        if not before:
            continue
        nxt = next((u for u in m.uses if u > split), None)
        tau = taus[m.cls]
        if nxt is not None and nxt <= end:
            ll += -math.log(tau / DAY) - (nxt - split) / tau
        else:
            ll += -(end - split) / tau
    return ll


def forgetting(seed: int = 7) -> dict:
    """Synthetic check of the estimator: memories are reused at known rates; τ is learned
    from the first 60 days and judged on how well it predicts reuse in the next 30."""
    rng = random.Random(seed)
    true_gaps = {"persistent": 8 * DAY, "important": 20 * DAY, "correction": 35 * DAY, "temporary": 1.5 * DAY}
    end = 1_791_000_000_000
    split = end - 30 * DAY
    mems = _synthetic_memories(rng, end, true_gaps, 25, 90 * DAY)

    class W:
        memories = [
            m.model_copy(update={"uses": [u for u in m.uses if u <= split], "last_used_at": max([m.created_at, *[u for u in m.uses if u <= split]])})
            for m in mems
            if m.created_at <= split
        ]

    fit = decay.fit(W, split)  # type: ignore[arg-type]
    learned = {c: f.tau for c, f in fit.items()}
    return {
        "trueMeanGapDays": {c: round(g / DAY, 1) for c, g in true_gaps.items()},
        "handSetTauDays": {c: round(t / DAY, 1) for c, t in BASE_TAU.items()},
        "learnedTauDays": {c: round(t / DAY, 1) for c, t in learned.items()},
        "heldoutLogLik": {
            "hand-set τ": round(_heldout_loglik(mems, split, end, dict(BASE_TAU)), 1),
            "learned τ": round(_heldout_loglik(mems, split, end, learned), 1),
            "true rate (upper bound)": round(_heldout_loglik(mems, split, end, true_gaps), 1),
        },
        "_about": "100 synthetic memories (25 per class) reused at known rates; τ fitted on 60 days, scored on the next 30 (higher log-likelihood is better)",
    }


# ---------------------------------------------------------------------------- 7: consolidation

DUPLICATES = [
    ("The professor said the OS assignment is due on Moodle by Monday.", "Prof. Iyer said the OS assignment must be submitted on Moodle by Monday."),
    ("Prof. Iyer said the COA quiz will be held in room 204.", "The professor said the COA quiz is in room 204."),
    ("The professor said the networks project demo is in week 14.", "Prof. Rao said the networks project demo will be in week 14."),
    ("Prof. Rao said CAT-2 marks will be published on the student portal.", None),  # repeats a memory from an earlier session
]


def consolidation() -> dict:
    """A student repeats things in other words; how many copies end up competing?"""
    out = {}
    for name, nov in {"adaptive": "none", "+novelties": "all"}.items():
        sys_ = System(name, nov)
        try:
            for a, _ in DUPLICATES:
                sys_.chat(a)
            for _, b in DUPLICATES:
                if b:
                    sys_.chat(b)
            before = sum(1 for m in sys_.engine.world.memories if m.status == "current")
            sys_.advance(DAY)  # the nightly pass (only runs with consolidation on)
            after = sum(1 for m in sys_.engine.world.memories if m.status == "current")
            merged = sum(1 for m in sys_.engine.world.memories if m.merged_into)
            turn = sys_.chat("Where is the COA quiz?")
            dup = sum(1 for c in turn["retrieval"]["candidates"][:5] if "COA quiz" in c["title"])
            out[name] = {"currentMemoriesBefore": before, "currentMemoriesAfter": after, "merged": merged, "copiesOfTheAnswerInTop5": dup}
        finally:
            sys_.close()
    out["_about"] = "3 facts each said twice in different words, plus one repeat of a fact from an earlier session; then a night passes"
    return out


# ---------------------------------------------------------------------------- 9: propagation


def propagation() -> dict:
    sys_ = System("+novelties", "all")
    try:
        turn = sys_.chat("What is the minimum attendance requirement?")
        before = {c.id: c.reliability for c in sys_.engine.world.chunks}
        sys_.feedback(turn, "not_helpful", "outdated", "regs-3.1")
        after = {c.id: c.reliability for c in sys_.engine.world.chunks}
        changed = {i: [before[i], after[i]] for i in after if after[i] != before[i]}
        return {"feedback": "“outdated” on Regulations §3.1 (minimum attendance)", "reliabilityChanged": changed}
    finally:
        sys_.close()


# ---------------------------------------------------------------------------- 4: counterfactual


def counterfactual_attribution(script: list[str]) -> dict:
    """Over the demo conversation: how often does each kind of learning change an answer?"""
    sys_ = System("+novelties", "all")
    try:
        questions = 0
        differs = {"no_memory": 0, "no_feedback": 0, "plain": 0}
        for text in script:
            turn = sys_.chat(text)
            if not turn.get("answerability"):
                continue  # statements
            questions += 1
            cf = counterfactuals(sys_.engine.world, text, sys_.engine.now(), sys_.engine.retriever, sys_.engine.view_for(None), lambda w, t: sys_.engine.weights_for(w, t)[0])
            for k in differs:
                differs[k] += 0 if cf["variants"][k]["sameAsAdaptive"] else 1
        return {"questions": questions, "answersThatChangeWithout": differs}
    finally:
        sys_.close()


# ---------------------------------------------------------------------------- 10: staleness


def staleness_check(script: list[str]) -> dict:
    sys_ = System("+novelties", "all")
    try:
        for text in script:
            sys_.chat(text)
        w = sys_.engine.world
        stale = {s["id"]: s["staleness"] for s in staleness_map(w, sys_.engine.now(), sys_.engine.taus())}
        overridden = [c.id for c in w.chunks if c.overridden_by]
        flagged = [c.id for c in w.chunks if c.reliability < 1 and c.id not in overridden]
        rest = [c.id for c in w.chunks if c.id not in overridden and c.id not in flagged]

        def mean(ids):
            return round(sum(stale[i] for i in ids) / len(ids), 3) if ids else None

        return {"overriddenPassages": mean(overridden), "lowReliabilityPassages": mean(flagged), "otherPassages": mean(rest), "counts": [len(overridden), len(flagged), len(rest)]}
    finally:
        sys_.close()


# ---------------------------------------------------------------------------- 11: reminders


def reminders() -> dict:
    # (statement, hours after 04:00 it is said, reminders that should fire)
    cases = [("I have a DBMS exam tomorrow.", 0, 2), ("I have a COA quiz tomorrow.", 15, 1), ("I have an OS viva today.", 0, 1), ("I have an OS viva today.", 6, 0)]
    out = []
    for text, hours_later, expected in cases:
        sys_ = System("+novelties", "all")
        try:
            sys_.clock.t += hours_later * 3_600_000
            sys_.chat(text)
            scheduled = len(sys_.engine.world.reminders)
            sys_.advance(3 * DAY)
            fired = sum(1 for r in sys_.engine.world.reminders if r.status == "due")
            out.append({"statement": text, "saidAtHour": 4 + hours_later, "expected": expected, "scheduled": scheduled, "fired": fired})
        finally:
            sys_.close()
    return {"cases": out, "_about": "evening-before (18:00) and morning-of (07:00) reminders; ones already in the past are skipped"}
