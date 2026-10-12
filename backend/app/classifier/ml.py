"""Trained memory classifier (scikit-learn).

A TF-IDF (word 1–2-grams + character 2–5-grams) → logistic-regression pipeline,
trained on seed/classifier_train.jsonl by `python -m ml.train_classifier` and saved
with joblib. Character n-grams make it robust to typos and word forms ("changed",
"changing"); word bigrams catch phrases like "my name", "right now".
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from ..schemas import CLASSES
from . import Prediction

log = logging.getLogger("adaptive-rag")


def build_pipeline():
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import FeatureUnion, Pipeline

    features = FeatureUnion(
        [
            ("words", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, lowercase=True, token_pattern=r"(?u)\b\w+\b|[?%+]")),
            ("chars", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, lowercase=True, min_df=2)),
        ]
    )
    return Pipeline([("features", features), ("clf", LogisticRegression(C=8.0, max_iter=2000, class_weight="balanced"))])


class MLPredictor:
    name = "ml"

    def __init__(self, model) -> None:
        self.model = model
        self.classes = list(model.classes_)

    @staticmethod
    def load(path: Path) -> Optional["MLPredictor"]:
        """Load the model saved by ml/train_classifier.py. Only load files you trained
        yourself — joblib files can run code when loaded."""
        if not path.exists():
            log.info("No trained classifier at %s — using the rules. Train one with: python -m ml.train_classifier", path.name)
            return None
        try:
            import warnings

            import joblib
            import sklearn

            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                saved = joblib.load(path)
            model = saved["model"] if isinstance(saved, dict) else saved
            trained_with = saved.get("sklearn") if isinstance(saved, dict) else None
            if trained_with and trained_with != sklearn.__version__:
                log.warning(
                    "Classifier was trained with scikit-learn %s but %s is installed — retrain with: python -m ml.train_classifier",
                    trained_with,
                    sklearn.__version__,
                )
            return MLPredictor(model)
        except Exception as e:  # noqa: BLE001
            log.warning("Could not load the trained classifier (%s) — using the rules. Retrain with: python -m ml.train_classifier", e)
            return None

    def predict(self, text: str) -> Prediction:
        p = self.model.predict_proba([text])[0]
        probs = {c: 0.0 for c in CLASSES}
        for c, v in zip(self.classes, p):
            probs[c] = float(v)
        return Prediction(probs=probs)
