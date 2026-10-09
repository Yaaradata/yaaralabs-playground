"""Exercise 12 — Build a RAG end-to-end: clean → chunk → embed → retrieve → prompt → generate → evaluate."""

from __future__ import annotations

import hashlib
import logging
import math
import random
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import exercises_compare_service as compare
from . import exercises_rag_service as rag
from .exercises_tfidf_service import EMBED_DIM, sentence_embed

logger = logging.getLogger(__name__)

EXAMPLE_DOC = """Campus Building Code - Class Sample - Rev 2
CAMPUS BUILDING CODE (sample written for this class, not an official IS standard)

Part 1. Scope
1.1 This code applies to new teaching blocks, hostels, laboratories and workshops
built on the campus.
1.2 Where this code is silent, the designer shall follow the relevant national standard and
record the reference in the design basis report.

Part 2. Concrete
2.1 The minimum grade of concrete for reinforced concrete work shall be M20. Where members
are exposed to severe conditions, such as coastal air or wet foundations, the minimum grade shall be M25.
2.2 The maximum water-cement ratio shall be 0.50 for moderate exposure and 0.45 for severe exposure.
2.3 Concrete shall be placed within 30 minutes of mixing when mixed on site, and within 90 minutes when supplied as ready-mixed concrete.
2.4 Concrete shall be com-
pacted with needle vibrators. Hand rodding is allowed only for small repairs.

Part 3. Nominal cover to reinforcement
3.1 Slabs: 20 mm.
3.2 Beams: 25 mm for moderate exposure and 30 mm for severe exposure.
3.3 Columns: 40 mm.
3.4 Footings and other members cast against earth: 50 mm.
3.5 Cover blocks shall be of the same strength as the surrounding concrete and shall be tied in place
before concreting.

Page 1 of 3

Campus Building Code - Class Sample - Rev 2
Part 4. Curing
4.1 Exposed concrete surfaces shall be kept continuously moist for at least 7 days when ordinary Portland cement is used.
4.2 When blended cements such as fly-ash or slag cement are used, curing shall continue for at least
10 days.
4.3 In hot weather, above 35 °C, curing shall start as soon as the surface can take it without damage, and wet hessian shall be used on slabs.

Part 5. Removal of formwork
5.1 Vertical faces of beams, columns and walls: 24 hours.
5.2 Soffits of slabs, with props left under: 3 days.
5.3 Props under slabs spanning up to 4.5 m: 7 days.
5.4 Props under beams spanning up to 6 m: 14 days.
5.5 Props under beams spanning over 6 m: 21 days.

Part 6. Staircases
6.1 The riser of a step shall not exceed 175 mm, and the tread shall be at least 250 mm.
6.2 The clear width of a staircase shall be at least 1.0 m in residential blocks and 1.5 m in teaching blocks.
6.3 A flight shall not have more than 12 risers without a landing.
6.4 Handrails shall be provided on both sides of every staircase wider than 1.5 m, at a height of
900 mm above the nosing.

Page 2 of 3

Campus Building Code - Class Sample - Rev 2
Part 7. Fire safety and exits
7.1 Every floor of a teaching block shall have at least two separate exits.
7.2 The travel distance from any point on a floor to the nearest exit shall not exceed 30 m.
7.3 Exit doors shall open outwards, in the direction of escape, and shall be at least 1.0 m wide.
7.4 Fire extinguishers shall be placed so that no point on a floor is more than 15 m from one.

Part 8. Ramps and access
8.1 Ramps for wheelchair users shall have a slope not steeper than 1 in 12.
8.2 A level landing of at least 1.5 m length shall be provided at the top and bottom of every ramp and after every 9 m of ramp length.
8.3 Ramps shall have handrails on both sides at a height of 800 to 900 mm.

Page 3 of 3"""

EXAMPLE_TESTS: List[Dict[str, str]] = [
    {
        "q": "What is the minimum grade of concrete for severe exposure?",
        "expect": "M25",
        "source": "M25",
    },
    {
        "q": "How long must concrete be cured when fly-ash cement is used?",
        "expect": "10 days",
        "source": "blended cements",
    },
    {
        "q": "What nominal cover is needed for footings?",
        "expect": "50 mm",
        "source": "Footings",
    },
    {
        "q": "When can the props under a 7 m beam be removed?",
        "expect": "21 days",
        "source": "over 6 m",
    },
    {
        "q": "What is the maximum riser height of a step?",
        "expect": "175 mm",
        "source": "riser",
    },
    {
        "q": "How far can any point on a floor be from the nearest exit?",
        "expect": "30 m",
        "source": "travel distance",
    },
    {
        "q": "What slope is allowed for a wheelchair ramp?",
        "expect": "1 in 12",
        "source": "1 in 12",
    },
    {
        "q": "What fire rating do the exit doors need?",
        "expect": "doesn't say",
        "source": "",
    },
]

