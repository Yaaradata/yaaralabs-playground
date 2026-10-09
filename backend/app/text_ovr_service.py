"""
Text recognition with independent per-label confidence (Machine Learning for Kids style).

Why this exists
---------------
Text-recognition projects in the Playground are trained by learners with only
5-8 examples per label. Fine-tuning DistilBERT on that little data barely moves
the model, and the original Logistic Regression trainer
(`EnhancedLogisticRegressionTrainer`) removes words such as "on" / "off" as stop
words, so "Fan on" and "Fan off" become the same text. Both end up near-random.

This trainer is a separate, additive option (modelType = "logistic_regression_ovr").
It does not change or replace either existing trainer.

How it works
------------
* Text is lower-cased and punctuation is removed. No stop-word removal and no
  lemmatising, so every word a learner typed ("on", "off", "pannu") counts.
* Features = word TF-IDF (single words + pairs) + character TF-IDF (2-4 letters).
  The character part copes with typos ("trun on", "fan of") and mixed-language
  phrases.
* One Logistic Regression per label ("this label" vs "every other label").

How confidence is calculated (same idea as Machine Learning for Kids)
----------------------------------------------------------------------
ML for Kids sends text projects to IBM Watson Assistant, which scores every
label (intent) independently, and shows the top label's score x 100.
Here, each label's own classifier gives an independent probability (0-1) that
the text belongs to that label; confidence = that probability x 100.

* Scores do NOT have to add up to 100%.
* Text that looks like nothing in the training data ("hello") gets a LOW score
  for every label, instead of being forced to ~25% / ~50%.
* Text that exactly matches a training example gets 100% for that label.
"""

import logging
import pickle
import random
import re
import threading
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion

logger = logging.getLogger(__name__)

MODEL_TYPE = "logistic_regression_ovr"
MODEL_FORMAT_VERSION = 1

# Regularisation strength. Higher = more confident on clear inputs.
# 20 gives ~80-98% on clear commands and ~10-15% on unrelated text with
# 5-10 examples per label (validated on the fan/lamp workshop dataset).
DEFAULT_C = 20.0


def normalize_text(text: str) -> str:
    """Lower-case, unify unicode, drop punctuation, collapse spaces. Keeps every word."""
    text = unicodedata.normalize("NFKC", str(text or "")).lower()
    text = re.sub(r"[^\w\s']", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _build_features() -> FeatureUnion:
    return FeatureUnion([
        ("words", TfidfVectorizer(
            ngram_range=(1, 2),
            token_pattern=r"(?u)\b\w+\b",   # keep 1-letter words too
            sublinear_tf=True,
            min_df=1,
        )),
        ("chars", TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(2, 4),
            sublinear_tf=True,
            min_df=1,
        )),
    ])


def _fit(texts: List[str], labels: List[str], c_value: float) -> Dict[str, Any]:
    """Fit features + one classifier per label. Returns a plain, picklable dict."""
    label_names = sorted(set(labels))
    features = _build_features()
    matrix = features.fit_transform(texts)
    y = np.array(labels)

    classifiers = {}
    for label in label_names:
        clf = LogisticRegression(C=c_value, class_weight="balanced", max_iter=5000)
        clf.fit(matrix, (y == label).astype(int))
        classifiers[label] = clf

    # Exact-match lookup: most common label for each normalised training text
    by_text: Dict[str, Counter] = {}
    for text, label in zip(texts, labels):
        by_text.setdefault(text, Counter())[label] += 1
    exact = {text: counts.most_common(1)[0][0] for text, counts in by_text.items()}

    return {
        "format_version": MODEL_FORMAT_VERSION,
        "model_type": MODEL_TYPE,
        "features": features,
        "classifiers": classifiers,
        "labels": label_names,
        "exact": exact,
        "c_value": c_value,
    }


def _scores(model: Dict[str, Any], text: str) -> Dict[str, float]:
    """Independent 0-1 score for every label."""
    normalized = normalize_text(text)
    matrix = model["features"].transform([normalized])
    scores = {
        label: float(clf.predict_proba(matrix)[0, 1])
        for label, clf in model["classifiers"].items()
    }
    exact_label = model["exact"].get(normalized)
    if exact_label is not None:
        scores[exact_label] = 1.0
    return scores


