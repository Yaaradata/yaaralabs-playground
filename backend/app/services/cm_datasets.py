"""Datasets for Confusion Matrix projects (Exercise 3).

Two kinds, one shape (two classes; y = 0 is the class we care about):
  sample  built-in packs from the Nuvama dataset sources (app/data/confusion_matrix/*.csv)
  ex2     an Exercise 2 department dataset, with the learner's target class first
"""

from __future__ import annotations

import csv
import hashlib
import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import exercises_tfidf_datasets

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "confusion_matrix"

# "listed": False = no longer offered (the model barely reacts to the settings on it) but kept so
# earlier runs still open. Teaching sets are built by scripts/build_cm_datasets.py and checked by
# scripts/check_cm_datasets.py: every option of every setting must change the matrix.
SAMPLE_DATASETS: List[Dict[str, object]] = [
    {
        "id": "client_emails", "name": "Client emails", "file": "client_emails.csv",
        "classes": ["Escalate", "Routine"], "short": ["Escalate", "Routine"], "noun": "emails",
        "source": "Synthetic custody client emails, written for this training",
        "licence": "YaaraLabs",
        "blurb": "Does this email need a senior person now? Built so every setting visibly changes the result.",
    },
    {
        "id": "it_tickets", "name": "IT service desk", "file": "it_tickets.csv",
        "classes": ["Incident", "Request"], "short": ["Incident", "Request"], "noun": "tickets",
        "source": "Synthetic IT tickets from a financial firm, written for this training",
        "licence": "YaaraLabs",
        "blurb": "Is this ticket a live incident for the on-call team, or a normal request?",
    },
    {
        "id": "feedback", "name": "Customer feedback", "file": "feedback.csv",
        "classes": ["Complaint", "Feedback"], "short": ["Complaint", "Feedback"], "noun": "messages",
        "source": "Synthetic app and branch feedback from investors, written for this training",
        "licence": "YaaraLabs",
        "blurb": "A complaint the firm must act on, or general feedback?",
    },
    {
        "id": "cfpb", "name": "Complaint routing", "file": "cfpb.csv", "listed": False,
        "classes": ["Payments & transfers", "Accounts & statements"], "short": ["Payments", "Accounts"], "noun": "complaints",
        "source": "Real customer complaints to the US financial regulator (CFPB)", "licence": "Public domain",
        "blurb": "Route each complaint to the right queue. Real, long, emotional writing.",
    },
    {
        "id": "prepaid", "name": "Prepaid vs bank account", "file": "prepaid.csv", "listed": False,
        "classes": ["Prepaid card", "Bank account"], "short": ["Prepaid", "Bank account"], "noun": "complaints",
        "source": "Real customer complaints to the US financial regulator (CFPB)", "licence": "Public domain",
        "blurb": "Is the complaint about a prepaid card or a bank account?",
    },
    {
        "id": "b77", "name": "Payment vs KYC", "file": "b77.csv", "listed": False,
        "classes": ["Payment status", "Identity & KYC"], "short": ["Payment", "KYC"], "noun": "messages",
        "source": "Real bank customer messages (BANKING77)", "licence": "CC BY 4.0",
        "blurb": "Short chat messages: a payment question or an identity check?",
    },
    {
        # Retired: too easy (98.7%), so settings changed nothing. Kept so earlier runs still open.
        "id": "emails", "name": "Client emails (first version)", "file": "emails.csv", "listed": False,
        "classes": ["Escalate", "Routine"], "short": ["Escalate", "Routine"], "noun": "emails",
        "source": "Synthetic custody client emails, written for this training", "licence": "YaaraLabs",
        "blurb": "Custody client emails: does this need a senior person now?",
    },
]
SAMPLE_IDS = [d["id"] for d in SAMPLE_DATASETS if d.get("listed", True)]  # offered to learners
ALL_SAMPLE_IDS = [d["id"] for d in SAMPLE_DATASETS]

# Exercise 2 department datasets: the class we care about (matches DEPARTMENT_FOCUS in the frontend)
DEFAULT_TARGETS: Dict[str, str] = {
    "civil": "Unsafe", "mechanical": "Fault", "electrical": "Fault", "ece": "Fail", "cse": "Bug",
    "it": "System Fault", "chemical": "Abnormal", "aerospace": "Unserviceable",
    "automobile": "Unsafe to Drive", "biomedical": "Device Fault",
}


@dataclass
class CMDataset:
    key: str  # 'sample:cfpb' | 'ex2:civil:Unsafe'
    id: str
    name: str
    classes: List[str]
    short: List[str]
    noun: str
    source: str
    licence: str
    blurb: str
    texts: List[str] = field(repr=False)
    y: List[int] = field(repr=False)
    version: str = ""

    @property
    def counts(self) -> List[int]:
        return [self.y.count(0), self.y.count(1)]

    def info(self) -> Dict[str, object]:
        return {
            "id": self.id, "name": self.name, "classes": self.classes, "short": self.short, "noun": self.noun,
            "source": self.source, "licence": self.licence, "blurb": self.blurb, "counts": self.counts, "n": len(self.y),
        }


