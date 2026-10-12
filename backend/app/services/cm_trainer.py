"""Training for Confusion Matrix projects (Exercise 3).

  lr    TF-IDF (Ex 2's own vectorizer and text cleaning) + scikit-learn logistic regression
  bert  DistilBERT sentence summaries + a logistic classifier trained on them (cm_bert)

Scores are P(class 0), the class we care about; an item is flagged when score >= threshold.

Cache: a fitted model is kept per (dataset version, text prep, every setting except the
threshold). Changing only the threshold reuses the fit, so it is instant and the scores are
identical: the model did not change, only its decision line.
"""

from __future__ import annotations

import logging
import pickle
import threading
import warnings
import zlib
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sklearn.exceptions import ConvergenceWarning
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion

from . import cm_bert
from .cm_datasets import CMDataset
from ..text_ovr_service import normalize_text
from .exercises_tfidf_service import _make_vectorizer, clean_note_text, normalize_text_prep

logger = logging.getLogger(__name__)

DEFAULT_PREP = {"drop_missing": True, "drop_duplicates": True, "lowercase": True, "strip_noise": True,
                "stopwords": False, "lemmatize": False}
SAMPLE_SEED = 5  # split seed for the built-in datasets
MODELS = ("lr", "bert")
FIT_KEYS = {  # settings that change the fitted model (the threshold never does)
    "lr": ("testSplit", "C", "ngrams", "maxFeatures", "maxIter"),
    "bert": ("testSplit", "maxLen", "epochs", "lr", "batch"),
}


@dataclass
class Fit:
    test_idx: List[int]
    labels: List[int]
    scores: List[float]
    train_n: int
    model_blob: bytes  # zlib(pickle({vectorizer, classifier, classes, params}))


_FIT_CACHE: "OrderedDict[Tuple, Fit]" = OrderedDict()
_CLEAN_CACHE: "OrderedDict[Tuple, List[str]]" = OrderedDict()
_FIT_CACHE_SIZE = 24
_CLEAN_CACHE_SIZE = 8
_LOCK = threading.Lock()


def _lru_get(cache: OrderedDict, key):
    with _LOCK:
        if key in cache:
            cache.move_to_end(key)
            return cache[key]
    return None


def _lru_put(cache: OrderedDict, key, value, size: int) -> None:
    with _LOCK:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > size:
            cache.popitem(last=False)


def stratified_split(y: List[int], test_split: float, seed: int) -> Tuple[List[int], List[int]]:
    """Per-class shuffle with a fixed seed: the same settings always hold back the same items."""
    rng = np.random.RandomState(seed)
    train, test = [], []
    for cls in (0, 1):
        idx = np.array([i for i, v in enumerate(y) if v == cls])
        rng.shuffle(idx)
        k = int(round(len(idx) * test_split))
        if len(idx) >= 2:
            k = min(max(k, 1), len(idx) - 1)  # small datasets: every class is both learned and tested
        test.extend(idx[:k].tolist())
        train.extend(idx[k:].tolist())
    return sorted(train), sorted(test)


def is_textrec(ds: CMDataset) -> bool:
    return ds.key.startswith("tr:")


def _textrec_features(ngrams: int, max_features: int) -> FeatureUnion:
    """Text Recognition's own features (text_ovr_service): words + character n-grams, built for
    a handful of examples per label and for mixed-language text such as Tanglish."""
    return FeatureUnion([
        ("words", TfidfVectorizer(ngram_range=(1, ngrams), token_pattern=r"(?u)\b\w+\b", sublinear_tf=True,
                                  min_df=1, max_features=max_features)),
        ("chars", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True, min_df=1)),
    ])


def slim(vectorizer) -> None:
    """Drop the terms cut by max_features (stop_words_): only kept for inspection, and on long
    texts it is hundreds of thousands of n-grams, pushing the saved model past Firestore's limit."""
    parts = [t for _, t in vectorizer.transformer_list] if isinstance(vectorizer, FeatureUnion) else [vectorizer]
    for part in parts:
        if hasattr(part, "stop_words_"):
            part.stop_words_ = None


def _cleaned(ds: CMDataset, prep: Dict[str, Any]) -> List[str]:
    key = (ds.key, ds.version, tuple(sorted(prep.items())))
    hit = _lru_get(_CLEAN_CACHE, key)
    if hit is not None:
        return hit
    if is_textrec(ds):
        out = [normalize_text(t) for t in ds.texts]
    else:
        out = [clean_note_text(t, prep, "tfidf") for t in ds.texts]
    _lru_put(_CLEAN_CACHE, key, out, _CLEAN_CACHE_SIZE)
    return out


