"""RAG Chatbot projects: answer questions from documents, show the passages used, catch made-up answers.

Steps (one project):
  1 Documents  the library (official SEBI circulars) and/or the learner's own PDF, TXT or MD files
  2 Chunks     sections (numbered paragraphs) or fixed word windows → a searchable index
  3 Search     keyword (TF-IDF) or meaning (embeddings) retrieval, top-k, minimum score
  4 Ask        the passages found go to Gemini with the question; the answer cites them as [n]
  5 Test       a built-in question set (facts and traps), checked automatically

No answer is ever simulated: if Gemini fails, the request fails and says so.

Firestore
  rag_library/{docId}                         public library document: title, issuer, reference, source URL, version
  rag_library/{docId}/pages/{0001}            its text, page by page
  rag_embeddings/{sha1}                       shared vectors for library chunks only (model, task, float32 bytes)
  rag_projects/{pid}                          state: step, chunking, embedding model, retrieval and answer settings,
                                              current index; counts
  rag_projects/{pid}/documents/{docId}        a document in the project: from the library (reference) or uploaded
  rag_projects/{pid}/documents/{docId}/pages/{0001}   an uploaded document's text, page by page
  rag_projects/{pid}/indexes/{indexId}        an index: which documents and versions, chunking, embedding model, counts
  rag_projects/{pid}/indexes/{indexId}/chunks/{0001}  a chunk: text, document, pages, paragraph numbers, context,
                                              word count, embedding (float32 bytes)
  rag_projects/{pid}/asks/{askId}             a question: settings used, passages retrieved (with scores), prompt sent,
                                              answer, citations, automatic check, learner's verdict, tokens, cost, time
  rag_projects/{pid}/evals/{evalId}           a run of the test set: settings, per-question result, summary
indexId = hash of (documents + versions, chunking, embedding model), so the same choices reuse the same index.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from google.cloud import firestore

from ..config import gcp_clients
from . import rag_embeddings as emb
from . import rag_text
from .exercises_vertex_models import (
    catalog_models,
    normalize_family_id,
    resolve_vertex_model,
    thinking_config,
    vertex_chat_service,
    vertex_max_output_tokens,
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "rag_chatbot"
LIBRARY = "rag_library"
PROJECTS = "rag_projects"
DOCS, PAGES, INDEXES, CHUNKS, ASKS, EVALS = "documents", "pages", "indexes", "chunks", "asks", "evals"
SCHEMA_VERSION = 1
MAX_DOCUMENTS = 5
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_CHUNKS = 1500
KEEP_INDEXES = 5
ANSWER_CAP = 500  # visible output tokens
INR_PER_USD = 88.0

DEFAULT_STATE = {
    "step": 1,
    "chunking": {"mode": "sections", "size": 60, "overlap": 10},
    "embeddingModel": emb.DEFAULT_MODEL,
    "retrieval": {"method": "meaning", "k": 3, "minScore": 0.0},
    "answer": {"model": "gemini-flash-lite", "temperature": 0.2, "strict": True, "useDocuments": True},
    "indexId": None,
}

STRICT_SYS = (
    "You answer questions using only the numbered passages you are given from the user's documents, like [2].\n"
    "Cite every passage you use with its number in square brackets, right after the sentence it supports.\n"
    "If the passages do not contain the answer, reply: \"The documents don't cover this.\" Then stop.\n"
    "Do not guess and do not use outside knowledge. Keep the answer short and exact; quote numbers and dates as written."
)
LOOSE_SYS = (
    "You answer questions. You are given numbered passages from the user's documents, like [2]. Use them when "
    "they help and cite them with their numbers in square brackets. You may also use your general knowledge."
)
NODOC_SYS = "You answer questions."


class RagError(ValueError):
    """A request the learner can fix (400)."""


class RagNotFound(LookupError):
    pass


class RagBusy(RuntimeError):
    pass


class RagModelError(RuntimeError):
    """The model or embedding service didn't answer (502). Nothing is made up instead."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _page_id(n: int) -> str:
    return f"{n:04d}"


# ── library (files in the repo → Firestore) ───────────────────


def _library_files() -> List[Dict[str, Any]]:
    out = []
    for path in sorted((DATA_DIR / "library").glob("*.json")):
        out.append(json.loads(path.read_text(encoding="utf-8")))
    return out


_LIB: Dict[str, Dict[str, Any]] = {}
_LIB_LOCK = threading.Lock()
LIB_META = ("id", "title", "short", "issuer", "reference", "date", "effective", "sourceUrl", "pdfUrl", "licence",
            "summary", "recommended", "fileName", "words", "version")


def test_questions() -> List[Dict[str, Any]]:
    return json.loads((DATA_DIR / "test_questions.json").read_text(encoding="utf-8"))


# ── Gemini (no simulated fallback) ────────────────────────────


