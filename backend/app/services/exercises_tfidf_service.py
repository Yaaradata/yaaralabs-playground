"""Isolated TF-IDF + Logistic Regression trainer for Exercise 2.

Uses sklearn for the real vectorizer and classifier. Does not touch other
project-type training pipelines.
"""

from __future__ import annotations

import hashlib
import logging
import pickle
import random
import re
import threading
import time
import warnings
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, log_loss, precision_recall_fscore_support
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline

logger = logging.getLogger(__name__)

MAX_MODELS = 48
DISK_MODEL_CAP = 200
TRAIN_GAP_SEC = 3
_MODEL_DIR = Path(__file__).resolve().parents[1] / "data" / "exercises" / "runtime" / "models"
_LAST_TRAIN: Dict[str, float] = {}
_TRAINING: set[str] = set()
MAX_REVIEW_CHARS = 4000
WORD_WEIGHT_LIMIT = 80
ALLOWED_SOLVERS = frozenset({"lbfgs", "liblinear", "saga"})
ALLOWED_REPRESENTATIONS = frozenset({"tfidf", "embeddings"})
DEFAULT_TEST_SIZE = 0.2
DEFAULT_SEED = 42
DEFAULT_MAX_FEATURES = 1000
DEFAULT_NGRAM = (1, 2)
DEFAULT_MIN_DF = 1
DEFAULT_C = 1.0
DEFAULT_SOLVER = "lbfgs"
DEFAULT_MAX_ITER = 500
DEFAULT_EPOCHS = 100
EMBED_DIM = 384

STOP_WORDS = frozenset(
    "a an and are as at be by for from has have i in is it its of on or "
    "that the this to was were will with you your my me we our us they them "
    "their all every very just so also really even still more most some "
    "any only first actually".split()
)

POSITIVE_LABELS = frozenset({"positive", "pos", "1", "good", "+", "1.0"})
NEGATIVE_LABELS = frozenset({"negative", "neg", "0", "bad", "-", "0.0"})
REVIEW_HEADERS = ("review", "reviews", "text", "sentence", "comment", "feedback")
LABEL_HEADERS = ("sentiment", "label", "class", "target", "rating")

SAMPLE_CSV = """review,sentiment
"This product exceeded my expectations, absolutely love it!",positive
"Terrible quality, broke after just two days.",negative
"Fast shipping and the item works perfectly.",positive
"Worst purchase I have ever made, complete waste of money.",negative
"Great value for the price, highly recommend.",positive
"The packaging was damaged and the product was defective.",negative
"Customer service was friendly and very helpful.",positive
"I waited three weeks and it never arrived.",negative
"Comfortable, well made, and looks fantastic.",positive
"Cheap material that felt flimsy and fell apart.",negative
"Exactly as described, I am very happy with it.",positive
"Stopped working within a week, very disappointed.",negative
"Easy to set up and works like a charm.",positive
"The instructions were confusing and nothing fit properly.",negative
"Beautiful design and excellent build quality.",positive
"Overpriced for what you actually get.",negative
"My whole family loves this, we use it every day.",positive
"It arrived in the wrong color and size.",negative
"Superb performance and the battery lasts all day.",positive
"Battery drains fast and it overheats constantly.",negative
"Five stars, would buy again without hesitation.",positive
"Do not buy this, it is a total scam.",negative
"The fabric is soft and the fit is perfect.",positive
"Poor stitching and the zipper broke immediately.",negative
"Incredible sound quality for such a small speaker.",positive
"The screen cracked on the very first day of use.",negative
"Reliable, sturdy, and worth every penny.",positive
"Slow, buggy, and it crashed multiple times.",negative
"Delicious taste and genuinely fresh ingredients.",positive
"Stale, bland, and clearly past its expiry date.",negative
"""

_LOCK = threading.Lock()
_MODELS: "OrderedDict[str, FittedTfidfStudio]" = OrderedDict()


@dataclass
class ReviewRow:
    review: str
    y: int
    label: str = ""


@dataclass
class FittedTfidfStudio:
    vectorizer: Any
    classifier: LogisticRegression
    vocab: List[str]
    idf: List[float]
    weights: np.ndarray
    bias: np.ndarray
    classes: List[str]
    representation: str = "tfidf"
    text_prep: Dict[str, Any] = field(default_factory=dict)


def tokenize(text: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())
    return [word for word in cleaned.split() if len(word) > 1 and word not in STOP_WORDS]


def _hash32(text: str) -> int:
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def sentence_embed(text: str, dim: int = EMBED_DIM) -> np.ndarray:
    """Deterministic 384-d classroom sentence embedding (SBERT/USE-shaped)."""
    vec = np.zeros(max(8, int(dim)), dtype=np.float64)
    blob = f" {(text or '').lower()} "
    if not blob.strip():
        return vec
    for n in (3, 4, 5):
        limit = len(blob) - n + 1
        for i in range(max(0, limit)):
            gram = blob[i : i + n]
            hashed = _hash32(f"c{n}:{gram}")
            sign = 1.0 if (hashed & 1) == 0 else -1.0
            vec[hashed % vec.size] += sign
    for word in tokenize(text):
        hashed = _hash32(f"w:{word}")
        sign = 1.5 if (hashed & 1) == 0 else -1.5
        vec[hashed % vec.size] += sign
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec /= norm
    return vec


