"""Embeddings for the RAG Chatbot (Vertex AI text-embedding models).

  - Documents are embedded with task RETRIEVAL_DOCUMENT and questions with RETRIEVAL_QUERY, the
    pairing these models are trained for.
  - Vectors are L2-normalised float32, so cosine similarity is a dot product.
  - In Firestore a vector is stored as packed float32 bytes (3 KB for 768 dims), not as an array:
    Firestore would index every element of an array.
  - Shared cache (rag_embeddings/{sha1}): only for the public library documents, so every project
    that chunks a SEBI circular the same way reuses the same vectors. Learners' own uploads are never
    cached outside their project.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)

MODELS: Dict[str, Dict[str, object]] = {
    "text-embedding-005": {"name": "Text Embedding 005", "note": "English, Google's current default", "dims": 768},
    "text-multilingual-embedding-002": {"name": "Multilingual Embedding 002", "note": "100+ languages, incl. Hindi and Tamil",
                                        "dims": 768},
}
DEFAULT_MODEL = "text-embedding-005"
CACHE = "rag_embeddings"
_BATCH_ITEMS = 100
_BATCH_TOKENS = 15_000  # the API allows 20k tokens per request
_LOCATION = "us-central1"

_MODELS: Dict[str, object] = {}
_LOCK = threading.Lock()
_INIT = False


def _model(name: str):
    global _INIT
    if name not in MODELS:
        raise ValueError("Unknown embedding model.")
    with _LOCK:
        if name in _MODELS:
            return _MODELS[name]
        import vertexai
        from vertexai.language_models import TextEmbeddingModel

        from ..config import gcp_clients

        if not _INIT:
            vertexai.init(project=gcp_clients.project_id, location=_LOCATION)
            _INIT = True
        _MODELS[name] = TextEmbeddingModel.from_pretrained(name)
        return _MODELS[name]


def _est_tokens(text: str) -> int:
    return max(1, int(len(text.split()) * 1.4))


def _normalise(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return (m / n).astype(np.float32)


def embed(texts: Sequence[str], model: str = DEFAULT_MODEL, task: str = "RETRIEVAL_DOCUMENT") -> np.ndarray:
    """(len(texts), dims) normalised float32 matrix."""
    from vertexai.language_models import TextEmbeddingInput

    if not texts:
        return np.zeros((0, int(MODELS[model]["dims"])), dtype=np.float32)
    m = _model(model)
    out: List[List[float]] = []
    batch: List[str] = []
    budget = 0

    def flush():
        nonlocal batch, budget
        if batch:
            res = m.get_embeddings([TextEmbeddingInput(t, task) for t in batch])
            out.extend(r.values for r in res)
            batch, budget = [], 0

    for t in texts:
        tok = _est_tokens(t)
        if batch and (len(batch) >= _BATCH_ITEMS or budget + tok > _BATCH_TOKENS):
            flush()
        batch.append(t)
        budget += tok
    flush()
    return _normalise(np.asarray(out, dtype=np.float32))


def embed_query(text: str, model: str = DEFAULT_MODEL) -> np.ndarray:
    return embed([text], model, "RETRIEVAL_QUERY")[0]


def pack(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype="<f4").tobytes()


def unpack(raw: bytes) -> np.ndarray:
    return np.frombuffer(raw, dtype="<f4")


def _key(model: str, task: str, text: str) -> str:
    return hashlib.sha1(f"{model}|{task}|{text}".encode("utf-8")).hexdigest()


def embed_with_cache(db, texts: Sequence[str], model: str, use_cache: bool) -> Dict[str, object]:
    """Embed document chunks; with use_cache, read and fill the shared cache. Returns the matrix and counts."""
    task = "RETRIEVAL_DOCUMENT"
    if not use_cache:
        return {"matrix": embed(texts, model, task), "cached": 0, "new": len(texts)}
    keys = [_key(model, task, t) for t in texts]
    found: Dict[str, np.ndarray] = {}
    refs = [db.collection(CACHE).document(k) for k in dict.fromkeys(keys)]
    for i in range(0, len(refs), 300):
        for snap in db.get_all(refs[i:i + 300]):
            if snap.exists:
                found[snap.id] = unpack(snap.to_dict()["vector"])
    missing = [i for i, k in enumerate(keys) if k not in found]
    if missing:
        fresh = embed([texts[i] for i in missing], model, task)
        batch, n = db.batch(), 0
        now = datetime.now(timezone.utc)
        for row, i in zip(fresh, missing):
            if keys[i] in found:
                continue
            found[keys[i]] = row
            batch.set(db.collection(CACHE).document(keys[i]),
                      {"model": model, "task": task, "dims": int(row.shape[0]), "vector": pack(row), "createdAt": now})
            n += 1
            if n % 400 == 0:
                batch.commit()
                batch = db.batch()
        batch.commit()
    matrix = np.vstack([found[k] for k in keys]) if keys else np.zeros((0, 768), dtype=np.float32)
    return {"matrix": matrix.astype(np.float32), "cached": len(texts) - len(missing), "new": len(missing)}
