"""Exercise 5 — Tokeniser & cost explorer.

Students wire Models → Question → Answer length → Languages → answer nodes,
run the flow, and compare token counts / INR cost across encodings and Indian
languages. Tokens are not words; Indic scripts usually need more tokens than
English; newer tokenisers (o200k) shrink that gap vs older ones (gpt2 / cl100k).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Tuple

from .exercises_vertex_models import (
    DEFAULT_SELECTED_FAMILY_IDS,
    catalog_models,
    resolve_vertex_model,
)

logger = logging.getLogger(__name__)

ENC_MAP = {
    "o200k": "o200k_base",
    "cl100k": "cl100k_base",
    "gpt2": "gpt2",
}

# Live Vertex Gemini models only (google-genai on this project).
MODELS: List[Dict[str, Any]] = catalog_models()
MODEL_VERSIONS: Dict[str, List[Dict[str, str]]] = {
    str(row["id"]): list(row.get("versions") or []) for row in MODELS
}


def _versions_for(model_id: str) -> List[Dict[str, str]]:
    rows = MODEL_VERSIONS.get(model_id) or [{"id": model_id, "label": model_id}]
    return [{"id": str(r["id"]), "label": str(r.get("label") or r["id"])} for r in rows]


def _default_version(model_id: str) -> str:
    rows = _versions_for(model_id)
    return rows[0]["id"]

LANGS: Dict[str, Dict[str, str]] = {
    "en": {"name": "English", "prompt": "English", "c": "cyan"},
    "ta": {"name": "Tamil", "prompt": "Tamil, written in Tamil script", "c": "mag"},
    "hi": {"name": "Hindi", "prompt": "Hindi, written in Devanagari script", "c": "amber"},
    "te": {"name": "Telugu", "prompt": "Telugu, written in Telugu script", "c": "vio"},
    "kn": {"name": "Kannada", "prompt": "Kannada, written in Kannada script", "c": "grn"},
    "ml": {"name": "Malayalam", "prompt": "Malayalam, written in Malayalam script", "c": "org"},
    "bn": {"name": "Bengali", "prompt": "Bengali, written in Bengali script", "c": "blu"},
}

# Same meaning in every language — used for pre-run tokens-per-word estimates.
REF: Dict[str, str] = {
    "en": (
        "Binary search works on a sorted list. It checks the middle element and "
        "discards half of the list at each step. This makes it much faster than "
        "checking every element one by one."
    ),
    "ta": (
        "இருமத் தேடல் வரிசைப்படுத்தப்பட்ட பட்டியலில் செயல்படுகிறது. அது நடுவில் உள்ள "
        "உறுப்பைச் சரிபார்த்து, ஒவ்வொரு படியிலும் பட்டியலின் பாதியை நீக்குகிறது. இதனால் "
        "ஒவ்வொரு உறுப்பையும் ஒன்றன்பின் ஒன்றாகச் சரிபார்ப்பதை விட இது மிக வேகமாக இருக்கிறது."
    ),
    "hi": (
        "बाइनरी सर्च एक क्रमबद्ध सूची पर काम करता है। यह बीच वाले तत्व को जाँचता है और हर "
        "चरण में सूची का आधा हिस्सा हटा देता है। इससे यह हर तत्व को एक-एक करके जाँचने से "
        "कहीं ज़्यादा तेज़ हो जाता है।"
    ),
    "te": (
        "బైనరీ సెర్చ్ క్రమబద్ధీకరించిన జాబితాపై పనిచేస్తుంది. ఇది మధ్యలో ఉన్న మూలకాన్ని "
        "పరిశీలించి, ప్రతి దశలో జాబితాలో సగాన్ని తొలగిస్తుంది. దీనివల్ల ప్రతి మూలకాన్ని "
        "ఒక్కొక్కటిగా పరిశీలించడం కంటే ఇది చాలా వేగంగా ఉంటుంది."
    ),
    "kn": (
        "ಬೈನರಿ ಸರ್ಚ್ ವಿಂಗಡಿಸಿದ ಪಟ್ಟಿಯ ಮೇಲೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ. ಇದು ಮಧ್ಯದ ಅಂಶವನ್ನು ಪರಿಶೀಲಿಸಿ, "
        "ಪ್ರತಿ ಹಂತದಲ್ಲೂ ಪಟ್ಟಿಯ ಅರ್ಧ ಭಾಗವನ್ನು ತೆಗೆದುಹಾಕುತ್ತದೆ. ಇದರಿಂದ ಪ್ರತಿಯೊಂದು ಅಂಶವನ್ನು "
        "ಒಂದೊಂದಾಗಿ ಪರಿಶೀಲಿಸುವುದಕ್ಕಿಂತ ಇದು ತುಂಬಾ ವೇಗವಾಗಿರುತ್ತದೆ."
    ),
    "ml": (
        "ബൈനറി സെർച്ച് ക്രമീകരിച്ച ഒരു പട്ടികയിൽ പ്രവർത്തിക്കുന്നു. ഇത് നടുവിലുള്ള ഘടകം "
        "പരിശോധിച്ച്, ഓരോ ഘട്ടത്തിലും പട്ടികയുടെ പകുതി ഒഴിവാക്കുന്നു. അതിനാൽ ഓരോ ഘടകവും "
        "ഒന്നൊന്നായി പരിശോധിക്കുന്നതിനേക്കാൾ ഇത് വളരെ വേഗത്തിലാണ്."
    ),
    "bn": (
        "বাইনারি সার্চ একটি সাজানো তালিকার উপর কাজ করে। এটি মাঝের উপাদানটি পরীক্ষা করে এবং "
        "প্রতিটি ধাপে তালিকার অর্ধেক বাদ দেয়। ফলে প্রতিটি উপাদান একে একে পরীক্ষা করার চেয়ে "
        "এটি অনেক দ্রুত।"
    ),
}

DEPTS: List[Tuple[str, str]] = [
    ("Civil", "Why does reinforced concrete crack when the steel bars inside it start to rust?"),
    ("Mechanical", "How does a turbocharger increase the power of an engine without making it bigger?"),
    ("EEE", "Why is electricity transmitted over long distances at very high voltage?"),
    ("ECE", "What happens to a MOSFET when the gate voltage crosses the threshold voltage?"),
    ("CSE", "Why is binary search faster than linear search on a sorted array?"),
    ("IT", "How does HTTPS keep my password safe when I log in to a website?"),
    ("Chemical", "Why does a catalyst speed up a reaction without being used up?"),
    ("Aeronautical", "How do the wings of an aircraft produce lift at take-off?"),
    ("Automobile", "How does ABS stop the wheels from locking during hard braking?"),
    ("Biomedical", "How does an ECG machine record the electrical activity of the heart?"),
]

_ENC_CACHE: Dict[str, Any] = {}


def catalog() -> Dict[str, Any]:
    return {
        "models": MODELS,
        "encodings": {
            "o200k": {"label": "o200k (2024)", "short": "o200k"},
            "cl100k": {"label": "cl100k (2023)", "short": "cl100k"},
            "gpt2": {"label": "GPT-2 (2019)", "short": "GPT-2"},
        },
        "langs": [
            {"id": lid, "name": meta["name"], "prompt": meta["prompt"], "c": meta["c"]}
            for lid, meta in LANGS.items()
        ],
        "depts": [{"name": name, "question": q} for name, q in DEPTS],
        "ref": REF,
        "lengths": [50, 100, 150],
        "defaults": {
            "models": list(DEFAULT_SELECTED_FAMILY_IDS),
            "langs": ["en", "ta"],
            "words": 100,
            "inr": 88,
            "question": DEPTS[4][1],
        },
    }


def _encoding(enc: str):
    key = ENC_MAP.get(enc, enc)
    if key in _ENC_CACHE:
        return _ENC_CACHE[key]
    try:
        import tiktoken
    except ImportError as e:
        raise RuntimeError(
            "tiktoken is required for Exercise 5. Install it with: pip install tiktoken"
        ) from e
    try:
        encoding = tiktoken.get_encoding(key)
    except Exception as e:
        raise ValueError(f"Unknown encoding '{enc}'") from e
    _ENC_CACHE[key] = encoding
    return encoding


def _fallback_pieces(text: str) -> List[Dict[str, Any]]:
    """Rough grapheme / latin split when tiktoken is unavailable."""
    pieces: List[Dict[str, Any]] = []
    for match in re.finditer(
        r"(\s+)|([A-Za-z0-9]+)|([^\s])",
        text or "",
        flags=re.UNICODE,
    ):
        space, latin, other = match.group(1), match.group(2), match.group(3)
        if space:
            continue
        chunk = latin or other or ""
        if not chunk:
            continue
        if latin:
            pieces.append({"text": chunk, "ids": [len(pieces)]})
        else:
            for ch in chunk:
                pieces.append({"text": ch, "ids": [len(pieces)]})
    return pieces


def _segments_from_ids(encoding: Any, ids: List[int]) -> List[Dict[str, Any]]:
    """Merge token bytes into UTF-8 display pieces (matches the HTML TK.segments)."""
    segments: List[Dict[str, Any]] = []
    pending_ids: List[int] = []
    pending_bytes = bytearray()
    for tid in ids:
        pending_ids.append(int(tid))
        try:
            pending_bytes.extend(encoding.decode_single_token_bytes(int(tid)))
        except Exception:
            try:
                pending_bytes.extend(encoding.decode([int(tid)]).encode("utf-8", errors="replace"))
            except Exception:
                pending_bytes.extend(b"\xef\xbf\xbd")
        try:
            piece = pending_bytes.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if piece:
            segments.append({"text": piece, "ids": list(pending_ids)})
            pending_ids = []
            pending_bytes = bytearray()
    if pending_ids:
        piece = pending_bytes.decode("utf-8", errors="replace") or "\ufffd"
        segments.append({"text": piece, "ids": list(pending_ids)})
    return segments


def tokenize(enc: str, text: str, want_segments: bool = False) -> Dict[str, Any]:
    raw = text or ""
    if enc not in ENC_MAP:
        raise ValueError(f"Encoding must be one of: {', '.join(ENC_MAP)}")
    try:
        encoding = _encoding(enc)
        ids = list(encoding.encode(raw))
        count = len(ids)
        segments = _segments_from_ids(encoding, ids) if want_segments and raw else []
        return {
            "enc": enc,
            "count": count,
            "ids": ids if want_segments else [],
            "segments": segments,
        }
    except RuntimeError:
        pieces = _fallback_pieces(raw)
        return {
            "enc": enc,
            "count": len(pieces),
            "ids": [],
            "segments": pieces if want_segments else [],
            "simulated": True,
        }


def tokenize_batch(items: List[Dict[str, str]], want_segments: bool = False) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in items[:48]:
        enc = str(item.get("enc") or "o200k")
        text = str(item.get("text") or "")
        out.append(tokenize(enc, text, want_segments=want_segments))
    return out


def build_prompt(question: str, lang: str, words: int) -> str:
    meta = LANGS.get(lang)
    if not meta:
        raise ValueError(f"Unknown language '{lang}'")
    limit = max(20, min(300, int(words or 100)))
    q = (question or "").strip()
    if not q:
        raise ValueError("Question is empty")
    return (
        "You are a study assistant for engineering college students.\n"
        f"Answer the question below in {meta['prompt']} only.\n"
        f"Use fewer than {limit} words. Plain text, no markdown, no heading, no preamble.\n\n"
        f"Question: {q}"
    )


def _trim_words(text: str, limit: int) -> str:
    parts = text.split()
    if len(parts) <= limit:
        return text.strip()
    return " ".join(parts[:limit]).strip()


def _word_cap(words: int) -> int:
    """Hard cap for 'fewer than N words' — allow at most N-1 words."""
    limit = max(20, min(300, int(words or 100)))
    return max(1, limit - 1)


def _simulated_answer(question: str, lang: str, words: int, model: str = "") -> str:
    """Classroom fallback that still shows Indic vs English token cost."""
    base = REF.get(lang) or REF["en"]
    # Lightly stitch the question topic into the first sentence for variety.
    topic = (question or "").strip().rstrip("?")
    tag = (model or "").strip()
    if lang == "en":
        prefix = f"[{tag}] " if tag else ""
        lead = f"{prefix}About “{topic[:80]}”: "
        body = lead + base
    else:
        prefix = f"[{tag}] " if tag else ""
        body = prefix + base
    return _trim_words(body, _word_cap(words))


def answer(
    question: str,
    lang: str,
    words: int = 100,
    model: str = "gemini-2.5-flash-lite",
) -> Dict[str, Any]:
    prompt = build_prompt(question, lang, words)
    hard_cap = _word_cap(words)
    # Rough token budget: Indic needs more tokens per word.
    max_tokens = max(80, min(800, hard_cap * (6 if lang != "en" else 3)))
    simulated = False
    text = ""
    chosen = resolve_vertex_model(model)
    try:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

        from .exercises_service import ExercisesService

        def _call() -> Dict[str, Any]:
            return ExercisesService().generate(
                prompt=prompt,
                system=None,
                examples=[],
                model=chosen,
                temperature=0.35,
                n=1,
                max_tokens=max_tokens,
            )

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_call)
            try:
                result = future.result(timeout=35)
            except FuturesTimeout:
                future.cancel()
                raise TimeoutError("Language answer timed out")
        text = (result.get("outputs") or [""])[0].strip()
        simulated = bool(result.get("simulated"))
        chosen = str(result.get("model") or model)
    except Exception as e:
        logger.warning("Exercise 5 answer fell back to simulator: %s", e)
        simulated = True
        text = ""

    if not text:
        text = _simulated_answer(question, lang, words, model=chosen or model)
        simulated = True

    text = _trim_words(text, hard_cap)
    return {
        "lang": lang,
        "text": text,
        "prompt": prompt,
        "model": chosen,
        "simulated": simulated,
        "words": len(text.split()) if text.strip() else 0,
    }


def ref_tpw() -> Dict[str, Dict[str, float]]:
    """tokens-per-word for the shared reference passage, per language × encoding."""
    out: Dict[str, Dict[str, float]] = {}
    for lang, passage in REF.items():
        w = max(1, len(passage.split()))
        out[lang] = {}
        for enc in ENC_MAP:
            try:
                count = tokenize(enc, passage)["count"]
            except Exception:
                count = len(_fallback_pieces(passage))
            out[lang][enc] = float(count) / float(w)
    return out
