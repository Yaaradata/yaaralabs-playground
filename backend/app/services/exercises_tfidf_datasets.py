"""Department datasets for Exercise 2 (TF-IDF and sentence embeddings)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "exercises" / "Ex_2_Dataset"
FULL_ROWS = 40000
PREVIEW_LIMIT = 4
PAGE_LIMIT_MAX = 200
_CSV_COLS = ["text", "label"]
_TABLE_CACHE: Dict[str, Dict[str, Any]] = {}
_INSPECT_CACHE: Dict[str, Dict[str, int]] = {}

DEPARTMENT_ORDER = [
    "civil",
    "mechanical",
    "electrical",
    "ece",
    "cse",
    "it",
    "chemical",
    "aerospace",
    "automobile",
    "biomedical",
]

SHORT_NAMES = {
    "civil": "CIVIL",
    "mechanical": "MECH",
    "electrical": "EEE",
    "ece": "ECE",
    "cse": "CSE",
    "it": "IT",
    "chemical": "CHEM",
    "aerospace": "AERO",
    "automobile": "AUTOMOBILE",
    "biomedical": "BME",
}

FULL_NAMES = {
    "civil": "Civil Engineering",
    "mechanical": "Mechanical Engineering",
    "electrical": "Electrical Engineering",
    "ece": "Electronics and Communication",
    "cse": "Computer Science",
    "it": "Information Technology",
    "chemical": "Chemical Engineering",
    "aerospace": "Aerospace Engineering",
    "automobile": "Automobile Engineering",
    "biomedical": "Biomedical Engineering",
}

CLASSES = {
    "civil": ["Safe", "Unsafe"],
    "mechanical": ["Normal", "Fault"],
    "electrical": ["Normal", "Fault"],
    "ece": ["Pass", "Fail"],
    "cse": ["Bug", "Working as Intended"],
    "it": ["User Error", "System Fault"],
    "chemical": ["Normal", "Abnormal"],
    "aerospace": ["Serviceable", "Unserviceable"],
    "automobile": ["Safe to Drive", "Unsafe to Drive"],
    "biomedical": ["Device Fault", "No Fault Found"],
}

THEMES = {
    "civil": "Structural inspection reports — Safe vs Unsafe",
    "mechanical": "Rotating-equipment condition reports — Normal vs Fault",
    "electrical": "Power-system reports — Normal vs Fault",
    "ece": "Electronics reports — Pass vs Fail",
    "cse": "Software tickets — Bug vs Working as Intended",
    "it": "Service-desk tickets — User Error vs System Fault",
    "chemical": "Process-plant reports — Normal vs Abnormal",
    "aerospace": "Aircraft reports — Serviceable vs Unserviceable",
    "automobile": "Workshop reports — Safe to Drive vs Unsafe to Drive",
    "biomedical": "Clinical-device reports — Device Fault vs No Fault Found",
}

SOURCES = {
    "civil": "Site walk-around notes, visual and NDT inspection reports, and structural check sheets on beams, columns, foundations, and bridges.",
    "mechanical": "Shift-round logs from pumps, gearboxes, motors, and bearings — what the technician heard, felt, or measured on the shop floor.",
    "electrical": "Maintenance logs, inspection reports, SCADA/alarm notes, and shift electrician rounds from substations and plant switchgear.",
    "ece": "Bench and field notes from board bring-up, RF links, firmware drops, and supply-rail checks.",
    "cse": "Issue-tracker tickets from auth, payments, search, and related product services.",
    "it": "Campus and office help-desk tickets about laptops, apps, wifi, printers, and logins.",
    "chemical": "Board-operator shift logs from reactors, columns, exchangers, and plant utilities.",
    "aerospace": "Hangar and flight-crew notes on airframe, engines, landing gear, and instruments.",
    "automobile": "Workshop diagnosis notes from cars in for repair — driver complaints plus what the tech observed.",
    "biomedical": "Hospital work orders on infusion pumps, patient monitors, ventilators, and other clinical devices.",
}

USE_CASES = {
    "civil": "Flag a structure as Safe or Unsafe from a short inspection note so the site team knows whether to keep using it. A closed check can stay in service; a defect that needs repair or restricted use is held before the next cycle.",
    "mechanical": "Sort a maintenance round into Normal or Fault so the crew knows whether the machine can stay on duty. In-spec readings keep running; vibration, heat, or wear that needs a stop is flagged on the same shift.",
    "electrical": "Sort a same-shift electrical note as Normal or Fault so the crew knows whether the circuit can stay in service.",
    "ece": "Call a bench or field check Pass or Fail so a board, link, or rail that missed spec is held before it ships.",
    "cse": "Sort a live ticket as Bug or Working as Intended so a real defect is not filed as expected behaviour.",
    "it": "Send a first-line ticket to User Error or System Fault so the desk knows whether to coach the person or fix the kit.",
    "chemical": "File a unit log as Normal or Abnormal for the next shift so drift on the unit is not mixed with an in-spec run.",
    "aerospace": "Call a pre-cycle note Serviceable or Unserviceable so the hangar knows whether the aircraft can fly.",
    "automobile": "Route a vehicle complaint as Safe to Drive or Unsafe to Drive so a no-go car is not released.",
    "biomedical": "Triage a device ticket as Device Fault or No Fault Found so broken hardware is not sent back as a use issue.",
}


def dataset_path(dataset_id: str) -> Path:
    return DATA_DIR / f"{dataset_id}_dataset.csv"


def list_department_datasets() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for dataset_id in DEPARTMENT_ORDER:
        path = dataset_path(dataset_id)
        if not path.exists():
            continue
        items.append(
            {
                "id": dataset_id,
                "name": FULL_NAMES[dataset_id],
                "short": SHORT_NAMES[dataset_id],
                "theme": THEMES[dataset_id],
                "source": SOURCES[dataset_id],
                "use_case": USE_CASES[dataset_id],
                "filename": path.name,
                "classes": CLASSES[dataset_id],
                "n_rows": FULL_ROWS,
            }
        )
    return items


def get_department_dataset(dataset_id: str) -> Optional[Dict[str, Any]]:
    wanted = (dataset_id or "").strip().lower()
    for item in list_department_datasets():
        if item["id"] == wanted:
            return item
    return None


def _clean_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if "text" not in frame.columns or "label" not in frame.columns:
        raise ValueError("Department files need text and label columns.")
    cleaned = frame.copy()
    cleaned["text"] = cleaned["text"].astype(str).str.replace(r"\s+", " ", regex=True).str.strip()
    cleaned["label"] = cleaned["label"].astype(str).str.strip()
    cleaned = cleaned[(cleaned["text"] != "") & (cleaned["label"] != "") & (cleaned["label"].str.lower() != "nan")]
    if cleaned.empty:
        raise ValueError("That department file does not have enough labeled texts.")
    return cleaned.reset_index(drop=True)


def _read_csv(path: Path, *, nrows: Optional[int] = None, skiprows: Optional[Sequence[int]] = None) -> pd.DataFrame:
    return pd.read_csv(
        path,
        usecols=_CSV_COLS,
        dtype=str,
        nrows=nrows,
        skiprows=skiprows,
        keep_default_na=False,
    )


def _rows_from_frame(frame: pd.DataFrame, min_rows: int = 4) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    if frame.empty or "text" not in frame.columns or "label" not in frame.columns:
        if min_rows:
            raise ValueError("That department file does not have enough labeled texts.")
        return rows
    for text, label in zip(frame["text"].tolist(), frame["label"].tolist()):
        cleaned_text = " ".join(str(text).split()).strip()[:4000]
        cleaned_label = str(label).strip()
        if not cleaned_text or not cleaned_label or cleaned_label.lower() == "nan":
            continue
        rows.append({"review": cleaned_text, "label": cleaned_label})
    if min_rows and len(rows) < min_rows:
        raise ValueError("That department file does not have enough labeled texts.")
    return rows


def _pick_preview_rows(rows: List[Dict[str, str]], limit: int) -> List[Dict[str, str]]:
    picked: List[Dict[str, str]] = []
    seen = set()
    for row in rows:
        if row["label"] in seen:
            continue
        seen.add(row["label"])
        picked.append(row)
        if len(picked) >= limit:
            return picked
    for row in rows:
        if len(picked) >= limit:
            break
        if row in picked:
            continue
        picked.append(row)
    return picked


def _payload_from_rows(meta: Dict[str, Any], rows: List[Dict[str, str]], n_rows: int) -> Dict[str, Any]:
    counts: Dict[str, int] = {}
    examples: List[Dict[str, str]] = []
    seen_labels = set()
    for row in rows:
        counts[row["label"]] = counts.get(row["label"], 0) + 1
        if row["label"] not in seen_labels:
            seen_labels.add(row["label"])
            examples.append({"label": row["label"], "text": row["review"]})
    return {
        "success": True,
        "id": meta["id"],
        "name": meta["name"],
        "short": meta["short"],
        "theme": meta["theme"],
        "source": meta.get("source", ""),
        "use_case": meta.get("use_case", ""),
        "filename": meta["filename"],
        "classes": meta["classes"] or sorted(counts.keys()),
        "counts": counts,
        "n_rows": n_rows,
        "rows": rows,
        "examples": examples,
    }


def inspect_labeled_rows(rows: Sequence[Dict[str, str]], classes: Sequence[str]) -> Dict[str, int]:
    empty_text = 0
    empty_label = 0
    seen: Dict[str, int] = {}
    by_text: Dict[str, set] = {}
    label_in_text = 0
    needles = [name.strip() for name in classes if str(name).strip()]
    for row in rows:
        text = str(row.get("review") or "").strip()
        label = str(row.get("label") or "").strip()
        if not text:
            empty_text += 1
        if not label:
            empty_label += 1
        if text:
            seen[text] = seen.get(text, 0) + 1
            if label:
                bucket = by_text.setdefault(text, set())
                bucket.add(label)
        if not text or not label:
            continue
        hay = f" {text.lower()} "
        hit = False
        for name in needles:
            needle = name.lower()
            if len(needle) < 3:
                continue
            if f" {needle} " in hay or f" {needle}." in hay or f" {needle}," in hay:
                hit = True
                break
        if hit:
            label_in_text += 1
    extra = 0
    groups = 0
    for count in seen.values():
        if count < 2:
            continue
        groups += 1
        extra += count - 1
    mixed_labels = sum(1 for labels in by_text.values() if len(labels) > 1)
    return {
        "empty_text": empty_text,
        "empty_label": empty_label,
        "extra": extra,
        "groups": groups,
        "label_in_text": label_in_text,
        "mixed_labels": mixed_labels,
        "n_rows": len(rows),
    }


def inspect_department_pack(dataset_id: str) -> Dict[str, int]:
    meta = get_department_dataset(dataset_id)
    if not meta:
        raise ValueError("Unknown department dataset.")
    cached = _INSPECT_CACHE.get(meta["id"])
    if cached:
        return dict(cached)
    table = _TABLE_CACHE.get(meta["id"])
    if table:
        stats = inspect_labeled_rows(table["rows"], table.get("classes") or meta["classes"])
        _INSPECT_CACHE[meta["id"]] = stats
        return dict(stats)
    path = dataset_path(dataset_id)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file missing: {path.name}")
    frame = _clean_frame(_read_csv(path))
    rows = _rows_from_frame(frame)
    payload = _payload_from_rows(meta, rows, len(rows))
    stats = inspect_labeled_rows(rows, payload["classes"])
    payload["inspect"] = stats
    _TABLE_CACHE[meta["id"]] = payload
    _INSPECT_CACHE[meta["id"]] = stats
    return dict(stats)


def load_department_table(dataset_id: str) -> Dict[str, Any]:
    meta = get_department_dataset(dataset_id)
    if not meta:
        raise ValueError("Unknown department dataset.")
    cached = _TABLE_CACHE.get(meta["id"])
    if cached:
        return cached
    path = dataset_path(dataset_id)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file missing: {path.name}")
    frame = _clean_frame(_read_csv(path))
    rows = _rows_from_frame(frame)
    payload = _payload_from_rows(meta, rows, len(rows))
    payload["inspect"] = inspect_labeled_rows(rows, payload["classes"])
    _INSPECT_CACHE[meta["id"]] = payload["inspect"]
    _TABLE_CACHE[meta["id"]] = payload
    return payload


def load_department_slice(dataset_id: str, offset: int = 0, limit: int = PREVIEW_LIMIT) -> Dict[str, Any]:
    meta = get_department_dataset(dataset_id)
    if not meta:
        raise ValueError("Unknown department dataset.")
    path = dataset_path(dataset_id)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file missing: {path.name}")
    offset = max(0, int(offset))
    limit = max(1, min(PAGE_LIMIT_MAX, int(limit)))
    cached = _TABLE_CACHE.get(meta["id"])
    if cached:
        window = cached["rows"][offset : offset + limit]
        payload = _payload_from_rows(meta, window, cached["n_rows"])
        payload["offset"] = offset
        payload["limit"] = limit
        return payload
    if offset == 0 and limit <= 8:
        probe = _read_csv(path, nrows=max(80, limit * 20))
        rows = _pick_preview_rows(_rows_from_frame(_clean_frame(probe), min_rows=1), limit)
    else:
        skip = range(1, offset + 1) if offset else None
        slice_frame = _read_csv(path, nrows=limit, skiprows=skip)
        if slice_frame.empty:
            rows = []
        else:
            cleaned = slice_frame.copy()
            cleaned["text"] = cleaned["text"].astype(str).str.replace(r"\s+", " ", regex=True).str.strip()
            cleaned["label"] = cleaned["label"].astype(str).str.strip()
            cleaned = cleaned[(cleaned["text"] != "") & (cleaned["label"] != "") & (cleaned["label"].str.lower() != "nan")]
            rows = _rows_from_frame(cleaned.reset_index(drop=True), min_rows=0)
    payload = _payload_from_rows(meta, rows, FULL_ROWS)
    payload["offset"] = offset
    payload["limit"] = limit
    return payload