def generate(system: str, user: str, model: str, temperature: float, cap: int = ANSWER_CAP) -> Dict[str, Any]:
    from google.genai import types

    from .exercises_compare_service import _extract_text, _finish_reason, _model_meta, cost_of

    family = normalize_family_id(model)
    vertex_model = resolve_vertex_model(model)
    meta = _model_meta(family)
    temp = max(0.0, min(float(meta.get("tempMax") or 1.0), float(temperature)))
    cfg: Dict[str, Any] = {"temperature": temp, "max_output_tokens": vertex_max_output_tokens(vertex_model, cap),
                           "system_instruction": system}
    tc = thinking_config(types)
    if tc is not None:
        cfg["thinking_config"] = tc
    t0 = time.perf_counter()
    try:
        response = vertex_chat_service().client.models.generate_content(
            model=vertex_model,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=user)])],
            config=types.GenerateContentConfig(**cfg),
        )
    except Exception as e:
        logger.warning("RAG generate failed (%s): %s", vertex_model, e)
        raise RagModelError(f"{meta.get('name') or vertex_model} didn't answer ({type(e).__name__}). Nothing was made up: try again.")
    text = _extract_text(response)
    if not text:
        raise RagModelError(f"{meta.get('name') or vertex_model} returned an empty answer. Try again.")
    usage = getattr(response, "usage_metadata", None)
    tin = int(getattr(usage, "prompt_token_count", 0) or 0)
    tout = int(getattr(usage, "candidates_token_count", 0) or 0)
    return {
        "text": text.strip(), "model": {"id": family, "vertex": vertex_model, "name": meta.get("name") or vertex_model},
        "tokens": {"in": tin, "out": tout}, "costUsd": round(cost_of(tin, tout, family), 6),
        "ms": int((time.perf_counter() - t0) * 1000), "finish": _finish_reason(response), "temperature": temp,
    }


# ── in-memory index cache ─────────────────────────────────────


class LoadedIndex:
    def __init__(self, meta: Dict[str, Any], chunks: List[Dict[str, Any]], matrix: np.ndarray):
        self.meta = meta
        self.chunks = chunks  # without embeddings
        self.matrix = matrix
        self.keyword = rag_text.KeywordIndex([c["text"] for c in chunks])


_INDEX_CACHE: "OrderedDict[str, LoadedIndex]" = OrderedDict()
_INDEX_CACHE_SIZE = 12
_CACHE_LOCK = threading.Lock()
_BUILDING: set = set()
_BUILD_LOCK = threading.Lock()


def _cache_get(key: str) -> Optional[LoadedIndex]:
    with _CACHE_LOCK:
        if key in _INDEX_CACHE:
            _INDEX_CACHE.move_to_end(key)
            return _INDEX_CACHE[key]
    return None


def _cache_put(key: str, idx: LoadedIndex) -> None:
    with _CACHE_LOCK:
        _INDEX_CACHE[key] = idx
        _INDEX_CACHE.move_to_end(key)
        while len(_INDEX_CACHE) > _INDEX_CACHE_SIZE:
            _INDEX_CACHE.popitem(last=False)


def _cache_drop_project(project_id: str) -> None:
    with _CACHE_LOCK:
        for k in [k for k in _INDEX_CACHE if k.startswith(f"{project_id}/")]:
            _INDEX_CACHE.pop(k, None)