DEFAULT_TEMPLATE = (
    "Answer the question using only the context below.\n"
    'If the context does not contain the answer, say "The document doesn\'t say."\n'
    "Cite the chunks you used, like [1].\n"
    "\n"
    "Context:\n"
    "{context}\n"
    "\n"
    "Question: {question}"
)

QUERY_EXAMPLES = [
    "e.g. What nominal cover is needed for footings?",
    "e.g. When can the props under a 7 m beam be removed?",
    "e.g. How long must concrete be cured with fly-ash cement?",
]

EMBEDDERS: Dict[str, Dict[str, str]] = {
    "minilm": {
        "name": "MiniLM",
        "long": "all-MiniLM-L6-v2 (sentence-transformers)",
        "about": (
            "A neural embedding model. 384 numbers per chunk "
            "(classroom MiniLM-style embedding on the server)."
        ),
    },
    "tfidf": {
        "name": "TF-IDF",
        "long": "TF-IDF (scikit-learn)",
        "about": (
            "Keyword vectors: one number per word in the document, "
            "weighted by how rare the word is. Instant, nothing to download."
        ),
    },
}

STAGES: List[Dict[str, str]] = [
    {"id": "load", "name": "Load", "what": "Bring the document into the pipeline"},
    {
        "id": "clean",
        "name": "Clean",
        "what": "Fix what PDF extraction breaks, before anything else sees the text",
    },
    {
        "id": "chunk",
        "name": "Chunk",
        "what": "Cut the text into pieces small enough to search and to send",
    },
    {"id": "embed", "name": "Embed", "what": "Turn every chunk into a vector of numbers"},
    {"id": "store", "name": "Store", "what": "Keep the vectors in an index you can search"},
    {
        "id": "retrieve",
        "name": "Retrieve",
        "what": "Embed the question and find the closest chunks",
    },
    {
        "id": "prompt",
        "name": "Build the prompt",
        "what": "Put the retrieved chunks and the question into one prompt",
    },
    {
        "id": "generate",
        "name": "Generate",
        "what": "Send the prompt to the model and get a grounded answer",
    },
    {
        "id": "evaluate",
        "name": "Evaluate",
        "what": "Test the whole pipeline on questions with known answers",
    },
]

DEFAULTS: Dict[str, Any] = {
    "temp": 0.2,
    "topp": 1.0,
    "cap": 400,
    "mode": "sentences",
    "size": 60,
    "overlap": 10,
    "k": 3,
    "minScore": 0.0,
    "model": "minilm",
    "store": "numpy",
    "numbered": True,
    "evalGen": True,
    "prov": "gemini-flash-lite",
    "clean": {"headers": True, "hyphen": True, "wraps": True, "spaces": True},
}

PAGE_RE = re.compile(r"^\s*(page\s*\d+(\s*(of|/)\s*\d+)?|\d+)\s*$", re.I)
HYPHEN_RE = re.compile(r"(\w)-\n(\w)")
WRAP_RE = re.compile(r"(?<![.:;])\n(?=[a-z])")
# sklearn-style tokens: letters / numbers / underscore, length ≥ 2
_TOKEN_RE = re.compile(r"(?:[^\W_]|_)+", re.UNICODE)
_DOESNT_SAY = frozenset({"doesn't say", "doesnt say", "does not say"})

CHUNK_MODES = rag.CHUNK_MODES
EMBED_MODELS = ("minilm", "tfidf")
MAX_DOC = 200_000
MAX_CHUNKS = 800
MAX_QUERY = 4000
MAX_TESTS = 30
GEN_SYSTEM = "Follow the user prompt exactly."

FLOAT_DECIMALS = 6


