"""DistilBERT for Confusion Matrix projects (Exercise 3).

distilbert-base-uncased reads each text (cut to `maxLen` tokens) and gives one 768-number summary
(mean of its token vectors). A logistic classifier is then trained on those summaries with the
learner's settings: training rounds, learning rate and batch size (Adam, small weight decay), the
same recipe as the original Ex 3 design. The language model itself is not changed.

Reading is the slow part, so summaries are cached: in memory, then in the bucket
(cm_features/...), computed once per dataset version and text length. Training the classifier
on them takes well under a second.
"""

from __future__ import annotations

import io
import logging
import threading
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

ENCODER_ID = "distilbert-base-uncased"
HEAD_SEED = 11
WEIGHT_DECAY = 1e-2
MAX_ITEMS = 5000  # larger datasets would take too long to read on the server
_BATCH = 64

_ENCODER: Optional[Tuple[Any, Any]] = None
_ENCODER_LOCK = threading.Lock()
_FEATS: "OrderedDict[Tuple, np.ndarray]" = OrderedDict()
_FEATS_LOCK = threading.Lock()
_FEATS_SIZE = 8
_KEY_LOCKS: Dict[Tuple, threading.Lock] = {}


def _encoder():
    global _ENCODER
    with _ENCODER_LOCK:
        if _ENCODER is None:
            from transformers import AutoModel, AutoTokenizer

            tokenizer = AutoTokenizer.from_pretrained(ENCODER_ID)
            model = AutoModel.from_pretrained(ENCODER_ID).eval()
            _ENCODER = (tokenizer, model)
            logger.info("DistilBERT encoder loaded for Exercise 3")
        return _ENCODER


def embed(texts: List[str], max_len: int) -> np.ndarray:
    """Mean-pooled DistilBERT summaries, one row per text (float32, n x 768)."""
    import torch

    tokenizer, model = _encoder()
    rows = []
    with torch.no_grad():
        for i in range(0, len(texts), _BATCH):
            enc = tokenizer(texts[i:i + _BATCH], padding=True, truncation=True, max_length=max_len, return_tensors="pt")
            hidden = model(**enc).last_hidden_state
            mask = enc["attention_mask"].unsqueeze(-1).float()
            rows.append(((hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)).numpy().astype(np.float32))
    return np.vstack(rows) if rows else np.zeros((0, 768), np.float32)


def _blob_path(key: str, version: str, max_len: int) -> str:
    safe = key.replace(":", "_").replace("/", "_")
    return f"cm_features/{safe}/{version}/{max_len}.npy"


def _bucket():
    try:
        from ..config import gcp_clients

        return gcp_clients.get_bucket()
    except Exception as e:  # no bucket (tests, offline): memory cache only
        logger.debug("No bucket for DistilBERT features: %s", e)
        return None


def features(key: str, version: str, texts: List[str], max_len: int) -> Tuple[np.ndarray, bool]:
    """(summaries, was_cached). Memory, then bucket, then computed and stored."""
    ck = (key, version, max_len)
    with _FEATS_LOCK:
        if ck in _FEATS:
            _FEATS.move_to_end(ck)
            return _FEATS[ck], True
        lock = _KEY_LOCKS.setdefault(ck, threading.Lock())
    with lock:  # one reader per dataset + length; others wait for it
        with _FEATS_LOCK:
            if ck in _FEATS:
                return _FEATS[ck], True
        feats, cached = None, False
        bucket = _bucket()
        blob = bucket.blob(_blob_path(key, version, max_len)) if bucket else None
        try:
            if blob is not None and blob.exists():
                arr = np.load(io.BytesIO(blob.download_as_bytes()), allow_pickle=False).astype(np.float32)
                if arr.shape[0] == len(texts):
                    feats, cached = arr, True
        except Exception as e:
            logger.warning("Could not read cached DistilBERT features %s: %s", ck, e)
        if feats is None:
            # Kept at the stored precision, so a fresh read and a read from the bucket train identically
            feats = embed(texts, max_len).astype(np.float16).astype(np.float32)
            if blob is not None:
                try:
                    buf = io.BytesIO()
                    np.save(buf, feats.astype(np.float16), allow_pickle=False)
                    blob.upload_from_string(buf.getvalue(), content_type="application/octet-stream")
                except Exception as e:
                    logger.warning("Could not store DistilBERT features %s: %s", ck, e)
        with _FEATS_LOCK:
            _FEATS[ck] = feats
            while len(_FEATS) > _FEATS_SIZE:
                _FEATS.popitem(last=False)
        return feats, cached


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -35, 35)))


def train_head(feats: np.ndarray, y_target: np.ndarray, train_idx: List[int], test_idx: List[int],
               epochs: int, lr: float, batch: int) -> Tuple[np.ndarray, Dict[str, Any]]:
    """Logistic classifier on standardised summaries, trained with Adam in mini-batches.
    y_target: 1 = class we care about. Returns (test scores, head)."""
    x_train = feats[train_idx].astype(np.float64)
    mean = x_train.mean(0)
    sd = x_train.std(0)
    sd[sd == 0] = 1.0
    x = (x_train - mean) / sd
    y = y_target[train_idx].astype(np.float64)
    n, dim = x.shape
    w, b = np.zeros(dim), 0.0
    m_w, v_w, m_b, v_b, t = np.zeros(dim), np.zeros(dim), 0.0, 0.0, 0
    b1, b2 = 0.9, 0.999
    rng = np.random.RandomState(HEAD_SEED)
    for _ in range(int(epochs)):
        order = rng.permutation(n)
        for s in range(0, n, int(batch)):
            idx = order[s:s + int(batch)]
            err = _sigmoid(x[idx] @ w + b) - y[idx]
            g_w = x[idx].T @ err / len(idx) + WEIGHT_DECAY * w
            g_b = err.mean()
            t += 1
            c1, c2 = 1 - b1 ** t, 1 - b2 ** t
            m_w = b1 * m_w + (1 - b1) * g_w
            v_w = b2 * v_w + (1 - b2) * g_w * g_w
            w -= lr * (m_w / c1) / (np.sqrt(v_w / c2) + 1e-8)
            m_b = b1 * m_b + (1 - b1) * g_b
            v_b = b2 * v_b + (1 - b2) * g_b * g_b
            b -= lr * (m_b / c1) / (np.sqrt(v_b / c2) + 1e-8)
    x_test = (feats[test_idx].astype(np.float64) - mean) / sd
    scores = _sigmoid(x_test @ w + b)
    head = {"w": w.astype(np.float32), "b": float(b), "mean": mean.astype(np.float32), "sd": sd.astype(np.float32)}
    return scores, head
