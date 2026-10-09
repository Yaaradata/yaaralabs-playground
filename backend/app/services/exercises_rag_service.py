"""Exercise 11 — RAG chatbot: chunk, retrieve (TF-IDF KNN), then answer (and hallucinate on purpose)."""

from __future__ import annotations

import hashlib
import logging
import math
import random
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from . import exercises_compare_service as compare

logger = logging.getLogger(__name__)

STRICT_SYS = (
    "You answer questions for civil engineering students using only the numbered context "
    "passages you are given, like [3].\n"
    "Cite the passages you used with their numbers in square brackets.\n"
    'If the passages do not contain the answer, reply: "The document does not say." '
    "Do not guess and do not use outside knowledge."
)

LOOSE_SYS = (
    "You answer questions for civil engineering students.\n"
    "You are given numbered context passages, like [3]. Use them when they help, and cite "
    "them with their numbers in square brackets."
)

NODOC_SYS = "You answer questions for civil engineering students."

SAMPLE_DOC = """CAMPUS BUILDING CODE (sample written for this class, not an official IS standard)

Part 1. Scope
1.1 This code applies to new teaching blocks, hostels, laboratories and workshops built on the campus.
1.2 Where this code is silent, the designer shall follow the relevant national standard and record the reference in the design basis report.

Part 2. Concrete
2.1 The minimum grade of concrete for reinforced concrete work shall be M20. Where members are exposed to severe conditions, such as coastal air or wet foundations, the minimum grade shall be M25.
2.2 The maximum water-cement ratio shall be 0.50 for moderate exposure and 0.45 for severe exposure.
2.3 Concrete shall be placed within 30 minutes of mixing when mixed on site, and within 90 minutes when supplied as ready-mixed concrete.
2.4 Concrete shall be compacted with needle vibrators. Hand rodding is allowed only for small repairs.

Part 3. Nominal cover to reinforcement
3.1 Slabs: 20 mm.
3.2 Beams: 25 mm for moderate exposure and 30 mm for severe exposure.
3.3 Columns: 40 mm.
3.4 Footings and other members cast against earth: 50 mm.
3.5 Cover blocks shall be of the same strength as the surrounding concrete and shall be tied in place before concreting.

Part 4. Curing
4.1 Exposed concrete surfaces shall be kept continuously moist for at least 7 days when ordinary Portland cement is used.
4.2 When blended cements such as fly-ash or slag cement are used, curing shall continue for at least 10 days.
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
6.4 Handrails shall be provided on both sides of every staircase wider than 1.5 m, at a height of 900 mm above the nosing.

Part 7. Fire safety and exits
7.1 Every floor of a teaching block shall have at least two separate exits.
7.2 The travel distance from any point on a floor to the nearest exit shall not exceed 30 m.
7.3 Exit doors shall open outwards, in the direction of escape, and shall be at least 1.0 m wide.
7.4 Fire extinguishers shall be placed so that no point on a floor is more than 15 m from one.

Part 8. Ramps and access
8.1 Ramps for wheelchair users shall have a slope not steeper than 1 in 12.
8.2 A level landing of at least 1.5 m length shall be provided at the top and bottom of every ramp and after every 9 m of ramp length.
8.3 Ramps shall have handrails on both sides at a height of 800 to 900 mm.

Part 9. Roofs and parapets
9.1 Accessible roofs shall have a parapet or railing at least 1.0 m high.
9.2 Roof slabs shall be laid to a fall of at least 1 in 100 towards the rainwater outlets.
9.3 Every building with a roof area over 100 m² shall have a rainwater harvesting pit sized for the first 20 mm of rainfall.

Part 10. Lighting, ventilation and parking
10.1 Classrooms shall have an average illuminance of at least 300 lux at desk level.
10.2 Openable windows shall be at least one tenth of the floor area of each room.
10.3 Car parking bays shall be at least 2.5 m wide and 5.0 m long. Two-wheeler bays shall be at least 1.0 m by 2.0 m."""

Q_EXAMPLES = [
    "e.g. What is the minimum nominal cover for a column?",
    "e.g. How long must props stay under a 5 m slab?",
    "e.g. What seismic zone factor should I use for a building in Chennai?",
]

STOP: Set[str] = set(
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it its may more most must no not of on or other our shall should so such than that the their them then there these they this those to under up upon was we were what when where which while who why will with within would you your".split()
)