def catalog() -> Dict[str, Any]:
    base = compare.catalog()
    return {
        "models": base["models"],
        "defaults": {**DEFAULTS, "inrPerUsd": compare.INR_PER_USD},
        "sample": {
            "doc": EXAMPLE_DOC,
            "docName": "Sample campus code (messy PDF extract)",
            "tests": [dict(t) for t in EXAMPLE_TESTS],
            "template": DEFAULT_TEMPLATE,
            "questions": list(QUERY_EXAMPLES),
        },
        "stages": list(STAGES),
        "embedders": dict(EMBEDDERS),
        "cleanDefaults": dict(DEFAULTS["clean"]),
        "chunkModes": list(CHUNK_MODES),
        "embedModels": list(EMBED_MODELS),
    }


def _round_vec(vec: Sequence[float], nd: int = FLOAT_DECIMALS) -> List[float]:
    return [round(float(x), nd) for x in vec]


def norm_text(text: str) -> str:
    s = str(text or "").lower().replace("\u2019", "'").replace("\u2018", "'")
    return re.sub(r"\s+", " ", s).strip()


def _est_tokens(text: str) -> int:
    cleaned = text or ""
    if not cleaned:
        return 0
    return max(1, int(math.ceil(len(cleaned) / 4)))


def clean(
    document: str,
    *,
    headers: bool = True,
    hyphen: bool = True,
    wraps: bool = True,
    spaces: bool = True,
) -> Dict[str, Any]:
    """Clean PDF-extraction artefacts. Mirrors exercise-12-build-a-rag.html cleaned()."""
    raw = document or ""
    if len(raw) > MAX_DOC:
        raise ValueError(f"Document is too long (max {MAX_DOC} characters)")

    text = raw
    removed: List[str] = []
    counts = {"headers": 0, "hyphen": 0, "wraps": 0, "spaces": 0}

    if headers:
        lines = text.split("\n")
        line_counts: Dict[str, int] = {}
        for line in lines:
            t = line.strip()
            if t:
                line_counts[t] = line_counts.get(t, 0) + 1
        keep: List[str] = []
        for line in lines:
            t = line.strip()
            if t and (PAGE_RE.match(line) or (line_counts.get(t, 0) >= 3 and len(t) <= 80)):
                removed.append(t)
                counts["headers"] += 1
            else:
                keep.append(line)
        text = "\n".join(keep)

    if hyphen:

        def _join_hyphen(m: re.Match[str]) -> str:
            counts["hyphen"] += 1
            return m.group(1) + m.group(2)

        text = HYPHEN_RE.sub(_join_hyphen, text)

    if wraps:

        def _join_wrap(_m: re.Match[str]) -> str:
            counts["wraps"] += 1
            return " "

        text = WRAP_RE.sub(_join_wrap, text)

    if spaces:
        before = text
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        counts["spaces"] = max(0, len(before) - len(text))

    return {"text": text, "removed": removed, "counts": counts}


def chunk(
    text: str,
    mode: str = "sentences",
    size: int = 60,
    overlap: int = 10,
) -> Dict[str, Any]:
    mode_n = mode if mode in CHUNK_MODES else "sentences"
    size_n = max(20, min(400, int(size)))
    overlap_n = max(0, min(100, int(overlap)))
    chunks = rag.chunk_document(text or "", mode=mode_n, size=size_n, overlap=overlap_n)
    if len(chunks) > MAX_CHUNKS:
        raise ValueError(f"Too many chunks (max {MAX_CHUNKS}). Increase chunk size or shorten the document.")
    return {
        "chunks": chunks,
        "count": len(chunks),
        "mode": mode_n,
        "size": size_n,
        "overlap": 0 if mode_n == "sections" else overlap_n,
    }


def words_of(text: str) -> List[str]:
    return [w for w in _TOKEN_RE.findall((text or "").lower()) if len(w) >= 2]


def _l2_normalize(vec: List[float]) -> List[float]:
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / n for x in vec]


def _tfidf_fit(docs: Sequence[str]) -> Tuple[List[str], List[List[float]], Any]:
    toks = [words_of(d) for d in docs]
    vocab = sorted({w for ts in toks for w in ts})
    idx = {w: i for i, w in enumerate(vocab)}
    n = len(docs) or 1
    df = [0] * len(vocab)
    for ts in toks:
        for w in set(ts):
            df[idx[w]] += 1
    idf = [math.log((1 + n) / (1 + d)) + 1.0 for d in df]

    def embed_tokens(ts: Sequence[str]) -> List[float]:
        v = [0.0] * len(vocab)
        for w in ts:
            k = idx.get(w)
            if k is not None:
                v[k] += 1.0
        for k in range(len(v)):
            v[k] *= idf[k]
        return _l2_normalize(v)

    vecs = [embed_tokens(ts) for ts in toks]
    return vocab, vecs, embed_tokens


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    n = min(len(a), len(b))
    return sum(float(a[i]) * float(b[i]) for i in range(n))


