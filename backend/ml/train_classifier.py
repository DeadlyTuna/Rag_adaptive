"""Train the memory classifier and report how it does on the held-out set.

    python -m ml.train_classifier            (from the backend/ folder)

Trains TF-IDF + logistic regression on seed/classifier_train.jsonl, prints 5-fold
cross-validation on the training data, then the score on seed/evalset.json (sentences
it never saw — the same set the frontend's confusion matrix uses), and saves the model
to models/memory_classifier.joblib, where the API picks it up on its next start.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import joblib
from sklearn.model_selection import StratifiedKFold, cross_val_score

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.classifier.evaluate import evaluate  # noqa: E402
from app.classifier.ml import MLPredictor, build_pipeline  # noqa: E402
from app.seed import create_world  # noqa: E402

TRAIN = ROOT / "seed" / "classifier_train.jsonl"
OUT = ROOT / "models" / "memory_classifier.joblib"


def load_train() -> tuple[list[str], list[str]]:
    rows = [json.loads(line) for line in TRAIN.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [r["text"] for r in rows], [r["label"] for r in rows]


def print_report(title: str, res: dict) -> None:
    print(f"\n{title}: accuracy {res['accuracy']:.1%} ({res['correct']}/{res['total']}) · macro-F1 {res['macroF1']:.3f}")
    print("  " + " ".join(f"{c[:5]:>6}" for c in res["classes"]) + "   ← predicted")
    for c, row in zip(res["classes"], res["confusion"]):
        print("  " + " ".join(f"{v:>6}" for v in row) + f"   {c}")
    for m in res["misses"]:
        print(f"  ✗ {m['text']!r}: expected {m['expected']}, got {m['got']}")


def main() -> None:
    texts, labels = load_train()
    print(f"Training on {len(texts)} labelled sentences: " + ", ".join(f"{c} {labels.count(c)}" for c in sorted(set(labels))))

    cv = cross_val_score(build_pipeline(), texts, labels, cv=StratifiedKFold(5, shuffle=True, random_state=0), scoring="f1_macro")
    print(f"5-fold cross-validation macro-F1 on the training set: {cv.mean():.3f} ± {cv.std():.3f}")

    t = time.time()
    model = build_pipeline().fit(texts, labels)
    print(f"Fitted in {time.time() - t:.2f}s")

    world = create_world(int(time.time() * 1000))
    print_report("Rules baseline on the held-out set", evaluate(None, world))
    print_report("Trained model (text) + world-state evidence on the held-out set", evaluate(MLPredictor(model), world))

    import sklearn

    OUT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "sklearn": sklearn.__version__, "trained_on": len(texts)}, OUT)
    print(f"\nSaved {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