class SentenceEmbedder:
    """sklearn-compatible dense embedder for the Exercise 2 sentence-embedding path."""

    def __init__(self, dim: int = EMBED_DIM):
        self.dim = max(8, int(dim))

    def fit(self, X: Sequence[str], y: Any = None) -> "SentenceEmbedder":
        return self

    def transform(self, X: Sequence[str]) -> np.ndarray:
        return np.vstack([sentence_embed(text, self.dim) for text in list(X)])

    def fit_transform(self, X: Sequence[str], y: Any = None) -> np.ndarray:
        return self.transform(X)


def _clean_review(text: str) -> str:
    return " ".join((text or "").split())[:MAX_REVIEW_CHARS]


_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0000FE0F"
    "\U0000200D"
    "]+",
    flags=re.UNICODE,
)
_LEMMA = {
    "are": "be",
    "is": "be",
    "was": "be",
    "were": "be",
    "been": "be",
    "being": "be",
    "has": "have",
    "had": "have",
    "having": "have",
    "does": "do",
    "did": "do",
    "doing": "do",
    "thrown": "throw",
    "threw": "throw",
    "ran": "run",
    "running": "run",
    "said": "say",
    "went": "go",
    "going": "go",
    "got": "get",
    "getting": "get",
}


def _lemma_token(word: str) -> str:
    if word in _LEMMA:
        return _LEMMA[word]
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 4 and word.endswith("ed"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def normalize_text_prep(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    blob = raw or {}
    return {
        "drop_missing": blob.get("drop_missing", True) is not False,
        "drop_duplicates": blob.get("drop_duplicates", True) is not False,
        "lowercase": blob.get("lowercase", True) is not False,
        "strip_noise": blob.get("strip_noise", True) is not False,
        "stopwords": blob.get("stopwords") is True,
        "lemmatize": blob.get("lemmatize") is True,
    }


def clean_note_text(text: str, prep: Dict[str, Any], representation: str = "tfidf") -> str:
    next_text = (text or "").replace("\x00", "")
    if prep.get("strip_noise", True):
        next_text = _URL_RE.sub(" ", next_text)
        next_text = _EMOJI_RE.sub(" ", next_text)
        next_text = re.sub(r"[^a-zA-Z0-9\s]", " ", next_text)
    if prep.get("lowercase", True):
        next_text = next_text.lower()
    next_text = " ".join(next_text.split())
    tfidf_only = (representation or "tfidf") != "embeddings"
    if not tfidf_only or (not prep.get("stopwords") and not prep.get("lemmatize")) or not next_text:
        return next_text[:MAX_REVIEW_CHARS]
    tokens = next_text.split()
    out: List[str] = []
    for word in tokens:
        lemma = _lemma_token(word) if tfidf_only and prep.get("lemmatize") else word
        if tfidf_only and prep.get("stopwords"):
            if len(lemma) <= 1 or lemma in STOP_WORDS:
                continue
        out.append(lemma)
    joined = " ".join(out).strip()
    return (joined or next_text)[:MAX_REVIEW_CHARS]


def apply_text_prep(
    rows: List[ReviewRow],
    prep: Optional[Dict[str, Any]],
    representation: str = "tfidf",
) -> List[ReviewRow]:
    settings = normalize_text_prep(prep)
    next_rows = list(rows)
    if settings["drop_missing"]:
        next_rows = [row for row in next_rows if (row.review or "").strip() and (row.label or "").strip()]
    if settings["drop_duplicates"]:
        seen = set()
        kept: List[ReviewRow] = []
        for row in next_rows:
            key = (row.review or "").strip()
            if key in seen:
                continue
            seen.add(key)
            kept.append(row)
        next_rows = kept
    cleaned: List[ReviewRow] = []
    for row in next_rows:
        text = clean_note_text(row.review, settings, representation)
        if not text:
            continue
        cleaned.append(ReviewRow(review=text, y=row.y, label=row.label))
    return cleaned


def parse_csv(text: str) -> List[List[str]]:
    rows: List[List[str]] = []
    field = ""
    row: List[str] = []
    quoted = False
    i = 0
    blob = text or ""
    while i < len(blob):
        ch = blob[i]
        if quoted:
            if ch == '"':
                if i + 1 < len(blob) and blob[i + 1] == '"':
                    field += '"'
                    i += 2
                    continue
                quoted = False
                i += 1
                continue
            field += ch
            i += 1
            continue
        if ch == '"':
            quoted = True
            i += 1
            continue
        if ch == ",":
            row.append(field)
            field = ""
            i += 1
            continue
        if ch == "\r":
            i += 1
            continue
        if ch == "\n":
            row.append(field)
            rows.append(row)
            row = []
            field = ""
            i += 1
            continue
        field += ch
        i += 1
    if field or row:
        row.append(field)
        rows.append(row)
    return [r for r in rows if r and not (len(r) == 1 and not r[0].strip())]


def load_dataset_from_csv(text: str) -> List[ReviewRow]:
    table = parse_csv(text)
    if not table:
        raise ValueError("The file looks empty.")
    header = [cell.strip().lower() for cell in table[0]]
    review_i = next((i for i, name in enumerate(header) if name in REVIEW_HEADERS), -1)
    label_i = next((i for i, name in enumerate(header) if name in LABEL_HEADERS), -1)
    start = 1
    if review_i < 0 or label_i < 0:
        review_i, label_i, start = 0, 1, 0
    return _rows_from_table(table, review_i, label_i, start)


def rows_from_payload(payload: Sequence[Any]) -> List[ReviewRow]:
    pairs: List[Tuple[str, str]] = []
    for item in payload:
        review = ""
        label = ""
        if hasattr(item, "review"):
            review = item.review or ""
            label = _payload_label_name(
                getattr(item, "label", None),
                getattr(item, "sentiment", None),
                getattr(item, "y", None),
            )
        elif isinstance(item, dict):
            review = str(item.get("review") or item.get("text") or "")
            label = _payload_label_name(item.get("label"), item.get("sentiment"), item.get("y"))
        review = _clean_review(review)
        if not review or not label or not tokenize(review):
            continue
        pairs.append((review, label))
    return _encode_pairs(pairs)


def _payload_label_name(label: Any, sentiment: Any, y: Any) -> str:
    if label is not None and str(label).strip():
        return str(label).strip()
    if sentiment is not None and str(sentiment).strip():
        return str(sentiment).strip()
    if y is not None and str(y) != "":
        return "positive" if int(y) == 1 else "negative"
    return ""


def _label_from_text(raw: Optional[str]) -> Optional[int]:
    label = (raw or "").strip().lower()
    if label in POSITIVE_LABELS:
        return 1
    if label in NEGATIVE_LABELS:
        return 0
    return None


def _encode_pairs(pairs: Sequence[Tuple[str, str]]) -> List[ReviewRow]:
    if len(pairs) < 4:
        raise ValueError("Need a few labeled rows with text + label columns.")
    names: List[str] = []
    for _, label in pairs:
        if label not in names:
            names.append(label)
    lowered = {name.lower() for name in names}
    if lowered <= (POSITIVE_LABELS | NEGATIVE_LABELS) and lowered & POSITIVE_LABELS and lowered & NEGATIVE_LABELS:
        encoded = [
            ReviewRow(
                review=review,
                y=1 if label.lower() in POSITIVE_LABELS else 0,
                label="positive" if label.lower() in POSITIVE_LABELS else "negative",
            )
            for review, label in pairs
        ]
        _require_min_per_class(encoded)
        return encoded
    classes = sorted(names)
    index = {name: i for i, name in enumerate(classes)}
    encoded = [ReviewRow(review=review, y=index[label], label=label) for review, label in pairs]
    _require_min_per_class(encoded)
    return encoded


def _require_min_per_class(data: Sequence[ReviewRow], minimum: int = 2) -> None:
    counts: Dict[int, int] = {}
    for row in data:
        counts[row.y] = counts.get(row.y, 0) + 1
    if len(counts) < 2:
        raise ValueError("Need at least two classes to train.")
    if any(count < minimum for count in counts.values()):
        raise ValueError("Each class needs at least 2 labeled texts to train.")


def _rows_from_table(table: List[List[str]], review_i: int, label_i: int, start: int) -> List[ReviewRow]:
    pairs: List[Tuple[str, str]] = []
    for row in table[start:]:
        if review_i >= len(row) or label_i >= len(row):
            continue
        review = _clean_review(row[review_i] or "")
        label = (row[label_i] or "").strip()
        if not review or not label or not tokenize(review):
            continue
        pairs.append((review, label))
    return _encode_pairs(pairs)


def _model_key(session_id: str, project_id: str) -> str:
    return f"{session_id}:{project_id}"


def _model_path(key: str) -> Path:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return _MODEL_DIR / f"{digest}.pkl"


def _trim_model_files() -> None:
    if not _MODEL_DIR.exists():
        return
    files = sorted(_MODEL_DIR.glob("*.pkl"), key=lambda path: path.stat().st_mtime)
    extra = len(files) - DISK_MODEL_CAP
    for path in files[: max(0, extra)]:
        path.unlink(missing_ok=True)


def _write_model(key: str, fitted: "FittedTfidfStudio") -> None:
    _MODEL_DIR.mkdir(parents=True, exist_ok=True)
    path = _model_path(key)
    temporary = path.with_suffix(".tmp")
    with temporary.open("wb") as handle:
        pickle.dump(fitted, handle, protocol=pickle.HIGHEST_PROTOCOL)
    temporary.replace(path)
    _trim_model_files()


def _read_model(key: str) -> Optional["FittedTfidfStudio"]:
    path = _model_path(key)
    if not path.exists():
        return None
    try:
        with path.open("rb") as handle:
            fitted = pickle.load(handle)
    except (OSError, pickle.UnpicklingError, EOFError) as exc:
        logger.warning("Could not reload Exercise 2 model %s: %s", path.name, exc)
        return None
    if not isinstance(fitted, FittedTfidfStudio):
        return None
    return fitted


def drop_model(session_id: str, project_id: str) -> None:
    key = _model_key(session_id, project_id)
    with _LOCK:
        _MODELS.pop(key, None)
        _TRAINING.discard(key)
    _model_path(key).unlink(missing_ok=True)


def begin_train(session_id: str, project_id: str) -> None:
    key = _model_key(session_id, project_id)
    now = time.time()
    with _LOCK:
        if key in _TRAINING:
            raise ValueError("This project is already training. Wait for it to finish.")
        last = _LAST_TRAIN.get(key, 0.0)
        if now - last < TRAIN_GAP_SEC:
            raise ValueError("Wait a few seconds before training again.")
        _TRAINING.add(key)


def end_train(session_id: str, project_id: str) -> None:
    key = _model_key(session_id, project_id)
    with _LOCK:
        _TRAINING.discard(key)
        _LAST_TRAIN[key] = time.time()


def _store_model(session_id: str, project_id: str, fitted: "FittedTfidfStudio") -> None:
    key = _model_key(session_id, project_id)
    try:
        _write_model(key, fitted)
    except OSError as exc:
        logger.warning("Exercise 2 model stayed in memory only: %s", exc)
    with _LOCK:
        if key in _MODELS:
            _MODELS.move_to_end(key)
        _MODELS[key] = fitted
        while len(_MODELS) > MAX_MODELS:
            _MODELS.popitem(last=False)


def _get_model(session_id: str, project_id: str) -> Optional["FittedTfidfStudio"]:
    key = _model_key(session_id, project_id)
    with _LOCK:
        fitted = _MODELS.get(key)
        if fitted is not None:
            _MODELS.move_to_end(key)
            return fitted
    fitted = _read_model(key)
    if fitted is None:
        return None
    _store_model(session_id, project_id, fitted)
    return fitted


class _NgramAnalyzer:
    """Module-level analyzer so a fitted vectorizer can be saved and reloaded."""

    def __init__(self, ngram_min: int, ngram_max: int) -> None:
        self.nmin = max(1, min(3, int(ngram_min)))
        self.nmax = max(self.nmin, min(3, int(ngram_max)))

    def __call__(self, text: str) -> List[str]:
        tokens = tokenize(text)
        features: List[str] = []
        for n in range(self.nmin, self.nmax + 1):
            for i in range(0, max(0, len(tokens) - n + 1)):
                features.append(" ".join(tokens[i : i + n]))
        return features


def _ngram_analyzer(ngram_min: int, ngram_max: int) -> _NgramAnalyzer:
    return _NgramAnalyzer(ngram_min, ngram_max)


def _make_vectorizer(
    max_features: int = DEFAULT_MAX_FEATURES,
    ngram_min: int = DEFAULT_NGRAM[0],
    ngram_max: int = DEFAULT_NGRAM[1],
    min_df: int = DEFAULT_MIN_DF,
) -> TfidfVectorizer:
    return TfidfVectorizer(
        analyzer=_ngram_analyzer(ngram_min, ngram_max),
        lowercase=False,
        norm="l2",
        use_idf=True,
        smooth_idf=True,
        sublinear_tf=True,
        min_df=max(1, int(min_df)),
        max_features=max(50, int(max_features)),
    )


def _make_curve_sgd(seed: int, C: float, n_samples: int, n_epochs: int) -> SGDClassifier:
    alpha = 1.0 / (max(0.1, float(C)) * max(1, int(n_samples)))
    eta0 = min(0.32, max(0.018, 2.6 / max(10.0, float(n_epochs))))
    kwargs = {
        "penalty": "l2",
        "alpha": alpha,
        "learning_rate": "constant",
        "eta0": eta0,
        "max_iter": 1,
        "tol": None,
        "shuffle": True,
        "random_state": int(seed),
        "warm_start": True,
        "fit_intercept": True,
    }
    try:
        return SGDClassifier(loss="log_loss", **kwargs)
    except ValueError:
        return SGDClassifier(loss="log", **kwargs)


def _make_classifier(
    seed: int,
    n_classes: int = 2,
    C: float = DEFAULT_C,
    solver: str = DEFAULT_SOLVER,
    max_iter: int = DEFAULT_MAX_ITER,
    warm_start: bool = False,
) -> LogisticRegression:
    if solver not in ALLOWED_SOLVERS:
        raise ValueError("Choose a solver: lbfgs, liblinear, or saga.")
    return LogisticRegression(
        penalty="l2",
        C=float(C),
        solver=solver,
        class_weight="balanced",
        fit_intercept=True,
        max_iter=max(1, int(max_iter)),
        warm_start=bool(warm_start),
        random_state=int(seed),
    )


def _stratified_split(data: List[ReviewRow], frac: float, seed: int) -> Tuple[List[ReviewRow], List[ReviewRow]]:
    rng = random.Random(int(seed))
    grouped: Dict[int, List[ReviewRow]] = {}
    for row in data:
        grouped.setdefault(row.y, []).append(row)
    test: List[ReviewRow] = []
    train: List[ReviewRow] = []
    for items in grouped.values():
        rng.shuffle(items)
        n_test = max(1, min(round(len(items) * frac), len(items) - 1))
        test.extend(items[:n_test])
        train.extend(items[n_test:])
    return train, test


def _interleave_by_class(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Mix classes so a saved prefix still contains every label."""
    groups: Dict[int, List[Dict[str, Any]]] = {}
    order: List[int] = []
    for row in rows:
        label = int(row["y"])
        if label not in groups:
            groups[label] = []
            order.append(label)
        groups[label].append(row)
    indexes = {label: 0 for label in order}
    mixed: List[Dict[str, Any]] = []
    while len(mixed) < len(rows):
        for label in order:
            index = indexes[label]
            bucket = groups[label]
            if index < len(bucket):
                mixed.append(bucket[index])
                indexes[label] = index + 1
    return mixed


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30.0, 30.0)))


def _as_1d(values: Any) -> np.ndarray:
    array = np.asarray(values, dtype=np.float64)
    if array.ndim > 1:
        return array.ravel()
    return array


def _class_names(data: Sequence[ReviewRow]) -> List[str]:
    n_classes = max(row.y for row in data) + 1
    names = [f"class_{i}" for i in range(n_classes)]
    for row in data:
        if row.label:
            names[row.y] = row.label
    return names


def _class_beliefs(coef: np.ndarray, vocab: List[str], class_names: Sequence[str], k: int = 6) -> List[Dict[str, Any]]:
    matrix = np.atleast_2d(np.asarray(coef, dtype=np.float64))
    if matrix.shape[0] == 1 and len(class_names) == 2:
        pos_words, neg_words = _belief_words(matrix[0], vocab, k)
        return [
            {"label": class_names[1], "words": pos_words},
            {"label": class_names[0], "words": neg_words},
        ]
    beliefs: List[Dict[str, Any]] = []
    for i, name in enumerate(class_names):
        if i >= matrix.shape[0]:
            beliefs.append({"label": name, "words": []})
            continue
        ranked = [
            vocab[j]
            for j, weight in sorted(enumerate(matrix[i].tolist()), key=lambda item: item[1], reverse=True)
            if j < len(vocab) and weight > 1e-4
        ]
        beliefs.append({"label": name, "words": ranked[:k]})
    return beliefs


def _curve_from_learner(
    clf: Any,
    x_train,
    y_train: np.ndarray,
    x_test,
    y_test: np.ndarray,
    vocab: List[str],
    class_names: Sequence[str],
    epoch: int,
    threshold: float,
) -> Dict[str, Any]:
    train_proba = clf.predict_proba(x_train)
    test_proba = clf.predict_proba(x_test)
    n_classes = max(2, len(class_names))
    labels = list(range(n_classes))
    if n_classes == 2:
        test_pred = (test_proba[:, 1] >= float(threshold)).astype(int)
    else:
        test_pred = np.argmax(test_proba, axis=1)
    train_pred = np.argmax(train_proba, axis=1) if n_classes > 2 else (train_proba[:, 1] >= float(threshold)).astype(int)
    test_metrics = _label_metrics(y_test, test_pred) if len(y_test) else {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0}
    train_metrics = _label_metrics(y_train, train_pred) if len(y_train) else {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0}
    loss = float(log_loss(y_train, train_proba, labels=labels))
    beliefs = _class_beliefs(clf.coef_, vocab, class_names)
    pos_words = beliefs[0]["words"] if beliefs else []
    neg_words = beliefs[1]["words"] if len(beliefs) > 1 else []
    if len(class_names) == 2:
        pos_words, neg_words = _belief_words(np.atleast_2d(clf.coef_)[0], vocab)
    return {
        "epoch": int(epoch),
        "loss": loss,
        "acc": test_metrics["accuracy"],
        "train_acc": train_metrics["accuracy"],
        "prec": test_metrics["precision"],
        "rec": test_metrics["recall"],
        "f1": test_metrics["f1"],
        "pos_words": pos_words,
        "neg_words": neg_words,
        "class_words": beliefs,
    }


def _label_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true,
        y_pred,
        average="macro",
        zero_division=0,
    )
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
    }


SEED_POS = frozenset(
    "love great perfect excellent happy fantastic amazing wonderful best superb".split()
)
SEED_NEG = frozenset(
    "broke waste terrible worst damaged disappointed cracked cheap flimsy scam".split()
)


def _belief_words(weights: np.ndarray, vocab: List[str], k: int = 8) -> Tuple[List[str], List[str]]:
    scored = [(vocab[i], float(weights[i])) for i in range(min(len(vocab), weights.size))]
    pos_ranked = [word for word, weight in sorted(scored, key=lambda item: item[1], reverse=True) if weight > 1e-4]
    neg_ranked = [word for word, weight in sorted(scored, key=lambda item: item[1]) if weight < -1e-4]

    def pick(ranked: List[str], seeds: frozenset) -> List[str]:
        chosen: List[str] = []
        for word in ranked:
            if word in seeds and word not in chosen:
                chosen.append(word)
            if len(chosen) >= 3:
                break
        for word in ranked:
            if word not in chosen:
                chosen.append(word)
            if len(chosen) >= k:
                break
        return chosen

    return pick(pos_ranked, SEED_POS), pick(neg_ranked, SEED_NEG)


def _pin_curve_tail(curve: List[Dict[str, Any]], finals: Dict[str, float]) -> None:
    if not curve:
        return
    last = curve[-1]
    for key, value in finals.items():
        last[key] = float(value)


def _majority_test_acc(y_train: np.ndarray, y_test: np.ndarray) -> float:
    if y_train.size == 0 or y_test.size == 0:
        return 0.0
    majority = int(np.bincount(y_train.astype(int)).argmax())
    return float(np.mean(y_test == majority))


def _curve_checkpoints(total: int, points: int = 121) -> List[int]:
    steps = max(1, int(total))
    n_records = min(max(1, points - 1), steps)
    checkpoints = sorted({max(1, int(round(steps * i / n_records))) for i in range(1, n_records + 1)})
    if checkpoints[-1] != steps:
        checkpoints.append(steps)
    return checkpoints


def _predict_labels(clf: LogisticRegression, matrix, n_classes: int, threshold: float) -> np.ndarray:
    if n_classes == 2:
        proba = clf.predict_proba(matrix)
        return (proba[:, 1] >= float(threshold)).astype(int)
    return clf.predict(matrix)


def _learning_curve(
    x_train,
    y_train: np.ndarray,
    x_test,
    y_test: np.ndarray,
    vocab: List[str],
    seed: int,
    class_names: Sequence[str],
    C: float,
    solver: str,
    max_iter: int,
    epochs: int,
    threshold: float,
    n_classes: int,
) -> Tuple[LogisticRegression, List[Dict[str, Any]]]:
    empty = [{"label": name, "words": []} for name in class_names]
    n_epochs = max(1, int(epochs))
    solver_iters = max(1, int(max_iter))
    majority = int(np.bincount(y_train.astype(int)).argmax()) if y_train.size else 0
    start_train = _label_metrics(y_train, np.full(y_train.shape, majority, dtype=int)) if y_train.size else {
        "accuracy": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
    }
    start_test = _label_metrics(y_test, np.full(y_test.shape, majority, dtype=int)) if y_test.size else {
        "accuracy": 0.0,
        "precision": 0.0,
        "recall": 0.0,
        "f1": 0.0,
    }
    curve: List[Dict[str, Any]] = [
        {
            "epoch": 0,
            "loss": float(np.log(max(2, n_classes))),
            "acc": start_test["accuracy"] if y_test.size else _majority_test_acc(y_train, y_test),
            "train_acc": start_train["accuracy"],
            "prec": start_test["precision"],
            "rec": start_test["recall"],
            "f1": start_test["f1"],
            "pos_words": [],
            "neg_words": [],
            "class_words": empty,
        }
    ]
    record_at = _curve_checkpoints(n_epochs, points=min(40, max(8, n_epochs)))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if solver == "liblinear":
            learner = _make_curve_sgd(seed, C, int(x_train.shape[0]), n_epochs)
            classes = np.unique(y_train)
            for step in record_at:
                learner.partial_fit(x_train, y_train, classes=classes)
                curve.append(
                    _curve_from_learner(
                        learner,
                        x_train,
                        y_train,
                        x_test,
                        y_test,
                        vocab,
                        class_names,
                        step,
                        threshold,
                    )
                )
        else:
            extra = max(1, (solver_iters + max(1, len(record_at)) - 1) // max(1, len(record_at)))
            learner = _make_classifier(seed, n_classes, C, solver, extra, warm_start=True)
            for step in record_at:
                learner.fit(x_train, y_train)
                curve.append(
                    _curve_from_learner(
                        learner,
                        x_train,
                        y_train,
                        x_test,
                        y_test,
                        vocab,
                        class_names,
                        step,
                        threshold,
                    )
                )
        production = _make_classifier(seed, n_classes, C, solver, solver_iters, warm_start=False)
        production.fit(x_train, y_train)
    return production, curve


def train(
    session_id: str,
    project_id: str,
    data: List[ReviewRow],
    test_size: float = DEFAULT_TEST_SIZE,
    seed: int = DEFAULT_SEED,
    max_features: int = DEFAULT_MAX_FEATURES,
    ngram_min: int = DEFAULT_NGRAM[0],
    ngram_max: int = DEFAULT_NGRAM[1],
    min_df: int = DEFAULT_MIN_DF,
    C: float = DEFAULT_C,
    solver: str = DEFAULT_SOLVER,
    max_iter: int = DEFAULT_MAX_ITER,
    threshold: float = 0.5,
    epochs: int = DEFAULT_EPOCHS,
    representation: str = "tfidf",
    text_prep: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    chosen_rep = (representation or "tfidf").strip().lower()
    if chosen_rep not in ALLOWED_REPRESENTATIONS:
        raise ValueError("Choose a representation: tfidf or embeddings.")
    data = apply_text_prep(data, text_prep, chosen_rep)
    if len(data) < 4:
        raise ValueError("Need at least 4 labeled notes after cleaning.")
    class_names = _class_names(data)
    n_classes = len(class_names)
    _require_min_per_class(data)
    class_counts = {name: 0 for name in class_names}
    for row in data:
        class_counts[class_names[row.y]] += 1

    nmin = max(1, min(3, int(ngram_min)))
    nmax = max(nmin, min(3, int(ngram_max)))
    features = max(50, int(max_features))
    df_min = max(1, int(min_df))
    C_value = min(10.0, max(0.1, float(C)))
    if solver not in ALLOWED_SOLVERS:
        raise ValueError("Choose a solver: lbfgs, liblinear, or saga.")
    chosen_solver = solver
    iters = max(50, int(max_iter))
    n_epochs_requested = max(10, min(2000, int(epochs)))

    train_rows, test_rows = _stratified_split(data, test_size, seed)
    train_texts = [row.review for row in train_rows]
    train_y = np.array([row.y for row in train_rows], dtype=int)
    test_texts = [row.review for row in test_rows]
    test_y = np.array([row.y for row in test_rows], dtype=int)

    if chosen_rep == "embeddings":
        vectorizer = SentenceEmbedder(EMBED_DIM)
        x_train = vectorizer.fit_transform(train_texts)
        x_test = vectorizer.transform(test_texts)
        vocab = [f"dim {i}" for i in range(EMBED_DIM)]
        idf = [1.0] * EMBED_DIM
        n_features = EMBED_DIM
    else:
        vectorizer = _make_vectorizer(features, nmin, nmax, df_min)
        x_train = vectorizer.fit_transform(train_texts)
        if x_train.shape[1] == 0:
            raise ValueError("No usable words left after tokenization. Add more descriptive reviews.")
        x_test = vectorizer.transform(test_texts)
        vocab = vectorizer.get_feature_names_out().tolist()
        idf = vectorizer.idf_.astype(float).tolist()
        n_features = len(vocab)

    classifier, curve = _learning_curve(
        x_train,
        train_y,
        x_test,
        test_y,
        vocab,
        seed,
        class_names,
        C_value,
        chosen_solver,
        iters,
        n_epochs_requested,
        float(threshold),
        n_classes,
    )
    train_pred = _predict_labels(classifier, x_train, n_classes, float(threshold))
    test_pred = _predict_labels(classifier, x_test, n_classes, float(threshold))
    test_proba = classifier.predict_proba(x_test)
    train_metrics = _label_metrics(train_y, train_pred)
    test_metrics = _label_metrics(test_y, test_pred)
    if curve:
        _pin_curve_tail(
            curve,
            {
                "acc": test_metrics["accuracy"],
                "train_acc": train_metrics["accuracy"],
                "prec": test_metrics["precision"],
                "rec": test_metrics["recall"],
                "f1": test_metrics["f1"],
            },
        )
    majority = max(class_counts.values()) if class_counts else 0
    baseline = float(majority / max(1, len(data)))

    all_texts = [row.review for row in data]
    all_y = np.array([row.y for row in data], dtype=int)
    min_class = min(class_counts.values()) if class_counts else 0
    cv_metrics = test_metrics
    if len(data) <= 1500:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                cv_splits = max(2, min(5, min_class))
                cv = StratifiedKFold(n_splits=cv_splits, shuffle=True, random_state=int(seed))
                oof_pred = cross_val_predict(
                    make_pipeline(
                        SentenceEmbedder(EMBED_DIM)
                        if chosen_rep == "embeddings"
                        else _make_vectorizer(features, nmin, nmax, df_min),
                        _make_classifier(seed, n_classes, C_value, chosen_solver, iters),
                    ),
                    all_texts,
                    all_y,
                    cv=cv,
                )
                cv_metrics = _label_metrics(all_y, oof_pred)
            except Exception as exc:
                logger.warning("TF-IDF cross-validation failed (%s); using hold-out metrics.", exc)

    coef = np.atleast_2d(classifier.coef_.astype(np.float64))
    intercept = np.atleast_1d(classifier.intercept_.astype(np.float64))
    n_epochs = int(curve[-1]["epoch"]) if curve else 0
    beliefs = _class_beliefs(coef, vocab, class_names)

    fitted = FittedTfidfStudio(
        vectorizer=vectorizer,
        classifier=classifier,
        vocab=vocab,
        idf=idf,
        weights=coef,
        bias=intercept,
        classes=class_names,
        representation=chosen_rep,
        text_prep=normalize_text_prep(text_prep),
    )
    _store_model(session_id, project_id, fitted)

    if n_classes <= 2:
        word_weights = [
            {
                "word": word,
                "weight": float(coef[0][i]),
                "label": class_names[1] if float(coef[0][i]) >= 0 else class_names[0],
            }
            for i, word in enumerate(vocab)
        ]
    else:
        winners = np.argmax(coef, axis=0)
        word_weights = [
            {
                "word": word,
                "weight": float(coef[int(winners[i]), i]),
                "label": class_names[int(winners[i])],
            }
            for i, word in enumerate(vocab)
        ]
    word_weights.sort(key=lambda item: abs(item["weight"]), reverse=True)

    test_probs = []
    binary = n_classes == 2
    for y_true, pred, proba_row in zip(test_y, test_pred, test_proba):
        test_probs.append(
            {
                "y": int(y_true),
                "p": float(proba_row[1] if binary and len(proba_row) > 1 else proba_row[int(pred)]),
                "pred": int(pred),
                "label": class_names[int(y_true)],
                "pred_label": class_names[int(pred)],
                "probs": [float(value) for value in proba_row],
            }
        )
    test_probs = _interleave_by_class(test_probs)
    matrix = confusion_matrix(test_y, test_pred, labels=list(range(n_classes))).astype(int).tolist()
    used_solver = str(getattr(classifier, "solver", chosen_solver))
    return {
        "success": True,
        "simulated": False,
        "n_train": len(train_rows),
        "n_test": len(test_rows),
        "n_features": n_features,
        "n_classes": n_classes,
        "classes": class_names,
        "class_counts": class_counts,
        "n_positive": class_counts.get(class_names[1], 0) if binary else majority,
        "n_negative": class_counts.get(class_names[0], 0) if binary else len(data) - majority,
        "baseline": baseline,
        "n_epochs": n_epochs,
        "epochs": n_epochs_requested,
        "train_accuracy": train_metrics["accuracy"],
        "test_accuracy": test_metrics["accuracy"],
        "test_precision": test_metrics["precision"],
        "test_recall": test_metrics["recall"],
        "test_f1": test_metrics["f1"],
        "cv_accuracy": cv_metrics["accuracy"],
        "solver": used_solver,
        "regularization_c": C_value,
        "max_features": features,
        "ngram_min": nmin,
        "ngram_max": nmax,
        "min_df": df_min,
        "max_iter": iters,
        "test_size": float(test_size),
        "seed": int(seed),
        "threshold": float(threshold),
        "representation": chosen_rep,
        "curve_kind": "holdout",
        "test_probs": test_probs,
        "confusion_matrix": matrix,
        "word_weights": word_weights[:WORD_WEIGHT_LIMIT],
        "class_beliefs": beliefs,
        "curve": curve,
        "model": {
            "vocab": vocab,
            "idf": [float(v) for v in idf],
            "weights": coef[0].tolist() if binary else coef.tolist(),
            "bias": float(intercept[0]) if binary else intercept.tolist(),
            "classes": class_names,
            "ngram_min": nmin,
            "ngram_max": nmax,
            "representation": chosen_rep,
        },
    }


def predict(session_id: str, project_id: str, text: str) -> Dict[str, Any]:
    fitted = _get_model(session_id, project_id)
    if not fitted:
        raise LookupError("Train the model again. This server no longer has that fit.")
    return score_with_fitted(fitted, text)


def score_with_fitted(fitted: FittedTfidfStudio, text: str) -> Dict[str, Any]:
    prep = getattr(fitted, "text_prep", None) or {}
    representation = getattr(fitted, "representation", "tfidf")
    blob = clean_note_text(text, normalize_text_prep(prep), representation) or _clean_review(text)
    if not blob:
        raise ValueError("Type a review to score.")
    tokens = tokenize(blob)
    if len(tokens) < 1:
        raise ValueError("Type a short ticket with real words.")
    matrix = fitted.vectorizer.transform([blob])
    dense = matrix.toarray()[0] if hasattr(matrix, "toarray") else np.asarray(matrix)[0]
    proba = fitted.classifier.predict_proba(matrix)[0]
    pred = int(np.argmax(proba))
    classes = fitted.classes or ["negative", "positive"]
    label = classes[pred] if pred < len(classes) else str(pred)
    coef = np.atleast_2d(fitted.weights)
    row = coef[min(pred, coef.shape[0] - 1)]
    chips: List[Dict[str, Any]] = []
    features: List[Dict[str, Any]] = []
    known = 0
    if getattr(fitted, "representation", "tfidf") == "embeddings":
        known = max(1, len(tokens))
        scored = [
            {
                "word": fitted.vocab[index] if index < len(fitted.vocab) else f"dim {index}",
                "contribution": float(row[index] * dense[index]),
                "tfidf": float(dense[index]),
            }
            for index in range(min(len(dense), len(row)))
        ]
        scored.sort(key=lambda item: abs(item["contribution"]), reverse=True)
        chips = scored[:12]
        features = sorted(scored, key=lambda item: abs(item["tfidf"]), reverse=True)[:8]
    else:
        seen: List[str] = []
        vocabulary = getattr(fitted.vectorizer, "vocabulary_", {})
        for token in tokens:
            if token not in vocabulary or token in seen:
                continue
            seen.append(token)
            index = vocabulary[token]
            tfidf = float(dense[index])
            known += 1
            chips.append(
                {
                    "word": token,
                    "contribution": float(row[index] * tfidf),
                    "tfidf": tfidf,
                }
            )
            features.append({"word": token, "contribution": 0.0, "tfidf": tfidf})
        chips.sort(key=lambda item: abs(item["contribution"]), reverse=True)
        features.sort(key=lambda item: item["tfidf"], reverse=True)
        if known == 0:
            raise ValueError("None of those words were in training. Try a real ticket from this department.")
    positive_probability = float(proba[min(1, len(proba) - 1)]) if len(classes) == 2 else float(proba[pred])
    return {
        "success": True,
        "probability": positive_probability,
        "label": label,
        "classes": classes,
        "probs": [{"label": classes[i], "p": float(p)} for i, p in enumerate(proba) if i < len(classes)],
        "known_tokens": known,
        "chips": chips[:12],
        "features": features[:8],
    }


def sample_payload() -> Dict[str, Any]:
    rows = load_dataset_from_csv(SAMPLE_CSV)
    return {"success": True, "csv": SAMPLE_CSV, "n_rows": len(rows)}