def pca2(vecs: Sequence[Sequence[float]]) -> Optional[Dict[str, Any]]:
    """Power-iteration PCA to 2D — same idea as the HTML pca2()."""
    n = len(vecs)
    d = len(vecs[0]) if n and vecs[0] is not None else 0
    if n < 2 or not d:
        return None

    mean = [0.0] * d
    for v in vecs:
        for k, x in enumerate(v):
            mean[k] += float(x) / n
    X = [[float(v[k]) - mean[k] for k in range(d)] for v in vecs]

    # Gram matrix n×n
    G = [[_dot(a, b) for b in X] for a in X]

    comps: List[Dict[str, List[float]]] = []
    for c in range(2):
        u = [math.sin(i * 1.7 + c * 2.1) + 1.1 for i in range(n)]
        for _it in range(80):
            w = [sum(G[i][j] * u[j] for j in range(n)) for i in range(n)]
            for pc in comps:
                pc_u = pc["u"]
                dot_u = sum(w[j] * pc_u[j] for j in range(n))
                w = [w[j] - dot_u * pc_u[j] for j in range(n)]
            L = math.sqrt(sum(x * x for x in w)) or 1.0
            u = [x / L for x in w]
        direction = [0.0] * d
        for i, row in enumerate(X):
            for k, x in enumerate(row):
                direction[k] += x * u[i]
        L = math.sqrt(sum(x * x for x in direction)) or 1.0
        comps.append({"u": u, "dir": [x / L for x in direction]})

    def proj(v: Sequence[float]) -> List[float]:
        centered = [float(v[k]) - mean[k] for k in range(d)]
        return [_dot(centered, pc["dir"]) for pc in comps]

    pts = [_round_vec(proj(v), 6) for v in vecs]
    return {
        "pts": pts,
        "mean": _round_vec(mean, 6),
        "dirs": [_round_vec(pc["dir"], 6) for pc in comps],
    }


def embed(chunks: Sequence[str], model: str = "minilm") -> Dict[str, Any]:
    texts = [str(c) for c in chunks if str(c).strip()]
    if not texts:
        raise ValueError("No chunks to embed")
    if len(texts) > MAX_CHUNKS:
        raise ValueError(f"Too many chunks (max {MAX_CHUNKS})")
    for i, c in enumerate(texts):
        if len(c) > 20_000:
            raise ValueError(f"Chunk {i + 1} is too long (max 20000 characters)")

    kind = model if model in EMBED_MODELS else "minilm"
    t0 = time.perf_counter()
    vocab_size: Optional[int] = None

    if kind == "tfidf":
        vocab, raw_vecs, _embed_tokens = _tfidf_fit(texts)
        vocab_size = len(vocab)
        dims = vocab_size
        vecs = [_round_vec(v) for v in raw_vecs]
    else:
        raw_vecs = [sentence_embed(c, EMBED_DIM).tolist() for c in texts]
        dims = EMBED_DIM
        vecs = [_round_vec(v) for v in raw_vecs]
        kind = "minilm"

    mapped = pca2(vecs)
    ms = int((time.perf_counter() - t0) * 1000)
    out: Dict[str, Any] = {
        "kind": kind,
        "dims": dims,
        "vecs": vecs,
        "map": {"pts": mapped["pts"]} if mapped else None,
        "ms": ms,
        "chunkCount": len(texts),
    }
    if vocab_size is not None:
        out["vocabSize"] = vocab_size
    if mapped and mapped.get("mean") and mapped.get("dirs"):
        # Keep mean/dirs so retrieve can project the query (optional qpt)
        out["map"] = {
            "pts": mapped["pts"],
            "mean": mapped["mean"],
            "dirs": mapped["dirs"],
        }
    return out


def _embed_query(query: str, kind: str, chunks: Sequence[str], vecs: Optional[Sequence[Sequence[float]]] = None) -> List[float]:
    if kind == "tfidf":
        _vocab, _chunk_vecs, embed_tokens = _tfidf_fit(chunks)
        return embed_tokens(words_of(query))
    return sentence_embed(query, EMBED_DIM).tolist()


