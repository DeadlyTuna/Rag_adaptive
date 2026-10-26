"""Novelty 2 — ranking weights per question type, shrunk towards the global weights.

One weight vector for every question is a compromise: a question about a *deadline*
should lean on recency, a question about a *rule* on reliability, a question about the
student on their own memories. So each feedback also updates the weights of the
question's group, and retrieval uses

    w = normalise(λ · w_global + (1 − λ) · w_group),   λ = k / (k + n_group),  k = 3

With no feedback on a group yet (n = 0) that is exactly the global weights; after three
pieces of feedback the group's own weights count for half; the more evidence, the more
the group's weights take over. This is the usual empirical-Bayes shrinkage that stops a
group with one noisy vote from swinging the ranking.
"""

from __future__ import annotations

import re
from typing import Optional

from ..learning import normalise, pairwise_update, reinforce_update
from ..schemas import FACTORS, Weights, World

K = 3.0
GROUPS = {
    "rule": "Rules and requirements",
    "time": "Times, dates and deadlines",
    "personal": "About the student",
    "general": "Everything else",
}
_TIME = re.compile(r"\b(when|deadline|date|dates|schedule|timings?|hours|open|opens|close|closes|today|tomorrow|week|start|starts|last day)\b", re.I)


def group_for(intent: str, text: str) -> str:
    if intent in ("name", "my-attendance", "am-i-eligible"):
        return "personal"
    if intent in ("library-hours", "curfew") or _TIME.search(text):
        return "time"
    if intent in ("attendance-minimum", "fat-eligibility", "pass-marks"):
        return "rule"
    return "general"


def effective(world: World, group: Optional[str]) -> tuple[Weights, float]:
    """The weights to rank with, and the share (1 − λ) that came from the group."""
    if not group:
        return world.weights, 0.0
    n = world.intent_counts.get(group, 0)
    gw = world.intent_weights.get(group)
    if not gw or n == 0:
        return world.weights, 0.0
    lam = K / (K + n)
    mixed = Weights(**{f: lam * world.weights.get(f) + (1 - lam) * gw.get(f) for f in FACTORS})
    return normalise(mixed), round(1 - lam, 3)


def learn(world: World, group: str, preferred=None, rejected=None, cited=None, others=None) -> bool:
    """Apply one piece of feedback to the group's own weights."""
    base = world.intent_weights.get(group) or world.weights.model_copy()
    if preferred is not None and rejected is not None:
        after = pairwise_update(base, preferred, rejected)
    elif cited:
        after = reinforce_update(base, cited[0], others or [])
    else:
        return False
    world.intent_weights[group] = after
    world.intent_counts[group] = world.intent_counts.get(group, 0) + 1
    return True