DEFAULTS: Dict[str, Any] = {
    "temp": 0.2,
    "topp": 1.0,
    "cap": 400,
    "mode": "words",
    "size": 60,
    "overlap": 10,
    "k": 3,
    "minScore": 0.0,
    "strict": True,
    "useDoc": True,
    "prov": "gemini-flash-lite",
}

CHUNK_MODES = ("words", "sentences", "sections")


def catalog() -> Dict[str, Any]:
    base = compare.catalog()
    return {
        "models": base["models"],
        "defaults": {**DEFAULTS, "inrPerUsd": compare.INR_PER_USD},
        "sample": {
            "doc": SAMPLE_DOC,
            "docName": "Sample campus code",
            "questions": Q_EXAMPLES,
        },
        "prompts": {
            "strict": STRICT_SYS,
            "loose": LOOSE_SYS,
            "nodoc": NODOC_SYS,
        },
        "searchKind": "tfidf",
        "methodLabel": "Exact KNN · keyword vectors (TF-IDF)",
    }


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def _sentences_of(text: str) -> List[str]:
    out: List[str] = []
    for line in re.split(r"\n+", text or ""):
        line = line.strip()
        if not line:
            continue
        parts = re.findall(r".+?(?:[.!?](?=\s|$)|$)", line) or [line]
        for part in parts:
            s = part.strip()
            if s:
                out.append(s)
    return out


def _pack(units: Sequence[str], size: int, overlap: int, sep: str) -> List[str]:
    out: List[str] = []
    cur: List[str] = []
    n = 0
    for unit in units:
        w = _word_count(unit)
        if n + w > size and cur:
            out.append(sep.join(cur))
            carry: List[str] = []
            cw = 0
            for i in range(len(cur) - 1, -1, -1):
                x = _word_count(cur[i])
                if cw + x > overlap:
                    break
                carry.insert(0, cur[i])
                cw += x
            cur = carry
            n = cw
        cur.append(unit)
        n += w
    if cur:
        out.append(sep.join(cur))
    return out


def _chunk_words(text: str, size: int, overlap: int) -> List[str]:
    words = re.findall(r"\S+", text or "")
    if not words:
        return []
    step = max(1, size - overlap)
    out: List[str] = []
    for i in range(0, len(words), step):
        out.append(" ".join(words[i : i + size]))
        if i + size >= len(words):
            break
    return out


def chunk_document(text: str, mode: str = "words", size: int = 60, overlap: int = 10) -> List[str]:
    cleaned = (text or "").strip()
    if not cleaned:
        return []
    mode_n = mode if mode in CHUNK_MODES else "words"
    size_n = max(20, min(400, int(size)))
    overlap_n = max(0, min(100, int(overlap)))
    if mode_n == "sections":
        units = [p.strip() for p in re.split(r"\n\s*\n", cleaned) if p.strip()]
        return _pack(units, size_n, 0, "\n\n")
    if mode_n == "sentences":
        return _pack(_sentences_of(cleaned), size_n, min(overlap_n, size_n - 10), " ")
    if overlap_n >= size_n:
        overlap_n = max(0, size_n - 10)
    return _chunk_words(cleaned, size_n, overlap_n)


def _stem_token(w: str) -> str:
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def terms_of(text: str) -> List[str]:
    raw = re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", (text or "").lower())
    return [_stem_token(w) for w in raw if w not in STOP and len(w) > 1]


def _tfidf_vec(tokens: Sequence[str], idf: Dict[str, float]) -> Dict[str, float]:
    tf: Dict[str, int] = {}
    for t in tokens:
        tf[t] = tf.get(t, 0) + 1
    vec: Dict[str, float] = {}
    n = 0.0
    for t, c in tf.items():
        w = (1.0 + math.log(c)) * idf.get(t, 0.0)
        if w > 0:
            vec[t] = w
            n += w * w
    n = math.sqrt(n) or 1.0
    return {t: w / n for t, w in vec.items()}


def _build_tfidf(chunks: Sequence[str]) -> Tuple[Dict[str, float], List[Dict[str, float]]]:
    docs = [terms_of(c) for c in chunks]
    df: Dict[str, int] = {}
    for ts in docs:
        for t in set(ts):
            df[t] = df.get(t, 0) + 1
    n_docs = len(docs) or 1
    idf = {t: math.log((n_docs + 1) / (d + 1)) + 1.0 for t, d in df.items()}
    vecs = [_tfidf_vec(ts, idf) for ts in docs]
    return idf, vecs