def _project_query(
    qv: Sequence[float],
    map_info: Optional[Dict[str, Any]],
) -> Optional[List[float]]:
    if not map_info:
        return None
    mean = map_info.get("mean")
    dirs = map_info.get("dirs")
    if not mean or not dirs or len(dirs) < 2:
        return None
    if len(qv) != len(mean):
        return None
    centered = [float(qv[k]) - float(mean[k]) for k in range(len(mean))]
    return _round_vec([_dot(centered, d) for d in dirs], 6)


def retrieve(
    chunks: Sequence[str],
    query: str,
    *,
    model: str = "minilm",
    k: int = 3,
    min_score: float = 0.0,
    vecs: Optional[Sequence[Sequence[float]]] = None,
) -> Dict[str, Any]:
    q = (query or "").strip()
    if not q:
        raise ValueError("Query is empty")
    if len(q) > MAX_QUERY:
        raise ValueError(f"Query is too long (max {MAX_QUERY} characters)")

    texts = [str(c) for c in chunks if str(c).strip()]
    if not texts:
        raise ValueError("No chunks to search")
    if len(texts) > MAX_CHUNKS:
        raise ValueError(f"Too many chunks (max {MAX_CHUNKS})")

    kind = model if model in EMBED_MODELS else "minilm"
    k_n = max(1, min(10, int(k)))
    min_n = max(0.0, min(0.9, float(min_score)))

    t0 = time.perf_counter()
    map_info: Optional[Dict[str, Any]] = None

    if vecs is not None and len(vecs) == len(texts):
        matrix = [list(map(float, row)) for row in vecs]
        qv = _embed_query(q, kind, texts, matrix)
        mapped = pca2(matrix)
        map_info = mapped
    else:
        emb = embed(texts, model=kind)
        matrix = emb["vecs"]
        kind = str(emb["kind"])
        qv = _embed_query(q, kind, texts)
        map_info = emb.get("map")

    ranked = [{"i": i, "s": round(_dot(v, qv), 6)} for i, v in enumerate(matrix)]
    ranked.sort(key=lambda h: h["s"], reverse=True)
    kept = [h["i"] for h in ranked if h["s"] >= min_n and h["s"] > 0][:k_n]
    qpt = _project_query(qv, map_info if isinstance(map_info, dict) else None)

    return {
        "ranked": ranked,
        "kept": kept,
        "k": k_n,
        "minScore": min_n,
        "kind": kind,
        "dims": len(matrix[0]) if matrix else 0,
        "qpt": qpt,
        "ms": int((time.perf_counter() - t0) * 1000),
        "query": q,
    }


def context_of(chunks: Sequence[str], ids: Sequence[int], *, numbered: bool = True) -> str:
    parts: List[str] = []
    for n, i in enumerate(ids):
        if i < 0 or i >= len(chunks):
            continue
        text = chunks[i]
        parts.append(f"[{n + 1}] {text}" if numbered else text)
    return "\n\n".join(parts)


def build_prompt(
    question: str,
    chunks: Sequence[str],
    ids: Sequence[int],
    *,
    template: str = DEFAULT_TEMPLATE,
    numbered: bool = True,
) -> str:
    tmpl = template or DEFAULT_TEMPLATE
    ctx = context_of(chunks, ids, numbered=numbered)
    return tmpl.replace("{context}", ctx).replace("{question}", question)


