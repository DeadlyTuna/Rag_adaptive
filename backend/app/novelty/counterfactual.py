"""Novelty 4 — counterfactual answers: "what would it have said if it hadn't learned?"

For any answer, the same question is re-answered on copies of the world with parts of
what the system learned taken away:

  no_memory    no memories (and no overrides) — learned weights and reliability kept
  no_feedback  memories kept — but the initial ranking weights and every reliability reset to 1
  plain        neither: an ordinary RAG system over the same documents

Side by side with today's answer, that shows *which* kind of adaptation changed the
answer, and the citations show the items responsible. Answers are written by the
deterministic template composer, so the comparison is never an artefact of LLM sampling.
"""

from __future__ import annotations

from typing import Callable, Optional

from ..classifier import classify
from ..generator.template import ARITH, compose
from ..memory_manager import expand_query
from ..schemas import View, Weights, World

VARIANTS = {
    "adaptive": "Today's system (memories, learned weights and reliability)",
    "no_memory": "Without memories",
    "no_feedback": "Without feedback learning",
    "plain": "Plain RAG (documents only, nothing learned)",
}


def variant_world(world: World, variant: str) -> World:
    cf = world.model_copy(deep=True)
    if variant in ("no_memory", "plain"):
        cf.memories = []
        for c in cf.chunks:
            c.overridden_by = None
    if variant in ("no_feedback", "plain"):
        first = world.weight_history[0].weights if world.weight_history else world.weights
        cf.weights = Weights(**first.as_dict())
        cf.intent_weights = {}
        cf.intent_counts = {}
        for c in cf.chunks:
            c.reliability = 1.0
        for m in cf.memories:
            m.reliability = 1.0
    return cf


def answer_on(world: World, text: str, now: int, retriever, view: Optional[View], weights_for: Callable[[World, str], Weights]) -> dict:
    world.set_view(view)
    try:
        cls = classify(text, world)
        query = expand_query(text, cls)
        weights = weights_for(world, text)
        r = retriever.retrieve(world, query, weights, now)
        if cls.is_question and ARITH.search(text):
            r.candidates, r.excluded, r.pool = [], [], 0
        composed = compose(world, text, cls, r, [], now, sim=retriever.text_sim, candidate_for=lambda i: retriever.candidate_for(world, i, query, now))
        cands = r.candidates + composed.lookups

        def title(i: str) -> str:
            c = next((x for x in cands if x.id == i), None)
            return c.title if c else i

        return {
            "text": composed.text,
            "intent": composed.intent,
            "citations": [{"n": c.n, "itemId": c.item_id, "title": title(c.item_id), "kind": "memory" if world.memory(c.item_id) else "document"} for c in composed.citations],
            "top": [{"id": c.id, "title": c.title, "kind": c.kind, "score": c.score} for c in r.candidates[:5]],
            "weights": weights.dump(),
        }
    finally:
        world.set_view(None)


def counterfactuals(world: World, text: str, now: int, retriever, view: Optional[View], weights_for: Callable[[World, str], Weights]) -> dict:
    out = {}
    for variant, label in VARIANTS.items():
        w = world if variant == "adaptive" else variant_world(world, variant)
        res = answer_on(w, text, now, retriever, view, weights_for)
        res["label"] = label
        out[variant] = res
    base = out["adaptive"]["text"]
    for variant in VARIANTS:
        out[variant]["sameAsAdaptive"] = out[variant]["text"] == base
    # what learning contributed: memories the adaptive answer cites, and reliability it has lost
    used = [c for c in out["adaptive"]["citations"] if c["kind"] == "memory"]
    lowered = [{"id": c.id, "reliability": c.reliability} for c in world.chunks if c.reliability < 1 and any(t["id"] == c.id for t in out["plain"]["top"] + out["adaptive"]["top"])]
    return {"question": text, "variants": out, "memoriesUsed": used, "lowerReliability": lowered}
