"""
Text recognition that understands meaning (modelType = "sentence_embed_lr").

Why
---
The OvR TF-IDF model (text_ovr_service.py) only knows the words it was trained on: on the 20 sample
custody queries it gets 7 of 20 right when each query is hidden in turn, and its right answers sit
around 65% confidence, close to "Hello" (24%) and the weather (41%). Machine Learning for Kids sends
text to Watson Assistant, which understands meaning: clear messages score high, unrelated ones low,
and 50% is a sensible "I'm not sure" line. This model does the same with a small sentence-embedding
model, so "we are not happy with your service" is near the complaints it was trained on even though
it shares no words with them.

How
---
* Features: a sentence embedding (mean-pooled, L2-normalised) from a small pretrained model, on CPU,
  loaded once per process. Optionally concatenated with the word + character TF-IDF block of the OvR
  model, which helps with typos and exact domain words.
* Classifier: one multinomial Logistic Regression (scores add up to 100%), multiplied by a
  "familiarity" factor: the cosine similarity between the message and its nearest training example,
  mapped to 0-1 between two thresholds. That is what keeps "Hello" and the weather low even though
  softmax always picks a winner. (The benchmark also tries one Logistic Regression per label.)
* An exact training text scores 100%.

The pickle holds only the classifier, labels, training embeddings and settings; never the embedding
model. The embedding model is baked into the Docker image (see Dockerfile) and loaded from
TEXT_EMBED_MODEL_DIR with local_files_only=True, so nothing is downloaded at request time.

Benchmark: backend/scripts/benchmark_text_models.py.  Tests: backend/test_text_embed_model.py.
"""

from __future__ import annotations

import logging
import os
import pickle
import random
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
from sklearn.linear_model import LogisticRegression

from .text_ovr_service import _build_features, normalize_text

logger = logging.getLogger(__name__)

MODEL_TYPE = "sentence_embed_lr"
MODEL_FORMAT_VERSION = 1

