"""Datasets for Text Classification projects (Day 1, Ex 2: the finance text classifier).

Six two-class packs in app/data/text_classification/*.csv (id,text,label), built by
scripts/build_tc_datasets.py from public data plus two synthetic custody packs.

Each pack names the class we care about (class 0). Ex 3 reads the same model with that class
as the target, so the pack order here matches what the Confusion Matrix project shows.

Cleaning (the learner's choice in step 2) is applied when the dataset is loaded:
  dropDuplicates  same text and same label more than once: keep one copy
  dropConflicts   same text with different labels: drop every copy (the label can't be trusted)
  removeMasks     drop the regulator's XXXX masks (XX/XX/XXXX dates, XXXX names and amounts)
Blank rows and rows with an unknown label are always left out (counted as "missing").
Texts are compared after the model's own cleaning (lowercase, letters and digits only), so
"Hello!" and "hello" count as the same text.
"""

from __future__ import annotations

import csv
import hashlib
import re
import statistics
import threading
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .cm_datasets import CMDataset

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "text_classification"

PACKS: List[Dict[str, Any]] = [
    {
        "id": "cfpb_complaint_routing", "file": "cfpb_complaint_routing.csv", "recommended": True,
        "name": "Complaint routing", "classes": ["Payments & transfers", "Accounts & statements"],
        "short": ["Payments", "Accounts"], "noun": "complaints", "kind": "real",
        "source": "US Consumer Financial Protection Bureau complaints, Jan–Mar 2024",
        "sourceUrl": "https://www.consumerfinance.gov/data-research/consumer-complaints/",
        "licence": "Public domain (US government work)",
        "blurb": "Real complaints, long and emotional. Send each one to the payments queue or the accounts queue.",
        "nuvama": "Client messages to a custody desk are routed the same way: a payment question to the "
                  "payments team, a statement or account question to client servicing.",
    },
    {
        "id": "banking77_payment_vs_kyc", "file": "banking77_payment_vs_kyc.csv",
        "name": "Payment vs KYC", "classes": ["Payment status", "Identity & KYC"],
        "short": ["Payment", "KYC"], "noun": "messages", "kind": "real",
        "source": "BANKING77: real customer messages to a bank (PolyAI)",
        "sourceUrl": "https://github.com/PolyAI-LDN/task-specific-datasets",
        "licence": "CC BY 4.0",
        "blurb": "Short chat messages: is the customer chasing a payment, or stuck on an identity check?",
        "nuvama": "Onboarding gets KYC questions; payments operations gets 'where is my money' questions.",
    },
    {
        "id": "cfpb_prepaid_vs_bank", "file": "cfpb_prepaid_vs_bank.csv",
        "name": "Prepaid vs bank account", "classes": ["Prepaid card", "Bank account"],
        "short": ["Prepaid", "Bank"], "noun": "complaints", "kind": "real",
        "source": "US Consumer Financial Protection Bureau complaints, Jan–Mar 2024",
        "sourceUrl": "https://www.consumerfinance.gov/data-research/consumer-complaints/",
        "licence": "Public domain (US government work)",
        "blurb": "Two products that sound alike in a complaint. The model has to find the words that tell them apart.",
        "nuvama": "Like telling a demat-account issue from a trading-account issue in a client email.",
    },
    {
        "id": "fin_news_bearish_bullish", "file": "fin_news_bearish_bullish.csv",
        "name": "Finance headlines", "classes": ["Bearish", "Bullish"],
        "short": ["Bearish", "Bullish"], "noun": "headlines", "kind": "real",
        "source": "Twitter Financial News Sentiment (neutral headlines removed)",
        "sourceUrl": "https://huggingface.co/datasets/zeroshot/twitter-financial-news-sentiment",
        "licence": "MIT",
        "blurb": "One-line market headlines: bad news or good news for the stock?",
        "nuvama": "Research and client-reporting teams scan news on the securities they hold.",
    },
    {
        "id": "custody_breaks", "file": "custody_breaks.csv",
        "name": "Reconciliation breaks", "classes": ["Investigate", "Self-clears"],
        "short": ["Investigate", "Self-clears"], "noun": "breaks", "kind": "synthetic",
        "source": "Synthetic, written for this training from custody reconciliation wording",
        "sourceUrl": "", "licence": "YaaraLabs",
        "blurb": "A break between our books and the depository: will it clear by itself, or must someone chase it?",
        "nuvama": "Reconciliation teams see hundreds of breaks a day; most are timing and clear overnight.",
    },
    {
        "id": "custody_client_emails", "file": "custody_client_emails.csv",
        "name": "Client emails", "classes": ["Escalate", "Routine"],
        "short": ["Escalate", "Routine"], "noun": "emails", "kind": "synthetic",
        "source": "Synthetic, written for this training from custody client-servicing wording",
        "sourceUrl": "", "licence": "YaaraLabs",
        "blurb": "Does this client email need a senior person today, or can it go in the normal queue?",
        "nuvama": "Client servicing must spot an angry or risky email among the routine statement requests.",
    },
]
PACK_IDS = [p["id"] for p in PACKS]