def _cosine_sparse(a: Dict[str, float], b: Dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(w * b.get(t, 0.0) for t, w in a.items())


def search_chunks(
    chunks: Sequence[str],
    query: str,
    k: int = 3,
    min_score: float = 0.0,
) -> Dict[str, Any]:
    texts = [str(c) for c in chunks if str(c).strip()]
    if not texts:
        return {"hits": [], "dropped": 0, "kind": "tfidf", "methodLabel": catalog()["methodLabel"]}
    k_n = max(1, min(10, int(k)))
    min_n = max(0.0, min(0.5, float(min_score)))
    idf, vecs = _build_tfidf(texts)
    qv = _tfidf_vec(terms_of(query), idf)
    scored = [{"i": i, "score": round(_cosine_sparse(qv, v), 6), "text": texts[i]} for i, v in enumerate(vecs)]
    scored.sort(key=lambda h: h["score"], reverse=True)
    top = scored[:k_n]
    hits = [h for h in top if h["score"] >= min_n and h["score"] > 0]
    dropped = len(top) - len(hits)
    return {
        "hits": hits,
        "dropped": dropped,
        "kind": "tfidf",
        "methodLabel": catalog()["methodLabel"],
    }


def build_prompt(
    question: str,
    *,
    use_doc: bool = True,
    strict: bool = True,
    hits: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, str]:
    q = (question or "").strip()
    if not q:
        raise ValueError("Question is empty")
    if not use_doc:
        return {"system": NODOC_SYS, "user": q}
    system = STRICT_SYS if strict else LOOSE_SYS
    passages = list(hits or [])
    if passages:
        body = "\n\n".join(f"[{int(h['i']) + 1}] {h.get('text') or ''}" for h in passages)
    else:
        body = "(No passages matched the question.)"
    user = f"Context passages:\n\n{body}\n\nQuestion: {q}"
    return {"system": system, "user": user}


def _est_tokens(text: str) -> int:
    cleaned = text or ""
    if not cleaned:
        return 0
    return max(1, int(math.ceil(len(cleaned) / 4)))


def _cites_of(text: str) -> List[int]:
    found: List[int] = []
    for group in re.findall(r"\[(\s*\d+\s*(?:[,–-]\s*\d+\s*)*)\]", text or ""):
        for d in re.findall(r"\d+", group):
            found.append(int(d) - 1)
    # unique, preserve order
    seen: Set[int] = set()
    out: List[int] = []
    for i in found:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _simulated_rag(
    system: str,
    user: str,
    hits: Sequence[Dict[str, Any]],
    use_doc: bool,
    strict: bool,
    model: str,
    temp: float,
    cap: int,
) -> Dict[str, Any]:
    q = user.rsplit("Question:", 1)[-1].strip() if "Question:" in user else user
    seed = f"{system}|{user}|{model}|{temp:.3f}|{cap}|{use_doc}|{strict}"
    rng = random.Random(int(hashlib.md5(seed.encode("utf-8")).hexdigest()[:8], 16))

    if not use_doc:
        text = (
            "Without the document I am guessing from general civil-engineering knowledge. "
            "A typical column cover is often around 40 mm, but that may not match your campus code."
        )
    elif not hits:
        if strict:
            text = "The document does not say."
        else:
            text = (
                "No matching passages were retrieved. Drawing on outside knowledge, "
                "column cover is commonly 40 mm — this may be a hallucination relative to your file."
            )
    else:
        top = hits[0]
        cite = int(top["i"]) + 1
        snippet = re.sub(r"\s+", " ", str(top.get("text") or ""))[:220]
        q_l = q.lower()
        if any(w in q_l for w in ("seismic", "chennai", "zone factor", "earthquake")):
            if strict:
                text = "The document does not say."
            else:
                text = (
                    f"The retrieved chunks do not mention seismic zones. "
                    f"Outside the document, Chennai is often discussed under Zone III — "
                    f"this is not grounded in [{cite}]."
                )
        elif "cover" in q_l and "column" in q_l:
            text = f"Columns require 40 mm nominal cover [{cite}]. From the passage: {snippet}"
        elif "prop" in q_l or "formwork" in q_l or "slab" in q_l:
            text = (
                f"Props under slabs spanning up to 4.5 m stay for 7 days; "
                f"for a ~5 m slab the nearest rule in the chunks is about props under slabs [{cite}]. "
                f"Passage: {snippet}"
            )
        else:
            text = f"Based on the retrieved campus-code passages [{cite}]: {snippet}"
            if not strict and rng.random() < 0.35:
                text += " (Also, some designers use a 1.2 importance factor — not from this document.)"

    words = text.split()
    budget = max(8, int(cap / 1.3))
    hit_cap = False
    if len(words) > budget:
        text = " ".join(words[:budget]).strip()
        hit_cap = True

    in_tok = _est_tokens(system) + _est_tokens(user) + 8
    out_tok = _est_tokens(text)
    if hit_cap:
        out_tok = min(out_tok, int(cap))
    return {
        "text": text,
        "inTok": in_tok,
        "outTok": out_tok,
        "stop": "max_tokens" if hit_cap else "end",
        "simulated": True,
    }


def ask(
    question: str,
    *,
    model: str = "gemini-flash-lite",
    temp: float = 0.2,
    topp: float = 1.0,
    cap: int = 400,
    use_doc: bool = True,
    strict: bool = True,
    k: int = 3,
    min_score: float = 0.0,
    document: str = "",
    mode: str = "words",
    size: int = 60,
    overlap: int = 10,
    chunks: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Full RAG turn: chunk → TF-IDF KNN → prompt → model (or simulated fallback)."""
    q = (question or "").strip()
    if not q:
        raise ValueError("Question is empty")
    if len(q) > 4000:
        raise ValueError("Question is too long (max 4000 characters)")

    use = bool(use_doc)
    if use and not (document or "").strip() and not chunks:
        raise ValueError("Add a document first, or turn off Use the document")

    t0 = time.perf_counter()
    chunk_list: List[str] = []
    hits: List[Dict[str, Any]] = []
    dropped = 0
    kind = "tfidf"
    method = catalog()["methodLabel"]

    if use:
        if chunks is not None:
            chunk_list = [str(c) for c in chunks if str(c).strip()]
        else:
            chunk_list = chunk_document(document, mode=mode, size=size, overlap=overlap)
        if len(chunk_list) > 800:
            raise ValueError("Too many chunks (max 800). Increase chunk size or shorten the document.")
        searched = search_chunks(chunk_list, q, k=k, min_score=min_score)
        hits = list(searched["hits"])
        dropped = int(searched["dropped"])
        kind = str(searched["kind"])
        method = str(searched["methodLabel"])

    prompt = build_prompt(q, use_doc=use, strict=strict, hits=hits)
    system, user = prompt["system"], prompt["user"]
    sent = _est_tokens(system) + _est_tokens(user)

    try:
        result = compare.generate_once(
            system=system,
            turns=[{"role": "user", "text": user}],
            model=model,
            temp=temp,
            topp=topp,
            cap=cap,
            nonce=0,
            max_turn_chars=16000,
        )
        # compare.generate_once rejects empty system — ours is never empty
        text = str(result.get("text") or "").strip()
        # If the compare simulator produced materials-selection style text for RAG prompts,
        # replace with RAG-aware simulation when marked simulated and looks off-topic.
        if result.get("simulated") and (
            "materials" in text.lower()
            or "matsel" in text.lower()
            or "governing property" in text.lower()
        ):
            sim = _simulated_rag(system, user, hits, use, strict, model, temp, cap)
            text = sim["text"]
            result = {**result, **sim, "text": text}
    except Exception as exc:
        logger.warning("RAG ask falling back to simulator: %s", exc)
        sim = _simulated_rag(system, user, hits, use, strict, model, temp, cap)
        meta = compare._model_meta(model)  # noqa: SLF001
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
    cites = _cites_of(text)
    given = {int(h["i"]) for h in hits}
    missing_cites = [c for c in cites if c not in given]

    return {
        "text": text,
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
        "useDoc": use,
        "strict": bool(strict) if use else False,
        "k": int(k),
        "minScore": float(min_score),
        "kind": kind if use else "none",
        "methodLabel": method if use else "No search: document off",
        "chunkCount": len(chunk_list),
        "chunks": chunk_list if use else [],
        "hits": [{"i": int(h["i"]), "score": float(h["score"]), "text": h.get("text") or ""} for h in hits],
        "dropped": dropped,
        "cites": cites,
        "missingCites": missing_cites,
        "prompt": {"system": system, "user": user},
    }
