"""Knowledge base for Day 2 staged agents (RAG Chatbot, kept in AI Agent).

Documents are cut into passages (one per numbered paragraph, with the heading above it as context), each passage
is embedded once, and a question finds the closest passages by meaning (dot product of normalised vectors).
The chunking and embedding are the RAG Chatbot lab's (rag_text, rag_embeddings); this store belongs to an agent.

Firestore
  agent_kb/{agent_id}                 {documents: [{doc_id, source, library_id?, title, short, pages, chunks, words,
                                        added_at, gcs_path?}], updated_at}
  agent_kb/{agent_id}/chunks/{id}     {doc_id, doc_title, label, context, text, pages, page_label, words, order,
                                        embedding (packed float32)}
GCS
  agents/{agent_id}/kb/{doc_id}.pdf   uploaded PDFs, so the viewer works later (library PDFs ship with the code)

Legacy agents keep the old knowledge base (knowledge_service, collection "knowledge").
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from ..config import gcp_clients
from . import rag_embeddings as emb
from . import rag_text

logger = logging.getLogger(__name__)

KB, CHUNKS = "agent_kb", "chunks"
LIBRARY_DIR = Path(__file__).resolve().parents[1] / "data" / "rag_chatbot" / "library"
MAX_DOCUMENTS = 5
MAX_CHUNKS = 1500
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PAGES = 80
CHUNK_MODE, CHUNK_SIZE, CHUNK_OVERLAP = "sections", 60, 10
EMBEDDING_MODEL = emb.DEFAULT_MODEL
CACHE_SIZE = 16


class KbError(ValueError):
    """A request the participant can fix (400)."""


class KbNotFound(LookupError):
    pass


class KbModelError(RuntimeError):
    """The embedding service didn't answer (502)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── pure helpers (tested offline) ──────────────────────────────


def chunk_rows(doc_id: str, doc_title: str, pages: Sequence[str]) -> List[Dict[str, Any]]:
    """A document's passages, ready to embed and store (no vectors)."""
    rows = []
    for i, c in enumerate(rag_text.make_chunks(pages, CHUNK_MODE, CHUNK_SIZE, CHUNK_OVERLAP)):
        rows.append({"doc_id": doc_id, "doc_title": doc_title, "label": c.label(), "context": c.context, "text": c.text,
                     "pages": list(c.pages), "page_label": c.page_label(), "words": c.words, "order": i})
    return rows


def embed_text(row: Dict[str, Any]) -> str:
    """What is embedded for a passage: where it came from, then the text (as the RAG Chatbot lab does), so a
    paragraph about "the DRS" is still found by "disaster recovery site" via the heading above it."""
    head = f"{row['doc_title']} · para {row['label']}"
    if row.get("context"):
        head += f" · {row['context']}"
    return f"{head}\n{row['text']}"


def passage_header(h: Dict[str, Any]) -> str:
    ctx = f" · {h['context']}" if h.get("context") else ""
    return f"({h['doc_title']}, para {h['label']}, {h['page_label']}{ctx})"


def format_passages(hits: Sequence[Dict[str, Any]]) -> str:
    """Numbered passages for the model: [n] (doc, para, page · heading) then the text. Uses each hit's n."""
    return "\n\n".join(f"[{h['n']}] {passage_header(h)}\n{h['text']}" for h in hits)


def top_hits(matrix: np.ndarray, rows: Sequence[Dict[str, Any]], qvec: np.ndarray, k: int,
             doc_title: Optional[str] = None) -> List[Dict[str, Any]]:
    """The k best passages by dot product (vectors are normalised), optionally from one document only."""
    if not len(rows):
        return []
    scores = matrix @ qvec
    order = np.argsort(-scores)
    out = []
    for i in order:
        r = rows[int(i)]
        if doc_title and r["doc_title"] != doc_title:
            continue
        out.append({"n": len(out) + 1, "doc_id": r["doc_id"], "doc_title": r["doc_title"], "label": r["label"],
                    "page_label": r["page_label"], "pages": list(r["pages"]), "context": r.get("context") or "",
                    "text": r["text"], "score": round(float(scores[int(i)]), 4)})
        if len(out) >= max(1, int(k)):
            break
    return out


# ── in-memory index cache: {agent_id: (matrix, rows)} ─────────

_CACHE: "OrderedDict[str, Tuple[np.ndarray, List[Dict[str, Any]]]]" = OrderedDict()
_CACHE_LOCK = threading.Lock()


def _cache_get(agent_id: str):
    with _CACHE_LOCK:
        hit = _CACHE.get(agent_id)
        if hit is not None:
            _CACHE.move_to_end(agent_id)
        return hit


