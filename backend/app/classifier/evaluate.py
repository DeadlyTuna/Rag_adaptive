"""Score a memory classifier on the held-out evaluation set (seed/evalset.json).

Every sentence is classified against a fresh copy of the seed world, so world-state
evidence (e.g. "the library closes at 9 pm" conflicts with a stored 10 pm) is the
same for every predictor — only the text model differs.
"""

from __future__ import annotations

import json
from typing import Optional

from ..schemas import CLASSES, World
from ..seed import SEED_DIR
from . import Prediction, TextPredictor, classify


def eval_set() -> list[dict]:
    return json.loads((SEED_DIR / "evalset.json").read_text(encoding="utf-8"))


def metrics(gold: list[str], pred: list[str]) -> dict:
    idx = {c: i for i, c in enumerate(CLASSES)}
    confusion = [[0] * len(CLASSES) for _ in CLASSES]  # rows = true, cols = predicted
    for g, p in zip(gold, pred):
        confusion[idx[g]][idx[p]] += 1
    per_class = {}
    f1s = []
    for c in CLASSES:
        i = idx[c]
        tp = confusion[i][i]
        fp = sum(confusion[r][i] for r in range(len(CLASSES))) - tp
        fn = sum(confusion[i]) - tp
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[c] = {"precision": round(precision, 3), "recall": round(recall, 3), "f1": round(f1, 3), "support": sum(confusion[i])}
        f1s.append(f1)
    correct = sum(1 for g, p in zip(gold, pred) if g == p)
    return {
        "accuracy": round(correct / len(gold), 4) if gold else 0.0,
        "macroF1": round(sum(f1s) / len(f1s), 4),
        "correct": correct,
        "total": len(gold),
        "classes": CLASSES,
        "confusion": confusion,
        "perClass": per_class,
    }


def evaluate(predictor: Optional[TextPredictor], world: World, predictions: Optional[list[Prediction]] = None) -> dict:
    """`predictions` lets an async caller (the LLM) pass pre-computed predictions."""
    from .llm import Precomputed

    items = eval_set()
    gold, pred, misses = [], [], []
    for k, it in enumerate(items):
        p = Precomputed("llm", predictions[k]) if predictions is not None else predictor
        out = classify(it["text"], world, None, p)  # classify() only reads the world
        gold.append(it["label"])
        pred.append(out.label)
        if out.label != it["label"]:
            misses.append({"text": it["text"], "expected": it["label"], "got": out.label})
    res = metrics(gold, pred)
    res["predictor"] = "llm" if predictions is not None else (predictor.name if predictor else "rules")
    res["misses"] = misses
    return res