def _norm_chunking(c: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    c = {**DEFAULT_STATE["chunking"], **(c or {})}
    mode = c["mode"] if c["mode"] in ("sections", "words") else "sections"
    size = max(rag_text.WORD_LIMITS[0], min(rag_text.WORD_LIMITS[1], int(c["size"])))
    overlap = max(0, min(size // 2, int(c["overlap"])))
    return {"mode": mode, "size": size, "overlap": overlap}


class RagChatbotService:
    def _db(self):
        return gcp_clients.get_firestore_client()

    def _ref(self, project_id: str):
        return self._db().collection(PROJECTS).document(project_id)

    def _mark_guest_trained(self, project_id: str) -> None:
        try:
            ref = self._db().collection("projects").document(project_id)
            if ref.get().exists:
                ref.update({"status": "trained", "model.trainedAt": _now(), "updatedAt": _now()})
        except Exception as e:
            logger.warning("Could not mark RAG project %s as ready: %s", project_id, e)

    # ── library ──

    def library(self) -> List[Dict[str, Any]]:
        """The library, written to Firestore on first use and again whenever a file's version changes."""
        db = self._db()
        out = []
        for doc in _library_files():
            with _LIB_LOCK:
                seeded = _LIB.get(doc["id"], {}).get("version") == doc["version"]
            if not seeded:
                ref = db.collection(LIBRARY).document(doc["id"])
                snap = ref.get()
                if not snap.exists or snap.to_dict().get("version") != doc["version"]:
                    batch = db.batch()
                    for old in ref.collection(PAGES).list_documents():
                        batch.delete(old)
                    for p in doc["pages"]:
                        batch.set(ref.collection(PAGES).document(_page_id(p["page"])),
                                  {"page": p["page"], "text": p["text"], "words": len(p["text"].split())})
                    batch.set(ref, {**{k: doc.get(k) for k in LIB_META}, "pages": len(doc["pages"]), "seededAt": _now()})
                    batch.commit()
                    logger.info("RAG library: wrote %s (version %s)", doc["id"], doc["version"])
            with _LIB_LOCK:
                _LIB[doc["id"]] = doc
            out.append({**{k: doc.get(k) for k in LIB_META}, "pages": len(doc["pages"])})
        return out

    def _library_doc(self, lib_id: str) -> Dict[str, Any]:
        with _LIB_LOCK:
            if lib_id in _LIB:
                return _LIB[lib_id]
        self.library()
        with _LIB_LOCK:
            if lib_id not in _LIB:
                raise RagNotFound("That library document doesn't exist.")
            return _LIB[lib_id]

    # ── project doc ──

    def _doc(self, project_id: str, session_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).get()
        data = snap.to_dict() if snap.exists else None
        if not data or data.get("version") != SCHEMA_VERSION:
            return {"project_id": project_id, "session_id": session_id, "version": SCHEMA_VERSION,
                    "state": json.loads(json.dumps(DEFAULT_STATE)), "createdAt": _now(), "updatedAt": _now()}
        return data

    def _write(self, doc: Dict[str, Any]) -> None:
        doc["updatedAt"] = _now()
        doc["version"] = SCHEMA_VERSION
        self._ref(doc["project_id"]).set(doc)

    def _documents(self, project_id: str) -> List[Dict[str, Any]]:
        return sorted((d.to_dict() for d in self._ref(project_id).collection(DOCS).stream()), key=lambda d: d["addedAt"])

    def _indexes(self, project_id: str) -> List[Dict[str, Any]]:
        return sorted((d.to_dict() for d in self._ref(project_id).collection(INDEXES).stream()),
                      key=lambda d: d.get("lastUsedAt") or d["builtAt"])

    @staticmethod
    def _index_id(documents: List[Dict[str, Any]], chunking: Dict[str, Any], model: str) -> Optional[str]:
        if not documents:
            return None
        key = json.dumps({"docs": sorted((d["id"], d["version"]) for d in documents), "chunking": chunking, "model": model},
                         sort_keys=True)
        return hashlib.sha1(key.encode()).hexdigest()[:16]

    @staticmethod
    def _ask_summary(a: Dict[str, Any]) -> Dict[str, Any]:
        keep = ("id", "question", "testQuestionId", "evalId", "settings", "retrieved", "answer", "citations",
                "invalidCitations", "declined", "check", "verdict", "model", "tokens", "costUsd", "ms", "createdAt")
        return {k: a.get(k) for k in keep}

    def view(self, project_id: str, session_id: str, doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        doc = doc or self._doc(project_id, session_id)
        state = doc["state"]
        documents = self._documents(project_id)
        indexes = self._indexes(project_id)
        wanted = self._index_id(documents, _norm_chunking(state["chunking"]), state["embeddingModel"])
        current = next((i for i in indexes if i["id"] == state.get("indexId")), None)
        ref = self._ref(project_id)
        asks = sorted((a.to_dict() for a in ref.collection(ASKS).stream()), key=lambda a: a["createdAt"])
        evals = sorted((e.to_dict() for e in ref.collection(EVALS).stream()), key=lambda e: e["createdAt"])
        return {
            "project_id": project_id,
            "state": state,
            "documents": documents,
            "index": current,
            "indexFresh": bool(current and current["id"] == wanted),
            "wantedIndexId": wanted,
            "indexes": indexes,
            "asks": [self._ask_summary(a) for a in asks if not a.get("evalId")][-100:],
            "evals": evals,
        }

    def save_state(self, project_id: str, session_id: str, changes: Dict[str, Any]) -> Dict[str, Any]:
        ref = self._ref(project_id)

        @firestore.transactional
        def run(tx):
            snap = ref.get(transaction=tx)
            ok = snap.exists and snap.to_dict().get("version") == SCHEMA_VERSION
            doc = snap.to_dict() if ok else self._doc(project_id, session_id)
            st = doc["state"]
            if changes.get("step") is not None:
                st["step"] = int(changes["step"])
            if changes.get("chunking") is not None:
                st["chunking"] = _norm_chunking(changes["chunking"])
            if changes.get("embeddingModel") is not None:
                if changes["embeddingModel"] not in emb.MODELS:
                    raise RagError("Unknown embedding model.")
                st["embeddingModel"] = changes["embeddingModel"]
            if changes.get("retrieval") is not None:
                st["retrieval"] = {**st["retrieval"], **changes["retrieval"]}
            if changes.get("answer") is not None:
                st["answer"] = {**st["answer"], **changes["answer"]}
            doc["updatedAt"] = _now()
            doc["version"] = SCHEMA_VERSION
            tx.set(ref, doc)
            return st

        return run(self._db().transaction())

    # ── step 1: documents ──

    def add_library(self, project_id: str, session_id: str, lib_id: str) -> Dict[str, Any]:
        lib = self._library_doc(lib_id)
        doc = self._doc(project_id, session_id)
        docs = self._documents(project_id)
        if any(d["id"] == lib_id for d in docs):
            return self.view(project_id, session_id, doc)
        if len(docs) >= MAX_DOCUMENTS:
            raise RagError(f"A project holds up to {MAX_DOCUMENTS} documents. Remove one first.")
        self._ref(project_id).collection(DOCS).document(lib_id).set({
            "id": lib_id, "source": "library", "libraryId": lib_id, "title": lib["title"], "short": lib["short"],
            "issuer": lib.get("issuer"), "reference": lib.get("reference"), "date": lib.get("date"),
            "sourceUrl": lib.get("sourceUrl"), "fileName": lib.get("fileName"), "fileType": "pdf",
            "pages": len(lib["pages"]), "words": lib["words"], "version": lib["version"], "addedAt": _now(),
        })
        self._write(doc)
        return self.view(project_id, session_id, doc)

    def upload(self, project_id: str, session_id: str, filename: str, data: bytes) -> Dict[str, Any]:
        if len(data) > MAX_UPLOAD_BYTES:
            raise RagError(f"That file is {len(data) / 1e6:.1f} MB; the limit is {MAX_UPLOAD_BYTES // 1_000_000} MB.")
        name = (filename or "document").strip()[:120]
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext == "pdf":
            pages = rag_text.extract_pdf(data)
        elif ext in ("txt", "md"):
            pages = rag_text.extract_text_file(data)
        else:
            raise RagError("Upload a PDF, TXT or MD file.")
        words = rag_text.check_size(pages)
        doc = self._doc(project_id, session_id)
        docs = self._documents(project_id)
        if len(docs) >= MAX_DOCUMENTS:
            raise RagError(f"A project holds up to {MAX_DOCUMENTS} documents. Remove one first.")
        sha = hashlib.sha1(data).hexdigest()
        if any(d.get("sha1") == sha for d in docs):
            raise RagError("That file is already in this project.")
        doc_id = f"up-{uuid.uuid4().hex[:10]}"
        ref = self._ref(project_id).collection(DOCS).document(doc_id)
        batch = self._db().batch()
        for i, text in enumerate(pages, 1):
            batch.set(ref.collection(PAGES).document(_page_id(i)), {"page": i, "text": text, "words": len(text.split())})
        title = name.rsplit(".", 1)[0].replace("_", " ").strip() or "Document"
        batch.set(ref, {
            "id": doc_id, "source": "upload", "title": title, "short": title[:40], "fileName": name, "fileType": ext,
            "fileBytes": len(data), "sha1": sha, "pages": len(pages), "words": words,
            "version": hashlib.sha1("\f".join(pages).encode()).hexdigest()[:12], "addedAt": _now(),
        })
        batch.commit()
        self._write(doc)
        return self.view(project_id, session_id, doc)

    def remove_document(self, project_id: str, session_id: str, doc_id: str) -> Dict[str, Any]:
        ref = self._ref(project_id).collection(DOCS).document(doc_id)
        if not ref.get().exists:
            raise RagNotFound("That document isn't in this project.")
        for p in ref.collection(PAGES).list_documents():
            p.delete()
        ref.delete()
        doc = self._doc(project_id, session_id)
        self._write(doc)
        return self.view(project_id, session_id, doc)

    def _pages(self, project_id: str, d: Dict[str, Any]) -> List[str]:
        if d["source"] == "library":
            lib = self._library_doc(d["libraryId"])
            if lib["version"] != d["version"]:
                raise RagError(f"“{d['short']}” was updated in the library. Remove it and add it again.")
            return [p["text"] for p in lib["pages"]]
        snaps = self._ref(project_id).collection(DOCS).document(d["id"]).collection(PAGES).stream()
        return [s.to_dict()["text"] for s in sorted(snaps, key=lambda s: s.id)]

    def pages(self, project_id: str, doc_id: str) -> List[Dict[str, Any]]:
        snap = self._ref(project_id).collection(DOCS).document(doc_id).get()
        if not snap.exists:
            raise RagNotFound("That document isn't in this project.")
        return [{"page": i, "text": t} for i, t in enumerate(self._pages(project_id, snap.to_dict()), 1)]

    # ── step 2: index ──

    def preview_chunks(self, project_id: str, chunking: Dict[str, Any]) -> Dict[str, Any]:
        """What a chunking choice produces, before anything is embedded."""
        chunking = _norm_chunking(chunking)
        documents = self._documents(project_id)
        if not documents:
            raise RagError("Add a document first.")
        rows, per_doc = [], []
        for d in documents:
            chunks = rag_text.make_chunks(self._pages(project_id, d), chunking["mode"], chunking["size"], chunking["overlap"])
            per_doc.append({"id": d["id"], "short": d["short"], "chunks": len(chunks)})
            rows.extend(self._chunk_row(d, c, 0) for c in chunks)
        for i, r in enumerate(rows, 1):
            r["n"] = i
        words = [r["words"] for r in rows]
        return {"chunking": chunking, "count": len(rows), "perDocument": per_doc,
                "words": {"min": min(words), "max": max(words), "avg": round(sum(words) / len(words))},
                "chunks": rows[:400]}

    @staticmethod
    def _chunk_row(d: Dict[str, Any], c: rag_text.Chunk, n: int) -> Dict[str, Any]:
        return {"n": n, "docId": d["id"], "docTitle": d["short"], "pages": c.pages, "pageLabel": c.page_label(),
                "paras": c.paras, "label": c.label(), "context": c.context, "text": c.text, "words": c.words}

    def build_index(self, project_id: str, session_id: str) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        state = doc["state"]
        chunking = _norm_chunking(state["chunking"])
        model = state["embeddingModel"]
        documents = self._documents(project_id)
        if not documents:
            raise RagError("Add a document first.")
        index_id = self._index_id(documents, chunking, model)
        ref = self._ref(project_id).collection(INDEXES).document(index_id)
        snap = ref.get()
        if not (snap.exists and snap.to_dict().get("status") == "ready"):
            with _BUILD_LOCK:
                if project_id in _BUILDING:
                    raise RagBusy("An index is already being built for this project.")
                _BUILDING.add(project_id)
            try:
                self._build(project_id, index_id, documents, chunking, model)
            finally:
                with _BUILD_LOCK:
                    _BUILDING.discard(project_id)
        else:
            ref.update({"lastUsedAt": _now()})
        state["indexId"] = index_id
        state["step"] = max(int(state.get("step") or 1), 3)
        self._write(doc)
        self._prune(project_id, keep=index_id)
        self._mark_guest_trained(project_id)
        return self.view(project_id, session_id, doc)

    def _build(self, project_id: str, index_id: str, documents: List[Dict[str, Any]], chunking: Dict[str, Any],
               model: str) -> None:
        t0 = time.perf_counter()
        db = self._db()
        rows: List[Dict[str, Any]] = []
        groups: List[Tuple[bool, List[int]]] = []  # (library?, row positions) for embedding with/without cache
        for d in documents:
            chunks = rag_text.make_chunks(self._pages(project_id, d), chunking["mode"], chunking["size"], chunking["overlap"])
            start = len(rows)
            rows.extend(self._chunk_row(d, c, 0) for c in chunks)
            groups.append((d["source"] == "library", list(range(start, len(rows)))))
        if not rows:
            raise RagError("The documents produced no text to index.")
        if len(rows) > MAX_CHUNKS:
            raise RagError(f"That makes {len(rows):,} chunks; the limit is {MAX_CHUNKS:,}. Use bigger chunks.")
        # Each chunk is embedded with where it came from, so a paragraph about "the DRS" is still found by
        # "disaster recovery site" (the heading above it says Business Continuity Plan)
        texts = [f"{r['docTitle']} · para {r['label']} · {r['context']}\n{r['text']}" if r["context"]
                 else f"{r['docTitle']} · para {r['label']}\n{r['text']}" for r in rows]
        matrix = np.zeros((len(rows), int(emb.MODELS[model]["dims"])), dtype=np.float32)
        cached = new = 0
        try:
            for is_library, pos in groups:
                if not pos:
                    continue
                res = emb.embed_with_cache(db, [texts[i] for i in pos], model, use_cache=is_library)
                matrix[pos] = res["matrix"]
                cached += res["cached"]
                new += res["new"]
        except RagError:
            raise
        except Exception as e:
            logger.warning("RAG embedding failed: %s", e)
            raise RagModelError(f"The embedding service didn't answer ({type(e).__name__}). Try again.")

        ref = self._ref(project_id).collection(INDEXES).document(index_id)
        ref.set({"id": index_id, "status": "building", "builtAt": _now()})
        batch, n = db.batch(), 0
        for i, (r, vec) in enumerate(zip(rows, matrix), 1):
            r["n"] = i
            batch.set(ref.collection(CHUNKS).document(_page_id(i)), {**r, "embedding": emb.pack(vec)})
            n += 1
            if n % 300 == 0:
                batch.commit()
                batch = db.batch()
        batch.commit()
        words = [r["words"] for r in rows]
        meta = {
            "id": index_id, "status": "ready",
            "documents": [{"id": d["id"], "short": d["short"], "version": d["version"]} for d in documents],
            "chunking": chunking, "embeddingModel": model, "dims": int(matrix.shape[1]), "chunkCount": len(rows),
            "words": {"min": min(words), "max": max(words), "avg": round(sum(words) / len(words))},
            "embedded": {"new": new, "fromSharedCache": cached},
            "seconds": round(time.perf_counter() - t0, 2), "builtAt": _now(), "lastUsedAt": _now(),
        }
        ref.set(meta)  # 'ready' only once every chunk is written
        _cache_put(f"{project_id}/{index_id}", LoadedIndex(meta, rows, matrix))

    def _prune(self, project_id: str, keep: str) -> None:
        """Keep the newest few indexes; asks keep a copy of the passages they used, so history survives."""
        indexes = self._indexes(project_id)
        for old in indexes[: max(0, len(indexes) - KEEP_INDEXES)]:
            if old["id"] != keep:
                self._delete_index(project_id, old["id"])

    def _delete_index(self, project_id: str, index_id: str) -> None:
        ref = self._ref(project_id).collection(INDEXES).document(index_id)
        db = self._db()
        refs = list(ref.collection(CHUNKS).list_documents())
        for i in range(0, len(refs), 400):
            batch = db.batch()
            for r in refs[i:i + 400]:
                batch.delete(r)
            batch.commit()
        ref.delete()
        with _CACHE_LOCK:
            _INDEX_CACHE.pop(f"{project_id}/{index_id}", None)

    def _load_index(self, project_id: str, index_id: str) -> LoadedIndex:
        key = f"{project_id}/{index_id}"
        hit = _cache_get(key)
        if hit:
            return hit
        ref = self._ref(project_id).collection(INDEXES).document(index_id)
        snap = ref.get()
        if not snap.exists or snap.to_dict().get("status") != "ready":
            raise RagError("Build the index first (step 2).")
        rows, vecs = [], []
        for c in sorted(ref.collection(CHUNKS).stream(), key=lambda s: s.id):
            data = c.to_dict()
            vecs.append(emb.unpack(data.pop("embedding")))
            rows.append(data)
        idx = LoadedIndex(snap.to_dict(), rows, np.vstack(vecs).astype(np.float32))
        _cache_put(key, idx)
        return idx

    def chunks(self, project_id: str, index_id: str, offset: int, limit: int) -> Tuple[List[Dict[str, Any]], int]:
        idx = self._load_index(project_id, index_id)
        return idx.chunks[offset:offset + limit], len(idx.chunks)

    # ── step 3: search ──

    def _search(self, idx: LoadedIndex, question: str, method: str, k: int, min_score: float) -> Dict[str, Any]:
        if method == "keyword":
            scores, unknown = idx.keyword.scores(question)
            scores = np.asarray(scores, dtype=np.float32)
        elif method == "meaning":
            try:
                q = emb.embed_query(question, idx.meta["embeddingModel"])
            except Exception as e:
                raise RagModelError(f"The embedding service didn't answer ({type(e).__name__}). Try again.")
            scores, unknown = idx.matrix @ q, []
        else:
            raise RagError("Unknown search method.")
        order = np.argsort(-scores)
        hits, below = [], 0
        for i in order[: max(1, int(k))]:
            s = float(scores[i])
            if s < float(min_score) or (method == "keyword" and s <= 0):
                below += 1
                continue
            c = idx.chunks[int(i)]
            hit = {kk: c[kk] for kk in ("n", "docId", "docTitle", "label", "pageLabel", "context", "text", "words")}
            hit["score"] = round(s, 4)
            if method == "keyword":
                hit["matched"] = idx.keyword.matched(int(i), question)
            hits.append(hit)
        return {"method": method, "hits": hits, "belowMinScore": below, "unknownWords": unknown,
                "best": round(float(scores[order[0]]), 4) if len(order) else 0.0}

    def search(self, project_id: str, session_id: str, question: str, k: int, min_score: float) -> Dict[str, Any]:
        """Both methods side by side, so the learner sees where they agree and where they don't."""
        question = " ".join((question or "").split())
        if not question:
            raise RagError("Type a question.")
        doc = self._doc(project_id, session_id)
        if not doc["state"].get("indexId"):
            raise RagError("Build the index first (step 2).")
        idx = self._load_index(project_id, doc["state"]["indexId"])
        return {"question": question, "k": k, "minScore": min_score,
                "keyword": self._search(idx, question, "keyword", k, min_score),
                "meaning": self._search(idx, question, "meaning", k, min_score)}

    # ── step 4: ask ──

    def _settings(self, state: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
        r = {**state["retrieval"], **{k: over[k] for k in ("method", "k", "minScore") if over.get(k) is not None}}
        a = {**state["answer"], **{k: over[k] for k in ("model", "temperature", "strict", "useDocuments") if over.get(k) is not None}}
        return {"indexId": state.get("indexId"), "chunking": state["chunking"], "embeddingModel": state["embeddingModel"],
                "method": r["method"], "k": int(r["k"]), "minScore": float(r["minScore"]), "model": a["model"],
                "temperature": float(a["temperature"]), "strict": bool(a["strict"]), "useDocuments": bool(a["useDocuments"])}

    def _answer(self, project_id: str, question: str, s: Dict[str, Any], idx: Optional[LoadedIndex],
                test: Optional[Dict[str, Any]] = None, eval_id: Optional[str] = None) -> Dict[str, Any]:
        retrieved: List[Dict[str, Any]] = []
        found: Dict[str, Any] = {}
        if s["useDocuments"]:
            found = self._search(idx, question, s["method"], s["k"], s["minScore"])
            retrieved = found["hits"]
            passages = "\n\n".join(
                f"[{i}] ({h['docTitle']}, para {h['label']}, {h['pageLabel']}{' · ' + h['context'] if h['context'] else ''})\n{h['text']}"
                for i, h in enumerate(retrieved, 1)) or "(No passage matched the question.)"
            system = STRICT_SYS if s["strict"] else LOOSE_SYS
            user = f"Passages:\n\n{passages}\n\nQuestion: {question}"
        else:
            system, user = NODOC_SYS, question
        out = generate(system, user, s["model"], s["temperature"])
        cites = rag_text.citations(out["text"])
        item = {
            "id": uuid.uuid4().hex[:16], "question": question, "testQuestionId": test["id"] if test else None, "evalId": eval_id,
            "settings": s, "retrieved": [{**h, "passage": i} for i, h in enumerate(retrieved, 1)],
            "search": {"belowMinScore": found.get("belowMinScore", 0), "unknownWords": found.get("unknownWords", [])},
            "prompt": {"system": system, "user": user}, "answer": out["text"],
            "citations": [c for c in cites if 1 <= c <= len(retrieved)],
            "invalidCitations": [c for c in cites if not 1 <= c <= len(retrieved)],
            "declined": rag_text.declines(out["text"]),
            "check": rag_text.check_answer(out["text"], test["check"]) if test else None,
            "verdict": None, "model": out["model"], "tokens": out["tokens"], "costUsd": out["costUsd"],
            "costInr": round(out["costUsd"] * INR_PER_USD, 4), "ms": out["ms"], "finish": out["finish"], "createdAt": _now(),
        }
        self._ref(project_id).collection(ASKS).document(item["id"]).set(item)
        return item

    def ask(self, project_id: str, session_id: str, question: str, over: Dict[str, Any],
            test_question_id: Optional[str] = None) -> Dict[str, Any]:
        question = " ".join((question or "").split())
        if not question:
            raise RagError("Type a question.")
        doc = self._doc(project_id, session_id)
        s = self._settings(doc["state"], over)
        idx = None
        if s["useDocuments"]:
            if not s["indexId"]:
                raise RagError("Build the index first (step 2), or turn off “Use the documents”.")
            idx = self._load_index(project_id, s["indexId"])
        test = next((q for q in test_questions() if q["id"] == test_question_id), None) if test_question_id else None
        item = self._answer(project_id, question, s, idx, test)
        if int(doc["state"].get("step") or 1) < 4:
            self.save_state(project_id, session_id, {"step": 4})
        return item

    def ask_detail(self, project_id: str, ask_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).collection(ASKS).document(ask_id).get()
        if not snap.exists:
            raise RagNotFound("Question not found.")
        return snap.to_dict()

    def set_verdict(self, project_id: str, ask_id: str, verdict: Optional[str]) -> Dict[str, Any]:
        ref = self._ref(project_id).collection(ASKS).document(ask_id)
        snap = ref.get()
        if not snap.exists:
            raise RagNotFound("Question not found.")
        ref.update({"verdict": verdict})
        data = snap.to_dict()
        if data.get("evalId"):
            self._refresh_eval(project_id, data["evalId"])
        return self._ask_summary({**data, "verdict": verdict})

    def delete_ask(self, project_id: str, ask_id: str) -> None:
        ref = self._ref(project_id).collection(ASKS).document(ask_id)
        if not ref.get().exists:
            raise RagNotFound("Question not found.")
        ref.delete()

    # ── step 5: test set ──

    def run_eval(self, project_id: str, session_id: str, question_ids: Optional[List[str]], over: Dict[str, Any]) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        s = self._settings(doc["state"], over)
        idx = None
        if s["useDocuments"]:
            if not s["indexId"]:
                raise RagError("Build the index first (step 2), or turn off “Use the documents”.")
            idx = self._load_index(project_id, s["indexId"])
        qs = [q for q in test_questions() if not question_ids or q["id"] in question_ids]
        if not qs:
            raise RagError("Choose at least one question.")
        eval_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()

        def one(q):
            try:
                return q, self._answer(project_id, q["question"], s, idx, q, eval_id), None
            except RagModelError as e:
                return q, None, str(e)

        with ThreadPoolExecutor(max_workers=4) as pool:
            done = list(pool.map(one, qs))
        results = []
        for q, item, err in done:
            results.append({"questionId": q["id"], "trap": bool(q["check"].get("trap")), "askId": item["id"] if item else None,
                            "pass": bool(item and item["check"]["pass"]), "reason": item["check"]["reason"] if item else err,
                            "cited": bool(item and item["citations"]), "declined": bool(item and item["declined"]),
                            "verdict": None, "error": err})
        ev = {"id": eval_id, "settings": s, "questionIds": [q["id"] for q in qs], "results": results,
              "summary": self._summary(results), "seconds": round(time.perf_counter() - t0, 1), "createdAt": _now()}
        self._ref(project_id).collection(EVALS).document(eval_id).set(ev)
        if int(doc["state"].get("step") or 1) < 5:
            self.save_state(project_id, session_id, {"step": 5})
        return ev

    @staticmethod
    def _summary(results: List[Dict[str, Any]]) -> Dict[str, Any]:
        facts = [r for r in results if not r["trap"]]
        traps = [r for r in results if r["trap"]]
        ok = lambda r: (r["verdict"] in ("grounded", "refused")) if r.get("verdict") else r["pass"]  # learner's verdict wins
        return {
            "total": len(results), "passed": sum(1 for r in results if ok(r)),
            "facts": len(facts), "factsPassed": sum(1 for r in facts if ok(r)),
            "factsCited": sum(1 for r in facts if r["cited"]),
            "traps": len(traps), "trapsPassed": sum(1 for r in traps if ok(r)),
            "madeUp": sum(1 for r in results if r.get("verdict") == "made-up"
                          or (not r.get("verdict") and r["trap"] and not r["pass"] and not r.get("error"))),
            "errors": sum(1 for r in results if r.get("error")),
        }

    def _refresh_eval(self, project_id: str, eval_id: str) -> None:
        ref = self._ref(project_id).collection(EVALS).document(eval_id)
        snap = ref.get()
        if not snap.exists:
            return
        ev = snap.to_dict()
        asks = {a.id: a.to_dict() for a in self._ref(project_id).collection(ASKS).where("evalId", "==", eval_id).stream()}
        for r in ev["results"]:
            if r.get("askId") in asks:
                r["verdict"] = asks[r["askId"]].get("verdict")
        ev["summary"] = self._summary(ev["results"])
        ref.set(ev)

    def eval_detail(self, project_id: str, eval_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).collection(EVALS).document(eval_id).get()
        if not snap.exists:
            raise RagNotFound("Test run not found.")
        ev = snap.to_dict()
        asks = {a.id: self._ask_summary(a.to_dict())
                for a in self._ref(project_id).collection(ASKS).where("evalId", "==", eval_id).stream()}
        ev["asks"] = [asks.get(r["askId"]) for r in ev["results"]]
        return ev

    # ── delete ──

    def delete(self, project_id: str, session_id: Optional[str] = None) -> bool:
        ref = self._ref(project_id)
        db = self._db()

        def wipe(refs):
            refs = list(refs)
            for i in range(0, len(refs), 400):
                batch = db.batch()
                for r in refs[i:i + 400]:
                    batch.delete(r)
                batch.commit()

        for d in ref.collection(DOCS).list_documents():
            wipe(d.collection(PAGES).list_documents())
        wipe(ref.collection(DOCS).list_documents())
        for ix in ref.collection(INDEXES).list_documents():
            wipe(ix.collection(CHUNKS).list_documents())
        wipe(ref.collection(INDEXES).list_documents())
        wipe(ref.collection(ASKS).list_documents())
        wipe(ref.collection(EVALS).list_documents())
        existed = ref.get().exists
        if existed:
            ref.delete()
        _cache_drop_project(project_id)
        return existed


def models() -> Dict[str, Any]:
    chat = [{"id": m["id"], "name": m["name"], "pin": m["pin"], "pout": m["pout"], "hint": m.get("hint") or ""}
            for m in catalog_models()]
    return {"chat": chat, "embedding": [{"id": k, **v} for k, v in emb.MODELS.items()],
            "defaults": {"chat": DEFAULT_STATE["answer"]["model"], "embedding": emb.DEFAULT_MODEL}}