def _cache_put(agent_id: str, value) -> None:
    with _CACHE_LOCK:
        _CACHE[agent_id] = value
        _CACHE.move_to_end(agent_id)
        while len(_CACHE) > CACHE_SIZE:
            _CACHE.popitem(last=False)


def invalidate(agent_id: str) -> None:
    with _CACHE_LOCK:
        _CACHE.pop(agent_id, None)


# ── service ────────────────────────────────────────────────────


class AgentKbService:
    def __init__(self, embed_query: Optional[Callable[[str], np.ndarray]] = None):
        self._embed_query = embed_query or (lambda q: emb.embed_query(q, EMBEDDING_MODEL))

    def _db(self):
        return gcp_clients.get_firestore_client()

    def _ref(self, agent_id: str):
        return self._db().collection(KB).document(agent_id)

    # ── library ──

    def library(self) -> List[Dict[str, Any]]:
        from .rag_chatbot_service import RagChatbotService

        out = []
        for d in RagChatbotService().library():
            out.append({k: d.get(k) for k in ("id", "title", "short", "issuer", "reference", "date", "summary", "pages")}
                       | {"pdf_url": f"/api/rag-chatbot/library/{d['id']}/pdf"})
        return out

    def _library_doc(self, library_id: str) -> Dict[str, Any]:
        from .rag_chatbot_service import RagChatbotService, RagNotFound

        try:
            return RagChatbotService()._library_doc(library_id)
        except RagNotFound:
            raise KbNotFound("That library document doesn't exist.")

    # ── documents ──

    def documents(self, agent_id: str) -> List[Dict[str, Any]]:
        snap = self._ref(agent_id).get()
        return list((snap.to_dict() or {}).get("documents") or []) if snap.exists else []

    def _store(self, agent_id: str, doc: Dict[str, Any], rows: List[Dict[str, Any]], use_cache: bool) -> None:
        """Embed a document's passages and save them, then add the document to the list."""
        existing = self.documents(agent_id)
        if len(existing) >= MAX_DOCUMENTS:
            raise KbError(f"A knowledge base holds at most {MAX_DOCUMENTS} documents. Remove one first.")
        if not rows:
            raise KbError("That document produced no passages.")
        total = sum(int(d.get("chunks") or 0) for d in existing) + len(rows)
        if total > MAX_CHUNKS:
            raise KbError(f"That makes {total:,} passages; the limit is {MAX_CHUNKS:,}.")
        db = self._db()
        try:
            res = emb.embed_with_cache(db, [embed_text(r) for r in rows], EMBEDDING_MODEL, use_cache=use_cache)
        except Exception as e:
            logger.warning("Agent KB embedding failed: %s", e)
            raise KbModelError(f"The embedding service didn't answer ({type(e).__name__}). Try again.")
        ref = self._ref(agent_id)
        batch, n = db.batch(), 0
        for r, vec in zip(rows, res["matrix"]):
            batch.set(ref.collection(CHUNKS).document(f"{doc['doc_id']}_{r['order']:04d}"), {**r, "embedding": emb.pack(vec)})
            n += 1
            if n % 300 == 0:
                batch.commit()
                batch = db.batch()
        batch.commit()
        doc = {**doc, "chunks": len(rows), "words": sum(r["words"] for r in rows), "added_at": _now()}
        ref.set({"documents": existing + [doc], "updated_at": _now()})
        invalidate(agent_id)
        logger.info("Agent KB %s: added %s (%s passages, %s embedded, %s from cache)", agent_id, doc["doc_id"], len(rows),
                    res["new"], res["cached"])

    def add_library(self, agent_id: str, library_ids: Sequence[str]) -> List[Dict[str, Any]]:
        have = {d.get("library_id") for d in self.documents(agent_id)}
        for lib_id in dict.fromkeys(library_ids or []):
            if lib_id in have:
                continue
            lib = self._library_doc(lib_id)
            pages = [p["text"] for p in sorted(lib["pages"], key=lambda p: p["page"])]
            doc_id = lib_id
            rows = chunk_rows(doc_id, lib["short"], pages)
            self._store(agent_id, {"doc_id": doc_id, "source": "library", "library_id": lib_id, "title": lib["title"],
                                   "short": lib["short"], "pages": len(pages)}, rows, use_cache=True)
        return self.documents(agent_id)

    def upload(self, agent_id: str, filename: str, data: bytes) -> List[Dict[str, Any]]:
        if len(data) > MAX_UPLOAD_BYTES:
            raise KbError("That PDF is over 10 MB.")
        if not data.startswith(b"%PDF"):
            raise KbError("Upload a PDF file.")
        try:
            pages = rag_text.extract_pdf(data)
        except rag_text.TextError as e:
            msg = str(e)
            if "No text" in msg:
                msg = "This PDF has no text layer. Use a text PDF."
            raise KbError(msg)
        if len(pages) > MAX_PAGES:
            raise KbError(f"That PDF has {len(pages)} pages; the limit is {MAX_PAGES}.")
        title = (Path(filename or "document.pdf").stem or "Document").replace("_", " ").strip()[:120]
        doc_id = f"up-{uuid.uuid4().hex[:8]}"
        gcs_path = f"agents/{agent_id}/kb/{doc_id}.pdf"
        rows = chunk_rows(doc_id, title[:60], pages)
        gcp_clients.get_bucket().blob(gcs_path).upload_from_string(data, content_type="application/pdf")
        try:
            self._store(agent_id, {"doc_id": doc_id, "source": "upload", "title": title, "short": title[:60],
                                   "pages": len(pages), "gcs_path": gcs_path}, rows, use_cache=False)
        except Exception:
            gcp_clients.get_bucket().blob(gcs_path).delete()
            raise
        return self.documents(agent_id)

    def _doc(self, agent_id: str, doc_id: str) -> Dict[str, Any]:
        for d in self.documents(agent_id):
            if d["doc_id"] == doc_id:
                return d
        raise KbNotFound("That document isn't in this knowledge base.")

    def pdf(self, agent_id: str, doc_id: str) -> Tuple[Optional[Path], Optional[bytes]]:
        """(path, None) for a library document, (None, bytes) for an upload."""
        d = self._doc(agent_id, doc_id)
        if d["source"] == "library":
            path = LIBRARY_DIR / f"{d['library_id']}.pdf"
            if not path.is_file():
                raise KbNotFound("No PDF for that document.")
            return path, None
        blob = gcp_clients.get_bucket().blob(d["gcs_path"])
        if not blob.exists():
            raise KbNotFound("No PDF for that document.")
        return None, blob.download_as_bytes()

    def chunks(self, agent_id: str, doc_id: str, offset: int, limit: int) -> Dict[str, Any]:
        self._doc(agent_id, doc_id)
        _, rows = self._index(agent_id)
        mine = [r for r in rows if r["doc_id"] == doc_id]
        page = [{k: r[k] for k in ("label", "page_label", "pages", "context", "text", "words")} for r in mine[offset:offset + limit]]
        return {"total": len(mine), "offset": offset, "chunks": page}

    def delete(self, agent_id: str, doc_id: str) -> List[Dict[str, Any]]:
        d = self._doc(agent_id, doc_id)
        ref = self._ref(agent_id)
        db = self._db()
        refs = [c.reference for c in ref.collection(CHUNKS).where("doc_id", "==", doc_id).stream()]
        for i in range(0, len(refs), 400):
            batch = db.batch()
            for r in refs[i:i + 400]:
                batch.delete(r)
            batch.commit()
        if d.get("gcs_path"):
            try:
                gcp_clients.get_bucket().blob(d["gcs_path"]).delete()
            except Exception as e:
                logger.warning("Could not delete %s: %s", d["gcs_path"], e)
        docs = [x for x in self.documents(agent_id) if x["doc_id"] != doc_id]
        ref.set({"documents": docs, "updated_at": _now()})
        invalidate(agent_id)
        return docs

    # ── retrieval ──

    def _index(self, agent_id: str) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
        hit = _cache_get(agent_id)
        if hit is not None:
            return hit
        order = {d["doc_id"]: i for i, d in enumerate(self.documents(agent_id))}
        rows, vecs = [], []
        for c in self._ref(agent_id).collection(CHUNKS).stream():
            data = c.to_dict()
            if data.get("doc_id") not in order:
                continue
            vecs.append(emb.unpack(data.pop("embedding")))
            rows.append(data)
        idx = sorted(range(len(rows)), key=lambda i: (order[rows[i]["doc_id"]], rows[i].get("order", 0)))
        rows = [rows[i] for i in idx]
        matrix = np.vstack([vecs[i] for i in idx]).astype(np.float32) if rows else np.zeros((0, 768), dtype=np.float32)
        _cache_put(agent_id, (matrix, rows))
        return matrix, rows

    def is_empty(self, agent_id: str) -> bool:
        return not self.documents(agent_id)

    def search(self, agent_id: str, query: str, k: int = 4, doc_title: Optional[str] = None) -> List[Dict[str, Any]]:
        matrix, rows = self._index(agent_id)
        if not rows:
            return []
        try:
            q = self._embed_query(query)
        except Exception as e:
            raise KbModelError(f"The embedding service didn't answer ({type(e).__name__}). Try again.")
        return top_hits(matrix, rows, q, k, doc_title)