_CACHE: Dict[str, CMDataset] = {}
_LOCK = threading.Lock()


def _sample_meta(dataset_id: str) -> Dict[str, object]:
    meta = next((d for d in SAMPLE_DATASETS if d["id"] == dataset_id), None)
    if not meta:
        raise LookupError("Unknown dataset.")
    return meta


def load_sample(dataset_id: str) -> CMDataset:
    key = f"sample:{dataset_id}"
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
    meta = _sample_meta(dataset_id)
    path = DATA_DIR / str(meta["file"])
    raw = path.read_bytes()
    classes = list(meta["classes"])  # type: ignore[arg-type]
    texts, y = [], []
    for row in csv.DictReader(raw.decode("utf-8").splitlines()):
        text = " ".join((row.get("text") or "").split())
        label = (row.get("label") or "").strip()
        if text and label in classes:
            texts.append(text)
            y.append(classes.index(label))
    ds = CMDataset(
        key=key, id=dataset_id, name=str(meta["name"]), classes=classes, short=list(meta["short"]),  # type: ignore[arg-type]
        noun=str(meta["noun"]), source=str(meta["source"]), licence=str(meta["licence"]), blurb=str(meta["blurb"]),
        texts=texts, y=y, version=hashlib.sha1(raw).hexdigest()[:12],
    )
    with _LOCK:
        _CACHE[key] = ds
    return ds


def ex2_classes(dataset_id: str, target: str) -> Tuple[str, str]:
    meta = exercises_tfidf_datasets.get_department_dataset(dataset_id)
    if not meta:
        raise LookupError("That Exercise 2 dataset is no longer available.")
    classes = list(meta.get("classes") or [])
    if len(classes) != 2 or target not in classes:
        raise ValueError("Exercise 3 needs a two-class Exercise 2 model.")
    other = classes[1] if classes[0] == target else classes[0]
    return target, other


def load_ex2(dataset_id: str, target: str) -> CMDataset:
    key = f"ex2:{dataset_id}:{target}"
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
    tgt, other = ex2_classes(dataset_id, target)
    meta = exercises_tfidf_datasets.get_department_dataset(dataset_id) or {}
    table = exercises_tfidf_datasets.load_department_table(dataset_id)
    texts, y = [], []
    for row in table["rows"]:
        if row["label"] in (tgt, other):
            texts.append(row["review"])
            y.append(0 if row["label"] == tgt else 1)
    ds = CMDataset(
        key=key, id=dataset_id, name=str(meta.get("name") or dataset_id), classes=[tgt, other], short=[tgt, other],
        noun="items", source=str(meta.get("source") or "Exercise 2 department dataset"), licence="",
        blurb=str(meta.get("use_case") or ""), texts=texts, y=y,
        version=hashlib.sha1(f"{dataset_id}:{len(texts)}:{sum(y)}".encode()).hexdigest()[:12],
    )
    with _LOCK:
        _CACHE[key] = ds
    return ds


def sample_rows(ds: CMDataset, page: int) -> List[Dict[str, object]]:
    """Two of each class, rotating with the page (target, other, target, other)."""
    a = [i for i, v in enumerate(ds.y) if v == 0]
    b = [i for i, v in enumerate(ds.y) if v == 1]
    if not a or not b:
        return []
    off = max(0, page) * 2
    pick = [a[off % len(a)], b[off % len(b)], a[(off + 1) % len(a)], b[(off + 1) % len(b)]]
    return [{"text": ds.texts[i], "y": ds.y[i]} for i in pick]


def find_sample(dataset_id: Optional[str]) -> Optional[Dict[str, object]]:
    return next((d for d in SAMPLE_DATASETS if d["id"] == dataset_id), None)


# ── Text Recognition projects (the learner's Ex 2 model) ─────────

OTHER_LABELS = "Other labels"
MIN_PER_LABEL = 3  # at least 2 to learn from and 1 to test on, per label


def cached(key: str) -> Optional[CMDataset]:
    with _LOCK:
        return _CACHE.get(key)


def textrec_key(project_id: str, target: str, texts: List[str], labels: List[str]) -> str:
    digest = hashlib.sha1(json.dumps([texts, labels], ensure_ascii=False).encode()).hexdigest()[:12]
    return f"tr:{project_id}:{digest}:{target}"


def make_textrec(key: str, project_name: str, texts: List[str], labels: List[str], target: str) -> CMDataset:
    """Target label vs every other label, from a snapshot of the project's examples."""
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
    others = sorted({l for l in labels if l != target})
    other = others[0] if len(others) == 1 else OTHER_LABELS
    ds = CMDataset(
        key=key, id=key, name=project_name, classes=[target, other], short=[target, other], noun="examples",
        source=f"Your Text Recognition project “{project_name}”", licence="",
        blurb=f"Your own examples: {target} against {', '.join(others)}.",
        texts=list(texts), y=[0 if l == target else 1 for l in labels], version=key.split(":")[2],
    )
    with _LOCK:
        _CACHE[key] = ds
    return ds