# The embedding model: a Hugging Face id, baked into the image at TEXT_EMBED_MODEL_DIR.
DEFAULT_EMBED_MODEL = os.getenv("TEXT_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
EMBED_MODEL_DIR = os.getenv("TEXT_EMBED_MODEL_DIR", "")  # e.g. /app/models/text-embed (Docker image)

# Settings picked with scripts/benchmark_text_models.py on the 20 sample custody queries (bge-small,
# softmax x familiarity, C=50, high threshold at the 10th percentile): test set 10/12, median right
# 76%, lowest right 51%, off-topic 0%, leave-one-out 14/20 (old model: 10/12, 65%, 39%, 24-41%, 7/20).
# Misses one target: the 2 wrong answers come out at 60% and 66%, not below 50%.
DEFAULT_SETTINGS: Dict[str, Any] = {
    "classifier": "softmax",   # "softmax" (x familiarity) or "ovr"
    "C": 50.0,
    "tfidf": False,            # add the TF-IDF block of the OvR model
    "tfidf_weight": 0.5,
    "familiarity": True,
    "fam_high_pct": 10,        # high threshold = this percentile of in-domain nearest-neighbour similarity
    "fam_low_pct": 90,         # low threshold = this percentile of off-topic similarity
}

# Generic off-topic sentences, used only to place the low familiarity threshold (never the test set).
OFF_TOPIC_CALIBRATION = [
    "Good morning", "Hi there", "How are you?", "Thanks a lot", "Tell me a joke",
    "What time is it?", "Who won the cricket match yesterday?", "Recommend a good restaurant nearby",
    "Is it going to rain tomorrow?", "Play some music", "What is the capital of France?",
    "My cat is sleeping on the sofa", "I like watching movies on weekends", "Can you book a taxi?",
    "What's your name?", "Okay bye", "Happy birthday!", "How do I bake a cake?",
]


# ------------------------------------------------------------------ embedding model


class SentenceEmbedder:
    """Mean-pooled, L2-normalised sentence embeddings with plain transformers. Thread-safe, CPU."""

    def __init__(self, name: str = DEFAULT_EMBED_MODEL, local_dir: str = ""):
        self.name = name
        self.local_dir = local_dir
        self._tok = None
        self._model = None
        self._lock = threading.Lock()

    def _ensure(self):
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            from transformers import AutoModel, AutoTokenizer
            import torch

            torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
            source, local = (self.local_dir, True) if self.local_dir and os.path.isdir(self.local_dir) else (self.name, False)
            started = time.time()
            self._tok = AutoTokenizer.from_pretrained(source, local_files_only=local)
            model = AutoModel.from_pretrained(source, local_files_only=local)
            model.eval()
            self._model = model
            logger.info("Sentence-embedding model %s loaded in %.1fs", source, time.time() - started)

    def embed(self, texts: Sequence[str], batch_size: int = 32) -> np.ndarray:
        import torch

        self._ensure()
        out = []
        for i in range(0, len(texts), batch_size):
            batch = [str(t or "") for t in texts[i:i + batch_size]]
            enc = self._tok(batch, padding=True, truncation=True, max_length=128, return_tensors="pt")
            with torch.inference_mode():
                hidden = self._model(**enc).last_hidden_state
            mask = enc["attention_mask"].unsqueeze(-1).float()
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            out.append(pooled.cpu().numpy().astype(np.float32))
        return np.vstack(out) if out else np.zeros((0, 1), dtype=np.float32)

    def warm(self) -> None:
        self.embed(["warm up"])


_embedders: Dict[str, SentenceEmbedder] = {}
_embedders_lock = threading.Lock()


def get_embedder(name: str = DEFAULT_EMBED_MODEL) -> SentenceEmbedder:
    with _embedders_lock:
        if name not in _embedders:
            local = EMBED_MODEL_DIR if name == DEFAULT_EMBED_MODEL else ""
            _embedders[name] = SentenceEmbedder(name, local)
        return _embedders[name]


# ------------------------------------------------------------------ model


def _familiarity_thresholds(train_emb: np.ndarray, off_emb: np.ndarray, high_pct: float = 50, low_pct: float = 90) -> Dict[str, float]:
    """high: typical in-domain closeness (each training text to its nearest other training text);
    low: how close generic off-topic sentences come. Both from data that is never the test set."""
    sims = train_emb @ train_emb.T
    np.fill_diagonal(sims, -1.0)
    in_domain = sims.max(axis=1)
    off = (off_emb @ train_emb.T).max(axis=1)
    high = float(np.percentile(in_domain, high_pct))
    low = float(np.percentile(off, low_pct))
    if high <= low + 0.05:  # tiny or odd training sets: keep a usable band
        mid = (high + low) / 2
        low, high = mid - 0.05, mid + 0.05
    return {"low": low, "high": high}


def _features(model: Dict[str, Any], emb: np.ndarray, texts: Sequence[str]) -> np.ndarray:
    if model.get("tfidf_features") is None:
        return emb
    tf = model["tfidf_features"].transform([normalize_text(t) for t in texts]).toarray()
    return np.hstack([emb, tf * model["settings"]["tfidf_weight"]])


def fit(texts: List[str], labels: List[str], embedder: SentenceEmbedder, settings: Optional[Dict[str, Any]] = None,
        train_emb: Optional[np.ndarray] = None) -> Dict[str, Any]:
    """Fit on raw texts. `train_emb` can be passed in (leave-one-out reuses embeddings)."""
    settings = {**DEFAULT_SETTINGS, **(settings or {})}
    label_names = sorted(set(labels))
    emb = train_emb if train_emb is not None else embedder.embed(texts)
    model: Dict[str, Any] = {
        "format_version": MODEL_FORMAT_VERSION,
        "model_type": MODEL_TYPE,
        "embed_model": embedder.name,
        "labels": label_names,
        "settings": settings,
        "train_emb": emb,
        "tfidf_features": None,
    }
    if settings["tfidf"]:
        tf = _build_features()
        tf.fit([normalize_text(t) for t in texts])
        model["tfidf_features"] = tf
    x = _features(model, emb, texts)
    y = np.array(labels)
    if settings["classifier"] == "ovr":
        model["classifiers"] = {
            l: LogisticRegression(C=settings["C"], class_weight="balanced", max_iter=5000).fit(x, (y == l).astype(int))
            for l in label_names
        }
    else:
        clf = LogisticRegression(C=settings["C"], class_weight="balanced", max_iter=5000)
        clf.fit(x, y)
        model["classifier"] = clf
    model["familiarity"] = (
        _familiarity_thresholds(emb, embedder.embed(OFF_TOPIC_CALIBRATION), settings["fam_high_pct"], settings["fam_low_pct"])
        if settings["familiarity"] else None
    )

    by_text: Dict[str, Counter] = {}
    for t, l in zip(texts, labels):
        by_text.setdefault(normalize_text(t), Counter())[l] += 1
    model["exact"] = {t: c.most_common(1)[0][0] for t, c in by_text.items()}
    return model


def familiarity(model: Dict[str, Any], emb: np.ndarray) -> np.ndarray:
    """0-1 per message: how close it is to the nearest training example."""
    band = model.get("familiarity")
    if not band:
        return np.ones(len(emb))
    nearest = (emb @ model["train_emb"].T).max(axis=1)
    return np.clip((nearest - band["low"]) / (band["high"] - band["low"]), 0.0, 1.0)


def scores_many(model: Dict[str, Any], texts: Sequence[str], embedder: SentenceEmbedder) -> List[Dict[str, float]]:
    """0-1 score for every label, for each text."""
    emb = embedder.embed(texts)
    x = _features(model, emb, texts)
    if model["settings"]["classifier"] == "ovr":
        cols = {l: clf.predict_proba(x)[:, 1] for l, clf in model["classifiers"].items()}
        rows = [{l: float(cols[l][i]) for l in model["labels"]} for i in range(len(texts))]
    else:
        clf = model["classifier"]
        probs = clf.predict_proba(x)
        rows = [{str(l): float(p) for l, p in zip(clf.classes_, row)} for row in probs]
    fam = familiarity(model, emb)
    out = []
    for text, row, f in zip(texts, rows, fam):
        row = {l: v * float(f) for l, v in row.items()}
        exact = model["exact"].get(normalize_text(text))
        if exact is not None:
            row[exact] = 1.0
        out.append(row)
    return out


def _result(scores: Dict[str, float]) -> Dict[str, Any]:
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    top_label, top = ranked[0]
    return {
        "label": top_label,
        "confidence": round(top * 100, 1),
        "alternatives": [{"label": l, "confidence": round(s * 100, 1)} for l, s in ranked[1:]],
        "all_scores": [{"label": l, "confidence": round(s * 100, 1)} for l, s in ranked],
    }


# ------------------------------------------------------------------ trainer


class SentenceEmbedTrainer:
    """Train / save / predict for text-recognition projects (modelType sentence_embed_lr)."""

    def __init__(self, embed_model: str = DEFAULT_EMBED_MODEL, settings: Optional[Dict[str, Any]] = None):
        self.embed_model = embed_model
        self.settings = {**DEFAULT_SETTINGS, **(settings or {})}
        self._cache: Dict[str, Any] = {}
        self._cache_lock = threading.Lock()

    @property
    def embedder(self) -> SentenceEmbedder:
        return get_embedder(self.embed_model)

    def train_model(self, examples: List[Any]) -> Dict[str, Any]:
        texts, labels = [], []
        for ex in examples:
            text = ex.get("text") if isinstance(ex, dict) else getattr(ex, "text", None)
            label = ex.get("label") if isinstance(ex, dict) else getattr(ex, "label", None)
            text, label = str(text or "").strip(), str(label or "").strip()
            if normalize_text(text) and label:
                texts.append(text)
                labels.append(label)
        if len(texts) < 2:
            raise ValueError("Need at least 2 examples to train a model.")
        if len(set(labels)) < 2:
            raise ValueError("Need at least 2 different labels to train a model.")

        started = time.time()
        model = fit(texts, labels, self.embedder, self.settings)
        model["trained_at"] = datetime.now(timezone.utc).isoformat()
        model["training_examples"] = len(texts)
        predicted = [max(s, key=s.get) for s in scores_many(model, texts, self.embedder)]
        accuracy = sum(p == l for p, l in zip(predicted, labels)) / len(texts)
        logger.info("Sentence-embedding text model trained: %d examples, %d labels, %.0f ms",
                    len(texts), len(model["labels"]), (time.time() - started) * 1000)
        return {"model": model, "accuracy": accuracy, "labels": model["labels"],
                "training_examples": len(texts), "loss": None}

    def save_model_to_gcs(self, bucket, gcs_path: str, model: Dict[str, Any]) -> str:
        if not model:
            raise ValueError("Trained model is required - cannot save untrained models")
        payload = pickle.dumps(model)
        blob = bucket.blob(gcs_path)
        for attempt in range(5):
            try:
                blob.upload_from_string(payload, content_type="application/octet-stream", timeout=120)
                with self._cache_lock:
                    self._cache.pop(gcs_path, None)
                return gcs_path
            except Exception as err:  # noqa: BLE001
                if attempt == 4:
                    raise
                wait = (2 ** attempt) + random.random()
                logger.warning("Upload attempt %d failed: %s; retrying in %.1fs", attempt + 1, err, wait)
                time.sleep(wait)
        return gcs_path

    def load(self, bucket, gcs_path: str) -> Dict[str, Any]:
        blob = bucket.get_blob(gcs_path)
        if blob is None:
            raise FileNotFoundError(f"Model not found at {gcs_path}")
        with self._cache_lock:
            cached = self._cache.get(gcs_path)
            if cached and cached[0] == blob.generation:
                return cached[1]
        model = pickle.loads(blob.download_as_bytes())
        if not isinstance(model, dict) or model.get("model_type") != MODEL_TYPE:
            raise ValueError("Stored model is not a sentence_embed_lr model")
        with self._cache_lock:
            self._cache[gcs_path] = (blob.generation, model)
        return model

    def scores(self, model: Dict[str, Any], texts: Sequence[str]) -> List[Dict[str, float]]:
        return scores_many(model, texts, get_embedder(model.get("embed_model", self.embed_model)))

    def predict(self, model: Dict[str, Any], text: str) -> Dict[str, Any]:
        return _result(self.scores(model, [text])[0])

    def predict_from_gcs(self, text: str, bucket, gcs_path: str) -> Dict[str, Any]:
        return self.predict(self.load(bucket, gcs_path), text)


embed_text_trainer = SentenceEmbedTrainer()