def _predict(model: Dict[str, Any], text: str) -> Dict[str, Any]:
    scores = _scores(model, text)
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    top_label, top_score = ranked[0]
    return {
        "label": top_label,
        "confidence": round(top_score * 100, 2),
        "alternatives": [
            {"label": label, "confidence": round(score * 100, 2)}
            for label, score in ranked[1:3]
        ],
        "all_scores": [
            {"label": label, "confidence": round(score * 100, 2)} for label, score in ranked
        ],
    }


class OvrTextClassifierTrainer:
    """Train / save / predict for text-recognition projects (modelType logistic_regression_ovr)."""

    def __init__(self, c_value: float = DEFAULT_C):
        self.c_value = c_value
        self._cache: Dict[str, Any] = {}          # gcs_path -> (generation, model)
        self._cache_lock = threading.Lock()

    # ------------------------------------------------------------------ train
    def train_model(self, examples: List[Any]) -> Dict[str, Any]:
        """examples: objects/dicts with .text/.label (TextExample) or {'text','label'}."""
        texts, labels = [], []
        for ex in examples:
            text = ex.get("text") if isinstance(ex, dict) else getattr(ex, "text", None)
            label = ex.get("label") if isinstance(ex, dict) else getattr(ex, "label", None)
            text = normalize_text(text)
            label = (label or "").strip()
            if text and label:
                texts.append(text)
                labels.append(label)

        if len(texts) < 2:
            raise ValueError("Need at least 2 examples to train a model.")
        if len(set(labels)) < 2:
            raise ValueError("Need at least 2 different labels to train a model.")

        started = time.time()
        model = _fit(texts, labels, self.c_value)
        model["trained_at"] = datetime.now(timezone.utc).isoformat()
        model["training_examples"] = len(texts)

        train_correct = sum(_predict(model, t)["label"] == l for t, l in zip(texts, labels))
        accuracy = train_correct / len(texts)

        logger.info(
            "OvR text model trained: %d examples, %d labels, accuracy %.3f, %.0f ms",
            len(texts), len(model["labels"]), accuracy, (time.time() - started) * 1000,
        )
        return {
            "model": model,
            "accuracy": accuracy,
            "labels": model["labels"],
            "training_examples": len(texts),
            "loss": None,
        }

    # ------------------------------------------------------------------ save
    def save_model_to_gcs(self, bucket, gcs_path: str, model: Dict[str, Any]) -> str:
        if not model:
            raise ValueError("Trained model is required - cannot save untrained models")
        payload = pickle.dumps(model)
        blob = bucket.blob(gcs_path)
        max_retries = 5
        for attempt in range(max_retries):
            try:
                blob.upload_from_string(payload, content_type="application/octet-stream", timeout=120)
                with self._cache_lock:
                    self._cache.pop(gcs_path, None)
                return gcs_path
            except Exception as upload_err:  # noqa: BLE001
                if attempt == max_retries - 1:
                    raise
                wait = (2 ** attempt) + random.random()
                logger.warning("Upload attempt %d failed: %s; retrying in %.1fs", attempt + 1, upload_err, wait)
                time.sleep(wait)
        return gcs_path

    # --------------------------------------------------------------- predict
    def _load(self, bucket, gcs_path: str) -> Dict[str, Any]:
        blob = bucket.get_blob(gcs_path)
        if blob is None:
            raise FileNotFoundError(f"Model not found at {gcs_path}")
        generation = blob.generation
        with self._cache_lock:
            cached = self._cache.get(gcs_path)
            if cached and cached[0] == generation:
                return cached[1]
        model = pickle.loads(blob.download_as_bytes())
        if not isinstance(model, dict) or model.get("model_type") != MODEL_TYPE:
            raise ValueError("Stored model is not a logistic_regression_ovr model")
        with self._cache_lock:
            self._cache[gcs_path] = (generation, model)
        return model

    def predict(self, model: Dict[str, Any], text: str) -> Dict[str, Any]:
        return _predict(model, text)

    def predict_from_gcs(self, text: str, bucket, gcs_path: str) -> Dict[str, Any]:
        return _predict(self._load(bucket, gcs_path), text)


ovr_text_trainer = OvrTextClassifierTrainer()