def _simulated_build_rag(
    question: str,
    hits: Sequence[Dict[str, Any]],
    chunks: Sequence[str],
    kept: Sequence[int],
    model: str,
    temp: float,
    cap: int,
) -> Dict[str, Any]:
    """RAG-aware fallback when Vertex is unavailable — answers from retrieved campus-code chunks."""
    seed = f"{question}|{model}|{temp:.3f}|{cap}|{','.join(map(str, kept))}"
    rng = random.Random(int(hashlib.md5(seed.encode("utf-8")).hexdigest()[:8], 16))
    q_l = question.lower()
    cite = (int(kept[0]) + 1) if kept else 1

    def snippet(i: int, n: int = 220) -> str:
        if 0 <= i < len(chunks):
            return re.sub(r"\s+", " ", chunks[i])[:n]
        return ""

    if not kept:
        text = "The document doesn't say."
    elif any(w in q_l for w in ("fire rating", "fire-resistance", "fire resistance")):
        text = "The document doesn't say."
    elif "m25" in q_l or ("grade" in q_l and "severe" in q_l):
        text = f"The minimum grade for severe exposure is M25 [{cite}]."
    elif "fly-ash" in q_l or "fly ash" in q_l or ("cur" in q_l and "cement" in q_l):
        text = f"When blended cements such as fly-ash or slag cement are used, curing shall continue for at least 10 days [{cite}]."
    elif "footing" in q_l or ("cover" in q_l and "earth" in q_l):
        text = f"Footings and other members cast against earth need 50 mm nominal cover [{cite}]."
    elif "prop" in q_l or ("beam" in q_l and ("7 m" in q_l or "7m" in q_l or "formwork" in q_l)):
        text = f"Props under beams spanning over 6 m may be removed after 21 days [{cite}]."
    elif "riser" in q_l:
        text = f"The riser of a step shall not exceed 175 mm [{cite}]."
    elif "exit" in q_l or "travel" in q_l:
        text = f"The travel distance from any point on a floor to the nearest exit shall not exceed 30 m [{cite}]."
    elif "ramp" in q_l or "slope" in q_l or "wheelchair" in q_l:
        text = f"Ramps for wheelchair users shall have a slope not steeper than 1 in 12 [{cite}]."
    else:
        snip = snippet(int(kept[0]))
        text = f"Based on the retrieved campus-code passages [{cite}]: {snip}"
        if rng.random() < 0.2:
            text += " The document doesn't say more than that."

    words = text.split()
    budget = max(8, int(cap / 1.3))
    hit_cap = False
    if len(words) > budget:
        text = " ".join(words[:budget]).strip()
        hit_cap = True

    return {
        "text": text,
        "inTok": _est_tokens(question) + 40,
        "outTok": _est_tokens(text),
        "stop": "max_tokens" if hit_cap else "end",
        "simulated": True,
    }


def _call_llm(
    prompt: str,
    *,
    model: str,
    temp: float,
    topp: float,
    cap: int,
) -> Dict[str, Any]:
    return compare.generate_once(
        system=GEN_SYSTEM,
        turns=[{"role": "user", "text": prompt}],
        model=model,
        temp=temp,
        topp=topp,
        cap=cap,
        nonce=0,
        max_turn_chars=16000,
    )