CLEAN_DEFAULTS = {"dropDuplicates": False, "dropConflicts": False, "removeMasks": False}
_MASK_RE = re.compile(r"[^\s,.;:()]*XX[^\s,.;:()]*")  # XXXX, XX/XX/2024, XX/XX/2024XXXX
_ANY_MASK_RE = re.compile(r"\bX{2,}")
_NORM_RE = re.compile(r"[^a-z0-9]+")
EXAMPLE_CHARS = 280

_RAW: Dict[str, Tuple[List[Tuple[int, str, str]], str]] = {}
_STATS: Dict[str, Dict[str, Any]] = {}
_DS: Dict[str, CMDataset] = {}
_LOCK = threading.Lock()


def find_pack(pack_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return next((p for p in PACKS if p["id"] == pack_id), None)


def pack(pack_id: str) -> Dict[str, Any]:
    meta = find_pack(pack_id)
    if not meta:
        raise LookupError("Unknown dataset.")
    return meta


def norm_clean(raw: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    raw = raw or {}
    return {k: bool(raw.get(k, v)) for k, v in CLEAN_DEFAULTS.items()}


def clean_code(clean: Dict[str, bool]) -> str:
    """'d1c0m1': part of the dataset key, so every cleaning choice is its own dataset."""
    c = norm_clean(clean)
    return f"d{int(c['dropDuplicates'])}c{int(c['dropConflicts'])}m{int(c['removeMasks'])}"


def clean_from_code(code: str) -> Dict[str, bool]:
    m = re.fullmatch(r"d([01])c([01])m([01])", code or "")
    if not m:
        raise LookupError("Unknown cleaning code.")
    return {"dropDuplicates": m[1] == "1", "dropConflicts": m[2] == "1", "removeMasks": m[3] == "1"}


def dataset_key(pack_id: str, clean: Dict[str, bool]) -> str:
    return f"tc:{pack_id}:{clean_code(clean)}"


def strip_masks(text: str) -> str:
    """XXXX names and XX/XX/XXXX dates are placeholders, not words: drop them (amounts stay)."""
    return " ".join(_MASK_RE.sub(" ", text).split())


def _norm(text: str) -> str:
    return _NORM_RE.sub(" ", text.lower()).strip()


def _raw(pack_id: str) -> Tuple[List[Tuple[int, str, str]], str]:
    """(rows as (id, text, label), file hash). Text is whitespace-normalised, nothing else."""
    with _LOCK:
        if pack_id in _RAW:
            return _RAW[pack_id]
    meta = pack(pack_id)
    data = (DATA_DIR / meta["file"]).read_bytes()
    rows = []
    for n, row in enumerate(csv.DictReader(data.decode("utf-8").splitlines()), 1):
        try:
            rid = int(row.get("id") or n)
        except ValueError:
            rid = n
        rows.append((rid, " ".join((row.get("text") or "").split()), (row.get("label") or "").strip()))
    out = (rows, hashlib.sha1(data).hexdigest()[:12])
    with _LOCK:
        _RAW[pack_id] = out
    return out


def info(pack_id: str) -> Dict[str, Any]:
    meta = pack(pack_id)
    rows, _ = _raw(pack_id)
    counts = [sum(1 for _, _, l in rows if l == c) for c in meta["classes"]]
    return {k: meta[k] for k in ("id", "name", "classes", "short", "noun", "kind", "source", "sourceUrl", "licence",
                                  "blurb", "nuvama")} | {"recommended": bool(meta.get("recommended")), "counts": counts,
                                                         "n": len(rows)}


def sample(pack_id: str, page: int, size: int = 10) -> List[Dict[str, Any]]:
    """A page of the file as it is (before cleaning), texts cut at 280 characters like the handout."""
    rows, _ = _raw(pack_id)
    start = (max(0, page) * size) % max(1, len(rows))
    out = []
    for rid, text, label in rows[start:start + size]:
        out.append({"id": rid, "label": label, "text": text[:EXAMPLE_CHARS] + ("…" if len(text) > EXAMPLE_CHARS else ""),
                    "chars": len(text), "masked": bool(_ANY_MASK_RE.search(text))})
    return out


def _short(text: str) -> str:
    return text[:EXAMPLE_CHARS] + ("…" if len(text) > EXAMPLE_CHARS else "")


def inspect(pack_id: str) -> Dict[str, Any]:
    """The step 2 checks on the file as it is: missing, duplicates, conflicts, leakage, masks, length."""
    with _LOCK:
        if pack_id in _STATS:
            return _STATS[pack_id]
    meta = pack(pack_id)
    rows, _ = _raw(pack_id)
    classes = meta["classes"]
    missing = [(rid, text, label) for rid, text, label in rows if not text or label not in classes]
    groups: Dict[str, List[Tuple[int, str, str]]] = defaultdict(list)
    for r in rows:
        if r[1] and r[2] in classes:
            groups[_norm(r[1])].append(r)
    dup_extra, dup_groups, conflict_rows, conflict_groups, leak_rows = 0, [], 0, [], 0
    for g in groups.values():
        if len(g) < 2:
            continue
        leak_rows += len(g)
        labels = {l for _, _, l in g}
        if len(labels) > 1:
            conflict_rows += len(g)
            conflict_groups.append(g)
        else:
            dup_extra += len(g) - 1
            dup_groups.append(g)
    masked = [r for r in rows if _ANY_MASK_RE.search(r[1])]
    lengths = [len(t) for _, t, _ in rows if t]
    words = [len(t.split()) for _, t, _ in rows if t]
    dup_groups.sort(key=len, reverse=True)
    conflict_groups.sort(key=len, reverse=True)
    stats = {
        "n": len(rows),
        "counts": [sum(1 for _, _, l in rows if l == c) for c in classes],
        "missing": len(missing),
        "duplicates": dup_extra,  # extra copies that "drop duplicates" removes
        "duplicateGroups": len(dup_groups),
        "conflicts": conflict_rows,  # rows that "drop conflicting labels" removes
        "conflictGroups": len(conflict_groups),
        "leakage": leak_rows,  # rows whose text appears more than once: copies can land in both train and test
        "masked": len(masked),
        "chars": {"median": int(statistics.median(lengths)) if lengths else 0, "max": max(lengths, default=0),
                  "min": min(lengths, default=0)},
        "words": {"median": int(statistics.median(words)) if words else 0, "max": max(words, default=0)},
        "examples": {
            "missing": [{"id": r[0], "text": _short(r[1]), "labels": [r[2]]} for r in missing[:3]],
            "duplicates": [{"id": g[0][0], "text": _short(g[0][1]), "labels": [g[0][2]], "copies": len(g)} for g in dup_groups[:3]],
            "conflicts": [{"id": g[0][0], "text": _short(g[0][1]), "copies": len(g),
                           "labels": sorted({l for _, _, l in g})} for g in conflict_groups[:3]],
            "masked": [{"id": r[0], "text": _short(r[1]), "labels": [r[2]]} for r in masked[:2]],
        },
    }
    with _LOCK:
        _STATS[pack_id] = stats
    return stats


def load(pack_id: str, clean: Optional[Dict[str, Any]] = None) -> CMDataset:
    """The pack after the learner's cleaning, as a two-class dataset (y = 0 is the class we care about)."""
    clean = norm_clean(clean)
    key = dataset_key(pack_id, clean)
    with _LOCK:
        if key in _DS:
            return _DS[key]
    meta = pack(pack_id)
    rows, digest = _raw(pack_id)
    classes = meta["classes"]
    rows = [r for r in rows if r[1] and r[2] in classes]
    if clean["dropConflicts"] or clean["dropDuplicates"]:
        labels_of: Dict[str, set] = defaultdict(set)
        for _, text, label in rows:
            labels_of[_norm(text)].add(label)
        seen, kept = set(), []
        for r in rows:
            k = _norm(r[1])
            if clean["dropConflicts"] and len(labels_of[k]) > 1:
                continue
            if clean["dropDuplicates"]:
                if (k, r[2]) in seen:
                    continue
                seen.add((k, r[2]))
            kept.append(r)
        rows = kept
    texts = [strip_masks(t) if clean["removeMasks"] else t for _, t, _ in rows]
    ds = CMDataset(
        key=key, id=pack_id, name=meta["name"], classes=list(classes), short=list(meta["short"]), noun=meta["noun"],
        source=meta["source"], licence=meta["licence"], blurb=meta["blurb"], texts=texts,
        y=[classes.index(l) for _, _, l in rows], version=f"{digest}-{clean_code(clean)}",
    )
    ds.ids = [r[0] for r in rows]  # type: ignore[attr-defined]  # file ids, for "show me this row"
    with _LOCK:
        _DS[key] = ds
    return ds


def load_by_key(key: str) -> CMDataset:
    kind, pack_id, code = (key.split(":") + ["", ""])[:3]
    if kind != "tc":
        raise LookupError("Not a Text Classification dataset key.")
    return load(pack_id, clean_from_code(code))