def same_fit(model: str, a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return all(float(a[k]) == float(b[k]) for k in FIT_KEYS[model])


def fit_key(ds: CMDataset, params: Dict[str, Any], prep: Dict[str, Any], seed: int, model: str = "lr") -> Tuple:
    return (model, ds.key, ds.version, tuple(sorted(prep.items())), seed) + tuple(float(params[k]) for k in FIT_KEYS[model])


def train(ds: CMDataset, params: Dict[str, Any], prep: Optional[Dict[str, Any]] = None, seed: int = SAMPLE_SEED,
          model: str = "lr") -> Tuple[Fit, bool]:
    """Returns (fit, reused): reused is True when only the threshold differs from a cached fit."""
    if model not in MODELS:
        raise ValueError("Unknown model.")
    prep = normalize_text_prep(prep or DEFAULT_PREP)
    key = fit_key(ds, params, prep, seed, model)
    hit = _lru_get(_FIT_CACHE, key)
    if hit is not None:
        return hit, True
    if model == "bert":
        fit = _train_bert(ds, params, seed)
        _lru_put(_FIT_CACHE, key, fit, _FIT_CACHE_SIZE)
        return fit, False

    texts = _cleaned(ds, prep)
    train_idx, test_idx = stratified_split(ds.y, float(params["testSplit"]), seed)
    textrec = is_textrec(ds)
    if textrec:
        vectorizer = _textrec_features(int(params["ngrams"]), int(params["maxFeatures"]))
    else:
        vectorizer = _make_vectorizer(int(params["maxFeatures"]), 1, int(params["ngrams"]), 1)
    x_train = vectorizer.fit_transform([texts[i] for i in train_idx])
    y_train = np.array([1 if ds.y[i] == 0 else 0 for i in train_idx])  # 1 = class we care about
    if len(set(y_train.tolist())) < 2:
        raise ValueError("Each class needs examples to learn from. Add more examples, or hold back less test data.")
    classifier = LogisticRegression(C=float(params["C"]), max_iter=int(params["maxIter"]), solver="lbfgs",
                                    class_weight="balanced" if textrec else None)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)  # few iterations is a setting learners try on purpose
        classifier.fit(x_train, y_train)
    scores = classifier.predict_proba(vectorizer.transform([texts[i] for i in test_idx]))[:, 1]
    if textrec:
        # Text Recognition's exact-match rule: a sentence seen in training gets its taught label
        seen = {}
        for i in train_idx:
            seen.setdefault(texts[i], ds.y[i])
        scores = np.array([1.0 if seen.get(texts[i]) == 0 else (0.0 if seen.get(texts[i]) == 1 else s)
                           for i, s in zip(test_idx, scores)])

    slim(vectorizer)
    blob = zlib.compress(pickle.dumps({
        "vectorizer": vectorizer, "classifier": classifier, "classes": ds.classes,
        "params": {k: params[k] for k in ("testSplit", "C", "ngrams", "maxFeatures", "maxIter")},
        "seed": seed, "prep": prep, "dataset": ds.key, "datasetVersion": ds.version,
    }), 6)
    fit = Fit(test_idx=test_idx, labels=[ds.y[i] for i in test_idx], scores=[float(s) for s in scores],
              train_n=len(train_idx), model_blob=blob)
    _lru_put(_FIT_CACHE, key, fit, _FIT_CACHE_SIZE)
    return fit, False


def _train_bert(ds: CMDataset, params: Dict[str, Any], seed: int) -> Fit:
    if len(ds.texts) > cm_bert.MAX_ITEMS:
        raise ValueError(f"DistilBERT reads up to {cm_bert.MAX_ITEMS:,} examples here; this dataset has {len(ds.texts):,}. "
                         "Use logistic regression for it.")
    train_idx, test_idx = stratified_split(ds.y, float(params["testSplit"]), seed)
    y_target = np.array([1 if v == 0 else 0 for v in ds.y])
    if len(set(y_target[train_idx].tolist())) < 2:
        raise ValueError("Each class needs examples to learn from. Add more examples, or hold back less test data.")
    feats, _ = cm_bert.features(ds.key, ds.version, ds.texts, int(params["maxLen"]))
    scores, head = cm_bert.train_head(feats, y_target, train_idx, test_idx, int(params["epochs"]), float(params["lr"]),
                                      int(params["batch"]))
    blob = zlib.compress(pickle.dumps({
        "kind": "distilbert-head", "encoder": cm_bert.ENCODER_ID, "maxLen": int(params["maxLen"]), "head": head,
        "classes": ds.classes, "params": {k: params[k] for k in FIT_KEYS["bert"]}, "seed": seed,
        "dataset": ds.key, "datasetVersion": ds.version,
    }), 6)
    return Fit(test_idx=test_idx, labels=[ds.y[i] for i in test_idx], scores=[float(s) for s in scores],
               train_n=len(train_idx), model_blob=blob)


def metrics(labels: List[int], scores: List[float], threshold: float) -> Dict[str, Any]:
    m = {"tp": 0, "fn": 0, "fp": 0, "tn": 0}
    for y, s in zip(labels, scores):
        said = s >= threshold - 1e-9
        if y == 0:
            m["tp" if said else "fn"] += 1
        else:
            m["fp" if said else "tn"] += 1
    n = sum(m.values())
    precision = m["tp"] / (m["tp"] + m["fp"]) if m["tp"] + m["fp"] else 0.0
    recall = m["tp"] / (m["tp"] + m["fn"]) if m["tp"] + m["fn"] else 0.0
    return {**m, "n": n, "accuracy": (m["tp"] + m["tn"]) / n if n else 0.0, "precision": precision, "recall": recall,
            "f1": (2 * precision * recall) / (precision + recall) if precision + recall else 0.0}


def cell_of(y: int, score: float, threshold: float) -> str:
    said = score >= threshold - 1e-9
    return ("tp" if said else "fn") if y == 0 else ("fp" if said else "tn")


# Compact storage: Firestore indexes every array element, so long arrays are kept as strings
def encode_ints(values: List[int]) -> str:
    return ",".join(str(int(v)) for v in values)


def decode_ints(raw: str) -> List[int]:
    return [int(v) for v in raw.split(",")] if raw else []


def encode_scores(values: List[float]) -> str:
    return ",".join(f"{v:.5f}" for v in values)


def decode_scores(raw: str) -> List[float]:
    return [float(v) for v in raw.split(",")] if raw else []