def generate(
    question: str,
    *,
    document: str = "",
    chunks: Optional[Sequence[str]] = None,
    clean_opts: Optional[Dict[str, bool]] = None,
    mode: str = "sentences",
    size: int = 60,
    overlap: int = 10,
    embed_model: str = "minilm",
    k: int = 3,
    min_score: float = 0.0,
    template: str = DEFAULT_TEMPLATE,
    numbered: bool = True,
    model: str = "gemini-flash-lite",
    temp: float = 0.2,
    topp: float = 1.0,
    cap: int = 400,
    compare_bare: bool = False,
) -> Dict[str, Any]:
    q = (question or "").strip()
    if not q:
        raise ValueError("Question is empty")
    if len(q) > MAX_QUERY:
        raise ValueError(f"Question is too long (max {MAX_QUERY} characters)")

    t0 = time.perf_counter()
    opts = {**DEFAULTS["clean"], **(clean_opts or {})}

    if chunks is not None:
        chunk_list = [str(c) for c in chunks if str(c).strip()]
    else:
        if not (document or "").strip():
            raise ValueError("Provide a document or a chunks list")
        cleaned = clean(
            document,
            headers=bool(opts.get("headers", True)),
            hyphen=bool(opts.get("hyphen", True)),
            wraps=bool(opts.get("wraps", True)),
            spaces=bool(opts.get("spaces", True)),
        )
        packed = chunk(cleaned["text"], mode=mode, size=size, overlap=overlap)
        chunk_list = packed["chunks"]

    if not chunk_list:
        raise ValueError("No chunks available — load and clean a document first")
    if len(chunk_list) > MAX_CHUNKS:
        raise ValueError(f"Too many chunks (max {MAX_CHUNKS})")

    searched = retrieve(
        chunk_list,
        q,
        model=embed_model,
        k=k,
        min_score=min_score,
    )
    kept = list(searched["kept"])
    ranked = list(searched["ranked"])
    hits = [
        {
            "i": int(h["i"]),
            "s": float(h["s"]),
            "text": chunk_list[int(h["i"])] if 0 <= int(h["i"]) < len(chunk_list) else "",
        }
        for h in ranked
        if int(h["i"]) in kept
    ]
    prompt = build_prompt(
        q,
        chunk_list,
        kept,
        template=template or DEFAULT_TEMPLATE,
        numbered=bool(numbered),
    )
    sent = _est_tokens(GEN_SYSTEM) + _est_tokens(prompt)

    try:
        result = _call_llm(prompt, model=model, temp=temp, topp=topp, cap=cap)
        text = str(result.get("text") or "").strip()
        if result.get("simulated") and (
            "materials" in text.lower()
            or "matsel" in text.lower()
            or "governing property" in text.lower()
        ):
            sim = _simulated_build_rag(q, hits, chunk_list, kept, model, temp, cap)
            text = sim["text"]
            result = {**result, **sim, "text": text}
    except Exception as exc:
        logger.warning("Exercise 12 generate falling back to simulator: %s", exc)
        sim = _simulated_build_rag(q, hits, chunk_list, kept, model, temp, cap)
        meta = compare._model_meta(model if model in compare._MODEL_BY_ID else "gemini")  # noqa: SLF001
        result = {
            "text": sim["text"],
            "model": meta.get("model"),
            "modelId": meta.get("id"),
            "vendor": meta.get("vendor"),
            "name": meta.get("name"),
            "temp": temp,
            "topp": topp,
            "cap": cap,
            "inTok": sim["inTok"],
            "outTok": sim["outTok"],
            "stop": sim["stop"],
            "ms": int((time.perf_counter() - t0) * 1000),
            "cost": 0.0,
            "costInr": 0.0,
            "simulated": True,
            "nonce": 0,
        }
        text = sim["text"]

    text = str(result.get("text") or "").strip()
    bare: Optional[Dict[str, Any]] = None
    if compare_bare:
        try:
            bare_res = _call_llm(q, model=model, temp=temp, topp=topp, cap=cap)
            bare = {
                "text": str(bare_res.get("text") or "").strip(),
                "inTok": int(bare_res.get("inTok") or _est_tokens(q)),
                "outTok": int(bare_res.get("outTok") or 0),
                "ms": int(bare_res.get("ms") or 0),
                "simulated": bool(bare_res.get("simulated")),
            }
        except Exception as exc:
            logger.warning("Exercise 12 bare compare failed: %s", exc)
            bare = {
                "text": (
                    "Without the document I would be guessing from general knowledge — "
                    "that answer may not match the campus code."
                ),
                "inTok": _est_tokens(q),
                "outTok": 30,
                "ms": 0,
                "simulated": True,
            }

    return {
        "text": text,
        "answer": text,
        "model": result.get("model"),
        "modelId": result.get("modelId") or model,
        "name": result.get("name"),
        "vendor": result.get("vendor"),
        "temp": result.get("temp", temp),
        "topp": result.get("topp", topp),
        "cap": result.get("cap", cap),
        "inTok": int(result.get("inTok") or sent),
        "outTok": int(result.get("outTok") or _est_tokens(text)),
        "sentEst": sent,
        "ms": int(result.get("ms") or (time.perf_counter() - t0) * 1000),
        "stop": result.get("stop") or "end",
        "simulated": bool(result.get("simulated")),
        "ids": kept,
        "kept": kept,
        "prompt": prompt,
        "bare": bare,
        "hits": hits,
        "ranked": ranked[:10],
        "kind": searched.get("kind"),
        "dims": searched.get("dims"),
        "chunkCount": len(chunk_list),
        "embedModel": embed_model if embed_model in EMBED_MODELS else "minilm",
        "k": int(searched.get("k") or k),
        "minScore": float(searched.get("minScore") if searched.get("minScore") is not None else min_score),
        "numbered": bool(numbered),
    }


def _expect_ok(answer: str, expect: str) -> Optional[bool]:
    e = norm_text(expect)
    if not e:
        return None
    a = norm_text(answer)
    if e in _DOESNT_SAY or e == "doesn't say":
        return any(
            phrase in a
            for phrase in (
                "doesn't say",
                "doesnt say",
                "does not say",
                "document doesn't say",
                "document does not say",
            )
        )
    return e in a


def evaluate(
    *,
    document: str = "",
    chunks: Optional[Sequence[str]] = None,
    clean_opts: Optional[Dict[str, bool]] = None,
    mode: str = "sentences",
    size: int = 60,
    overlap: int = 10,
    embed_model: str = "minilm",
    k: int = 3,
    min_score: float = 0.0,
    template: str = DEFAULT_TEMPLATE,
    numbered: bool = True,
    tests: Optional[Sequence[Dict[str, str]]] = None,
    eval_gen: bool = True,
    model: str = "claude",
    temp: float = 0.2,
    topp: float = 1.0,
    cap: int = 400,
) -> Dict[str, Any]:
    raw_tests = list(tests or [])
    if len(raw_tests) > MAX_TESTS:
        raise ValueError(f"Too many tests (max {MAX_TESTS})")
    filtered = [t for t in raw_tests if str(t.get("q") or "").strip()]
    if not filtered:
        raise ValueError("Add at least one test question")

    opts = {**DEFAULTS["clean"], **(clean_opts or {})}
    if chunks is not None:
        chunk_list = [str(c) for c in chunks if str(c).strip()]
    else:
        if not (document or "").strip():
            raise ValueError("Provide a document or a chunks list")
        cleaned = clean(
            document,
            headers=bool(opts.get("headers", True)),
            hyphen=bool(opts.get("hyphen", True)),
            wraps=bool(opts.get("wraps", True)),
            spaces=bool(opts.get("spaces", True)),
        )
        packed = chunk(cleaned["text"], mode=mode, size=size, overlap=overlap)
        chunk_list = packed["chunks"]

    if not chunk_list:
        raise ValueError("No chunks available")
    if len(chunk_list) > MAX_CHUNKS:
        raise ValueError(f"Too many chunks (max {MAX_CHUNKS})")

    # Embed once for all tests
    emb = embed(chunk_list, model=embed_model)
    matrix = emb["vecs"]
    kind = str(emb["kind"])

    rows: List[Dict[str, Any]] = []
    hits_n = 0
    found_n = 0
    ok_n = 0
    gen_n = 0

    for t in filtered:
        q = str(t.get("q") or "").strip()
        expect = str(t.get("expect") or "")
        source = str(t.get("source") or "")
        row: Dict[str, Any] = {"q": q, "expect": expect, "source": source}
        try:
            searched = retrieve(
                chunk_list,
                q,
                model=kind,
                k=k,
                min_score=min_score,
                vecs=matrix,
            )
            ids = list(searched["kept"])
            row["ids"] = ids
            if source.strip():
                src_n = norm_text(source)
                row["hit"] = any(src_n in norm_text(chunk_list[i]) for i in ids if 0 <= i < len(chunk_list))
                found_n += 1
                if row["hit"]:
                    hits_n += 1
            else:
                row["hit"] = None

            if eval_gen:
                prompt = build_prompt(
                    q,
                    chunk_list,
                    ids,
                    template=template or DEFAULT_TEMPLATE,
                    numbered=bool(numbered),
                )
                try:
                    result = _call_llm(prompt, model=model, temp=temp, topp=topp, cap=cap)
                    answer = str(result.get("text") or "").strip()
                    if result.get("simulated") and (
                        "materials" in answer.lower()
                        or "matsel" in answer.lower()
                        or "governing property" in answer.lower()
                    ):
                        sim = _simulated_build_rag(
                            q,
                            [],
                            chunk_list,
                            ids,
                            model,
                            temp,
                            cap,
                        )
                        answer = sim["text"]
                        result = {**result, **sim}
                except Exception as exc:
                    logger.warning("Exercise 12 evaluate generate fallback: %s", exc)
                    sim = _simulated_build_rag(q, [], chunk_list, ids, model, temp, cap)
                    answer = sim["text"]
                    result = sim

                row["answer"] = answer
                row["simulated"] = bool(result.get("simulated"))
                row["ok"] = _expect_ok(answer, expect)
                gen_n += 1
                if row["ok"] is True:
                    ok_n += 1
        except Exception as exc:
            logger.error("Exercise 12 evaluate row failed: %s", exc, exc_info=True)
            row["error"] = str(exc)

        rows.append(row)

    return {
        "rows": rows,
        "gen": bool(eval_gen),
        "summary": {
            "tests": len(rows),
            "retrievalHits": hits_n,
            "retrievalFound": found_n,
            "genOk": ok_n,
            "genTotal": gen_n,
        },
        "kind": kind,
        "dims": emb.get("dims"),
        "chunkCount": len(chunk_list),
    }
