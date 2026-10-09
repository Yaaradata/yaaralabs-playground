"""Exercise 3 — Pick the Right Metric.

The browser only renders what this module returns. Held-out scores, quiz
answers, the correct metric, and star ratings stay here.
"""

from __future__ import annotations

import csv
import json
import math
import threading
import uuid
from pathlib import Path
from typing import Any

from . import exercises_tfidf_datasets as datasets
ANSWER_TOLERANCE = 1.0

_LOCK = threading.Lock()
_RUNS: dict[str, dict[str, Any]] = {}
_RUN_DIR = Path(__file__).resolve().parents[1] / "data" / "exercises" / "runtime" / "metric-runs"
_RUN_CAP = 400


def _i32(n: int) -> int:
    n &= 0xFFFFFFFF
    return n - 0x100000000 if n >= 0x80000000 else n


def _u32(n: int) -> int:
    return n & 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return _i32(_i32(a) * _i32(b))


def _xor32(a: int, b: int) -> int:
    return _i32(_u32(a) ^ _u32(b))


def _mulberry32(seed: int):
    state = _u32(seed)

    def rand() -> float:
        nonlocal state
        state = _u32(state + 0x6D2B79F5)
        x = _i32(state)
        t = _imul(_xor32(x, _u32(x) >> 15), 1 | x)
        mixed = _imul(_xor32(t, _u32(t) >> 7), 61 | t)
        t = _xor32(t + mixed, t)
        return _u32(_xor32(t, _u32(t) >> 14)) / 4294967296

    return rand


def _hash_str(text: str) -> int:
    h = 2166136261
    for ch in text:
        h = _xor32(h, ord(ch))
        h = _imul(h, 16777619)
    return _u32(h)


def _gauss(rand) -> float:
    u = 0.0
    v = 0.0
    while not u:
        u = rand()
    while not v:
        v = rand()
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)


def _to_pm(z: float) -> int:
    return min(999, max(1, round(1000 / (1 + math.exp(-z)))))


def _num(value: float) -> str:
    n = int(round(value))
    sign = "-" if n < 0 else ""
    digits = str(abs(n))
    if len(digits) <= 3:
        return sign + digits
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.append(head[-2:])
        head = head[:-2]
    if head:
        groups.append(head)
    return sign + ",".join(reversed(groups)) + "," + tail


def _pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.1f}%"


def _shuffle(items: list[dict[str, str]], seed: int) -> list[dict[str, str]]:
    rand = _mulberry32(seed)
    out = items[:]
    for i in range(len(out) - 1, 0, -1):
        j = int(rand() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out


_DEPT_CACHE: list[dict[str, Any]] | None = None

_GLOSS = {
    "civil": {"Safe": "Check closed, structure can stay in service", "Unsafe": "Defect that needs repair or restricted use"},
    "mechanical": {"Normal": "Readings inside duty", "Fault": "Vibration, heat, or wear that needs a stop"},
    "electrical": {"Normal": "Readings stay inside the rating", "Fault": "A stop or extra check is needed"},
    "ece": {"Pass": "Held inside the expected band", "Fail": "Missed spec on the bench or in the field"},
    "cse": {"Bug": "Broken behaviour in a live feature", "Working as Intended": "The product behaved as designed"},
    "it": {"User Error": "The person used the system the wrong way", "System Fault": "The kit or service actually failed"},
    "chemical": {"Normal": "Run stayed in spec", "Abnormal": "Yield, kit, or hazard drifted off spec"},
    "aerospace": {"Serviceable": "Fit to fly this cycle", "Unserviceable": "Hold the aircraft until it is cleared"},
    "automobile": {"Safe to Drive": "The car can leave the bay", "Unsafe to Drive": "Hold the car until the defect is cleared"},
    "biomedical": {"Device Fault": "The hardware itself failed", "No Fault Found": "Nothing wrong with the hardware"},
}

# Visual tokens for the lab. The words, classes, and jobs come from the department files.
_LOOK = {
    "CIVIL": ("civil", "mag", 0.05),
    "MECH": ("mech", "lime", 0.10),
    "EEE": ("eee", "cyan", 0.08),
    "ECE": ("ece", "blue", 0.15),
    "CSE": ("cse", "mag", 0.12),
    "IT": ("it", "amber", 0.06),
    "CHEM": ("chem", "amber", 0.10),
    "AERO": ("aero", "green", 0.04),
    "AUTOMOBILE": ("auto", "mag", 0.14),
    "BME": ("bme", "cyan", 0.18),
}

# Two real jobs per department. The focus label is a class that exists in that CSV.
# Recall job: a miss is the expensive mistake. Precision job: a false alarm is.
_JOBS: dict[str, dict[str, Any]] = {
    "civil": {
        "focus": "Unsafe",
        "recall": {
            "title": "Hold an unsafe structure before it is used",
            "who": "Site engineer, structural inspection",
            "flow": "Every note the model tags Unsafe is held for a structural check before that beam, column, foundation, or bridge stays in service.",
            "miss": "A real defect is called Safe, so the structure stays in use.",
            "fa": "A sound structure is held for an extra inspection.",
            "fn": 500000,
            "fp": 8000,
        },
        "precision": {
            "title": "Automatic closure of the structure",
            "who": "Site manager",
            "flow": "A note tagged Unsafe now automatically closes the structure to traffic or work until the inspection is signed off.",
            "miss": "The note still reaches the engineer on the normal inspection round.",
            "fa": "A safe structure is shut, and the crew and the public wait on a false call.",
            "fn": 12000,
            "fp": 250000,
        },
    },
    "mechanical": {
        "focus": "Fault",
        "recall": {
            "title": "Stop a faulty machine before the next shift",
            "who": "Maintenance lead, rotating equipment",
            "flow": "Notes tagged Fault go to the lead, who checks the pump, gearbox, motor, or bearing before the next shift starts.",
            "miss": "A real fault is called Normal, and the machine fails in service.",
            "fa": "A healthy machine gets a short extra check.",
            "fn": 300000,
            "fp": 1500,
        },
        "precision": {
            "title": "Automatic line stop",
            "who": "Production supervisor",
            "flow": "A note tagged Fault now automatically stops that machine and holds the line until maintenance clears it.",
            "miss": "The note still sits on the maintenance board for the regular round.",
            "fa": "A normal machine is stopped and the line waits for nothing.",
            "fn": 6000,
            "fp": 180000,
        },
    },
    "electrical": {
        "focus": "Fault",
        "recall": {
            "title": "Crew review before peak load",
            "who": "Shift electrician, substation",
            "flow": "Notes tagged Fault go to the shift electrician, who checks the breaker, relay, or panel before the next peak.",
            "miss": "A real fault is called Normal, so the circuit stays in service and can fail to clear the next short.",
            "fa": "A healthy circuit is sent for an extra check by mistake.",
            "fn": 400000,
            "fp": 2000,
        },
        "precision": {
            "title": "Automatic feeder trip",
            "who": "Grid control room",
            "flow": "A note tagged Fault now automatically trips that feeder until a crew confirms the finding.",
            "miss": "The note still reaches the electrician on the scheduled patrol.",
            "fa": "A healthy feeder is switched off and customers lose supply for no reason.",
            "fn": 10000,
            "fp": 350000,
        },
    },
    "ece": {
        "focus": "Fail",
        "recall": {
            "title": "Hold a board that missed spec",
            "who": "Hardware engineer, board bring-up",
            "flow": "Tickets tagged Fail go to a bench engineer, who checks the board, connector, or GPS receiver before the device ships.",
            "miss": "A real miss is filed as Pass, and the bad unit stays in use.",
            "fa": "A passing unit occupies the bench for a short look.",
            "fn": 150000,
            "fp": 800,
        },
        "precision": {
            "title": "Automatic technician dispatch",
            "who": "Field operations",
            "flow": "Every ticket tagged Fail now sends a technician out to the field unit or the test jig.",
            "miss": "The ticket stays in the queue and is picked up on the next bench round.",
            "fa": "A technician is sent for a passing note that never needed a visit.",
            "fn": 3000,
            "fp": 40000,
        },
    },
    "cse": {
        "focus": "Bug",
        "recall": {
            "title": "Triage a live defect before it ships",
            "who": "On-call engineer, product engineering",
            "flow": "Tickets tagged Bug go to the on-call board within a day, ahead of Working as Intended notes.",
            "miss": "A real defect is filed as expected behaviour and stays open.",
            "fa": "An expected-behaviour note spends ten minutes on the on-call board.",
            "fn": 400000,
            "fp": 1000,
        },
        "precision": {
            "title": "Automatic service rollback",
            "who": "On-call administrator",
            "flow": "A ticket tagged Bug now rolls that service back until the report is confirmed.",
            "miss": "The ticket still goes through normal triage the next morning.",
            "fa": "A Working as Intended note takes the service down in front of users.",
            "fn": 5000,
            "fp": 300000,
        },
    },
    "it": {
        "focus": "System Fault",
        "recall": {
            "title": "Fix the kit before the next class",
            "who": "IT service desk",
            "flow": "Tickets tagged System Fault go to the kit desk, who can restore wifi, printers, or laptops before the next session.",
            "miss": "A real kit failure is filed as User Error, and the person stays stuck.",
            "fa": "A coaching ticket spends a few minutes on the kit desk.",
            "fn": 80000,
            "fp": 500,
        },
        "precision": {
            "title": "Automatic service disable",
            "who": "Campus infrastructure lead",
            "flow": "A ticket tagged System Fault now takes that service offline until someone confirms it.",
            "miss": "The ticket still reaches the service desk in the normal queue.",
            "fa": "A working service is disabled and logins stop for that building.",
            "fn": 2000,
            "fp": 120000,
        },
    },
    "chemical": {
        "focus": "Abnormal",
        "recall": {
            "title": "Safety-officer check on the unit",
            "who": "Plant safety officer",
            "flow": "Logs tagged Abnormal go straight to the safety officer, ahead of Normal runs.",
            "miss": "A real drift is filed as Normal and the unit keeps running.",
            "fa": "An in-spec reading gets a short detector walk.",
            "fn": 800000,
            "fp": 2000,
        },
        "precision": {
            "title": "Automatic emergency shutdown",
            "who": "Process control room",
            "flow": "A log tagged Abnormal now trips the emergency shutdown on that unit.",
            "miss": "The safety officer still sees the log on the hourly round.",
            "fa": "A Normal note dumps the batch and the restart takes days.",
            "fn": 20000,
            "fp": 1500000,
        },
    },
    "aerospace": {
        "focus": "Unserviceable",
        "recall": {
            "title": "Sign-off before the next flight",
            "who": "Chief maintenance engineer, hangar",
            "flow": "Notes tagged Unserviceable must be signed off before release. Serviceable notes follow the normal bay.",
            "miss": "A stop-the-flight defect is filed as Serviceable, and the aircraft is released.",
            "fa": "A fit-to-fly note gets a short extra check by the chief engineer.",
            "fn": 1000000,
            "fp": 2500,
        },
        "precision": {
            "title": "Automatic grounding",
            "who": "Airline operations control",
            "flow": "A note tagged Unserviceable now grounds the aircraft and cancels the next flight.",
            "miss": "The chief engineer still reviews every note before the daily check.",
            "fa": "A healthy aircraft is grounded and the next flight waits in the hangar.",
            "fn": 20000,
            "fp": 1200000,
        },
    },
    "automobile": {
        "focus": "Unsafe to Drive",
        "recall": {
            "title": "Hold the car before handover",
            "who": "Floor manager, service centre",
            "flow": "Job-card notes tagged Unsafe to Drive get a bay test before handover. Safe to Drive cars leave on the normal path.",
            "miss": "A real no-go defect is filed as Safe to Drive, and the customer drives away with it.",
            "fa": "A sound car takes a short extra look in the bay.",
            "fn": 300000,
            "fp": 800,
        },
        "precision": {
            "title": "Automatic hold under warranty",
            "who": "Warranty claims desk",
            "flow": "A note tagged Unsafe to Drive now holds the car and opens a warranty job until it is cleared.",
            "miss": "The technician still inspects the car during the standard service.",
            "fa": "A working car is held because the note was really a minor complaint.",
            "fn": 1500,
            "fp": 18000,
        },
    },
    "biomedical": {
        "focus": "Device Fault",
        "recall": {
            "title": "Pull a failed device before the next patient",
            "who": "Clinical engineer, hospital",
            "flow": "Notes tagged Device Fault are inspected before that pump, monitor, or ventilator is used again. No Fault Found notes follow the normal bench.",
            "miss": "A broken device is filed as No Fault Found and is used on a patient.",
            "fa": "A use-issue note gets a short bench check.",
            "fn": 1000000,
            "fp": 1500,
        },
        "precision": {
            "title": "Automatic device lockout",
            "who": "Equipment manager",
            "flow": "A note tagged Device Fault now locks the device out of clinical use until the vendor re-certifies it.",
            "miss": "The engineer still catches it on the daily inspection round.",
            "fa": "A working device is pulled for days because the note was only a setup issue.",
            "fn": 10000,
            "fp": 250000,
        },
    },
}


def _sample_note(dataset_id: str, label: str) -> str:
    path = datasets.dataset_path(dataset_id)
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if str(row.get("label", "")).strip() != label:
                continue
            text = " ".join(str(row.get("text", "")).split())
            return text[:240]
    return ""


def _load_depts() -> list[dict[str, Any]]:
    global _DEPT_CACHE
    if _DEPT_CACHE is not None:
        return _DEPT_CACHE
    built: list[dict[str, Any]] = []
    for dataset_id in datasets.DEPARTMENT_ORDER:
        code = datasets.SHORT_NAMES[dataset_id]
        icon, color, diff = _LOOK[code]
        job = _JOBS[dataset_id]
        focus = job["focus"]
        classes = datasets.CLASSES[dataset_id]
        if focus not in classes:
            raise ValueError(f"{dataset_id} focus {focus} is not in the dataset")
        gloss = _GLOSS[dataset_id]
        built.append(
            {
                "code": code,
                "name": datasets.FULL_NAMES[dataset_id],
                "icon": icon,
                "color": color,
                "diff": diff,
                "target": focus,
                "classes": [[name, gloss.get(name, datasets.THEMES[dataset_id])] for name in classes],
                "sample": _sample_note(dataset_id, focus),
                "source": datasets.SOURCES[dataset_id],
                "scen": {"recall": job["recall"], "precision": job["precision"]},
            }
        )
    _DEPT_CACHE = built
    return built


def _dept(code: str) -> tuple[int, dict[str, Any]]:
    for index, dept in enumerate(_load_depts()):
        if dept["code"] == code:
            return index, dept
    raise ValueError(f"Unknown department: {code}")


def _public_dept(dept: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": dept["code"],
        "name": dept["name"],
        "icon": dept["icon"],
        "color": dept["color"],
        "target": dept["target"],
        "classes": dept["classes"],
        "sample": dept["sample"],
    }


def catalog() -> dict[str, Any]:
    return {"departments": [_public_dept(dept) for dept in _load_depts()]}


def _gen_model(dept_idx: int, method: str) -> dict[str, Any]:
    depts = _load_depts()
    dept = depts[dept_idx]
    diff = float(dept["diff"])
    emb = method == "emb"
    rand = _mulberry32(_hash_str(f"{dept['code']}|{method}"))
    mp = (1.75 if emb else 1.15) - diff
    mn = (-2.0 if emb else -1.45) + diff
    sd = 1.15 if emb else 1.2
    hard = (-0.6 if emb else -0.3) + diff * 0.5
    pos = [_to_pm(mp + sd * _gauss(rand)) for _ in range(1000)]
    neg = [_to_pm((hard if i < 360 else mn) + sd * _gauss(rand)) for i in range(3000)]
    return {"pos": pos, "neg": neg, "method": method}


def _cutoff_k(baseline: float | None) -> int:
    """Exercise 2's decision cutoff, as a threshold index from 1 to 99."""
    if baseline is None:
        return 50
    try:
        k = int(round(float(baseline) * 100))
    except (TypeError, ValueError):
        return 50
    return min(99, max(1, k))


def _baseline_k(model: dict[str, Any]) -> int:
    try:
        k = int(model.get("anchor_k") or 50)
    except (TypeError, ValueError):
        k = 50
    return min(99, max(1, k))


def _at_baseline(model: dict[str, Any]) -> dict[str, Any]:
    return _stats(model, _baseline_k(model))


def _rates(tp: int, fp: int, fn: int, tn: int, k: int) -> dict[str, Any]:
    """Precision, recall, F1 and accuracy from one confusion matrix.

    No flags means precision is 0, the same number the quiz marks as correct.
    F1 is the harmonic mean, and 0 when either input is 0.
    """
    positives = tp + fn
    negatives = fp + tn
    total = positives + negatives
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / positives if positives else 0.0
    f1 = (2 * prec * rec) / (prec + rec) if prec + rec else 0.0
    acc = (tp + tn) / total if total else 0.0
    return {
        "k": k,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "prec": prec,
        "rec": rec,
        "f1": f1,
        "acc": acc,
        "P": positives,
        "N": negatives,
    }


def _anchor_from_matrix(matrix: list[list[int]], focus_index: int, k: int) -> dict[str, Any]:
    size = len(matrix)
    tp = int(matrix[focus_index][focus_index])
    fn = sum(int(matrix[focus_index][col]) for col in range(size) if col != focus_index)
    fp = sum(int(matrix[row][focus_index]) for row in range(size) if row != focus_index)
    total = sum(int(cell) for row in matrix for cell in row)
    positives = tp + fn
    tn = total - positives - fp
    return _rates(tp, fp, fn, tn, k)


def _stats(model: dict[str, Any], k: int) -> dict[str, Any]:
    anchor = model.get("anchor")
    if k == _baseline_k(model) and anchor is not None:
        return anchor
    cut = k * 10
    tp = sum(1 for p in model["pos"] if p >= cut)
    fp = sum(1 for n in model["neg"] if n >= cut)
    positives = len(model["pos"])
    negatives = len(model["neg"])
    return _rates(tp, fp, positives - tp, negatives - fp, k)


def _curve(model: dict[str, Any]) -> list[dict[str, Any]]:
    return [_stats(model, k) for k in range(1, 100)]


def _meets(row: dict[str, Any], key: str, target: float) -> bool:
    if key == "recall":
        return row["rec"] >= target
    return row["prec"] is not None and row["prec"] >= target


def _secondary(row: dict[str, Any], key: str) -> float:
    if key == "recall":
        return row["prec"] or 0.0
    return row["rec"]


def _primary(row: dict[str, Any], key: str) -> float:
    if key == "recall":
        return row["rec"]
    return row["prec"] or 0.0


def _best_at(curve: list[dict[str, Any]], key: str, target: float) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    for row in curve:
        if not _meets(row, key, target):
            continue
        if key == "precision" and row["rec"] < 0.05:
            continue
        if best is None:
            best = row
            continue
        secondary_gap = _secondary(row, key) - _secondary(best, key)
        if secondary_gap > 1e-12 or (abs(secondary_gap) <= 1e-12 and _primary(row, key) > _primary(best, key) + 1e-12):
            best = row
    return best


def _mission(curve: list[dict[str, Any]], key: str) -> dict[str, Any]:
    target = 0.95
    if _best_at(curve, key, target) is None:
        peak = 0.0
        for row in curve:
            if key == "precision":
                if row["rec"] >= 0.1 and row["prec"] is not None:
                    peak = max(peak, row["prec"])
            elif (row["prec"] or 0) >= 0.05:
                peak = max(peak, row["rec"])
        target = math.floor(peak * 100) / 100 or 0.01
    best = _best_at(curve, key, target) or curve[0]
    return {"tgt": target, "best": best}


def _stars(model: dict[str, Any], key: str, locked: int, mission: dict[str, Any]) -> int:
    gap = _secondary(mission["best"], key) - _secondary(_stats(model, locked), key)
    if gap <= 0.01:
        return 3
    if gap <= 0.05:
        return 2
    return 1


def _order(dept_idx: int) -> tuple[str, str]:
    return ("recall", "precision") if dept_idx % 2 == 0 else ("precision", "recall")


def _public_scenario(scenario: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": scenario["title"],
        "who": scenario["who"],
        "flow": scenario["flow"],
        "miss": scenario["miss"],
        "fa": scenario["fa"],
        "fn": scenario["fn"],
        "fp": scenario["fp"],
    }


def _reasons(model: dict[str, Any], dept: dict[str, Any], key: str) -> list[dict[str, str]]:
    target = dept["target"]
    row = _at_baseline(model)
    prec = row["prec"] or 0
    rec = row["rec"]
    if abs(prec - rec) < 0.0005:
        number_why = f"Precision and recall are the same ({_pct(prec)}), so either one shows the model at its best."
    elif prec > rec:
        number_why = f"My precision is the higher number ({_pct(prec)}), so it shows the model at its best."
    else:
        number_why = f"My recall is the higher number ({_pct(rec)}), so it shows the model at its best."
    recall_why = (
        f"A miss costs this team far more than a false alarm, so we must catch as many real {target} notes as we can."
    )
    precision_why = (
        f"A false alarm costs this team far more than a miss, so every {target} flag must be right."
    )
    raw = [
        {"real": "ok", "text": recall_why if key == "recall" else precision_why},
        {"real": "flip", "text": precision_why if key == "recall" else recall_why},
        {
            "real": "num",
            "text": number_why,
        },
        {
            "real": "acc",
            "text": f"Accuracy is already {_pct(row['acc'])}, so the choice between the two doesn’t matter much.",
        },
    ]
    shuffled = _shuffle(raw, _hash_str(dept["code"] + key))
    labels = ["a", "b", "c", "d"]
    return [{"id": labels[i], "real": item["real"], "text": item["text"]} for i, item in enumerate(shuffled)]


def _critique(reason_real: str, key: str, model: dict[str, Any]) -> str:
    row = _at_baseline(model)
    if reason_real == "flip":
        if key == "recall":
            return "That argues for precision. Here a false alarm is cheap; the expensive mistake is a miss."
        return "That argues for recall. Here a miss is caught later; the expensive mistake is a false alarm."
    if reason_real == "num":
        return "Which number is higher says nothing about the job. The metric is chosen from what each mistake costs."
    if reason_real == "acc":
        share = round((row["N"] / (row["P"] + row["N"])) * 100)
        return (
            f"{_num(row['N'])} of {_num(row['P'] + row['N'])} notes are “not this label”, so never flagging anything "
            f"already scores {share}% accuracy. Accuracy hides the mistakes this team cares about."
        )
    return "You compared what each mistake costs. That’s exactly how the choice is made."


def _quiz_public(model: dict[str, Any], dept: dict[str, Any]) -> list[dict[str, str]]:
    row = _at_baseline(model)
    target = dept["target"]
    name = dept["name"]
    return [
        {
            "key": "prec",
            "title": "Precision",
            "question": (
                f"On this {name} confusion matrix, in the {target} column, "
                f"what share of the notes predicted {target} really are {target}?"
            ),
        },
        {
            "key": "rec",
            "title": "Recall",
            "question": (
                f"On this {name} confusion matrix, in the {target} row, "
                f"what share of the real {target} notes did the model catch?"
            ),
        },
        {
            "key": "acc",
            "title": "Accuracy trap",
            "question": (
                f"On these {name} notes, count every note that is not {target} as correct and every real {target} note as wrong. "
                f"What accuracy is that on these {_num(row['P'] + row['N'])} notes?"
            ),
        },
    ]


def _quiz_grade(model: dict[str, Any], dept: dict[str, Any], index: int) -> dict[str, Any]:
    row = _at_baseline(model)
    target = dept["target"]
    base = row["N"] / (row["P"] + row["N"])
    if index == 0:
        return {
            "ans": (row["prec"] or 0) * 100,
            "exp": (
                f"{_num(row['tp'])} of the {_num(row['tp'] + row['fp'])} notes it flagged were really {target}. "
                "Precision answers: when the model raises a flag, how often is it right?"
            ),
            "formula": f"Precision = TP ÷ (TP + FP) = {_num(row['tp'])} ÷ {_num(row['tp'] + row['fp'])} = {_pct(row['prec'])}",
        }
    if index == 1:
        return {
            "ans": row["rec"] * 100,
            "exp": (
                f"It caught {_num(row['tp'])} of the {_num(row['P'])} real {target} notes and missed {_num(row['fn'])}. "
                "Recall answers: of all the real ones, how many did we find?"
            ),
            "formula": f"Recall = TP ÷ (TP + FN) = {_num(row['tp'])} ÷ {_num(row['P'])} = {_pct(row['rec'])}",
        }
    if index == 2:
        return {
            "ans": base * 100,
            "exp": (
                f"It gets all {_num(row['N'])} “not {target}” notes right and every {target} note wrong: "
                f"that lazy score is {_pct(base)}. The scorecard’s Accuracy is the model’s own accuracy, "
                f"(TP + TN) ÷ all = {_pct(row['acc'])}. A high accuracy can still hide a useless model."
            ),
            "formula": (
                f"Lazy score = non-{target} notes ÷ all = {_num(row['N'])} ÷ {_num(row['P'] + row['N'])} = {_pct(base)}"
            ),
        }
    raise ValueError("Unknown question")


def _parse_answer(raw: str, expected_pct: float) -> float | None:
    cleaned = raw.replace("%", "").replace(",", "").replace(" ", "")
    if not cleaned:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    if 0 < value <= 1 and expected_pct > 1.5:
        value *= 100
    return value


def _round_view(run: dict[str, Any], round_no: int) -> dict[str, Any]:
    slot = run["rounds"][round_no]
    dept = run["dept"]
    return {
        "round": round_no,
        "scenario": _public_scenario(dept["scen"][slot["key"]]),
        "missionTgt": slot["mission"]["tgt"],
        "reasons": [{"id": item["id"], "text": item["text"]} for item in slot["reasons"]],
    }


def _curve_public(curve: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "k": row["k"],
            "tp": row["tp"],
            "fp": row["fp"],
            "fn": row["fn"],
            "tn": row["tn"],
            "prec": row["prec"],
            "rec": row["rec"],
            "f1": row["f1"],
            "acc": row["acc"],
            "P": row["P"],
            "N": row["N"],
        }
        for row in curve
    ]


def _run_path(run_id: str) -> Path:
    safe = "".join(ch for ch in run_id if ch.isalnum())
    return _RUN_DIR / f"{safe}.json"


def _trim_runs() -> None:
    if not _RUN_DIR.exists():
        return
    files = sorted(_RUN_DIR.glob("*.json"), key=lambda path: path.stat().st_mtime)
    extra = len(files) - _RUN_CAP
    for path in files[: max(0, extra)]:
        path.unlink(missing_ok=True)


def _save_run(run: dict[str, Any]) -> None:
    _RUN_DIR.mkdir(parents=True, exist_ok=True)
    path = _run_path(run["id"])
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(run), encoding="utf-8")
    temporary.replace(path)
    _trim_runs()


def _load_run(run_id: str) -> dict[str, Any] | None:
    path = _run_path(run_id)
    if not path.exists():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(loaded, dict) or loaded.get("id") != run_id:
        return None
    raw_rounds = loaded.get("rounds")
    if isinstance(raw_rounds, dict):
        loaded["rounds"] = {int(key): value for key, value in raw_rounds.items()}
    return loaded


def _owned(run_id: str, session_id: str, project_id: str) -> dict[str, Any]:
    run = _RUNS.get(run_id)
    if run is None:
        run = _load_run(run_id)
        if run is not None:
            with _LOCK:
                _RUNS[run_id] = run
    if not run or run["session_id"] != session_id or run["project_id"] != project_id:
        raise LookupError("Score this model again before answering.")
    return run


def _pm(probability: float) -> int:
    return min(999, max(1, round(float(probability) * 1000)))


def _from_holdout(pos: list[float], neg: list[float], method: str) -> dict[str, Any]:
    if len(pos) < 1 or len(neg) < 1:
        raise ValueError("Exercise 2 did not save held-out scores for this label.")
    if len(pos) > 8000 or len(neg) > 8000:
        raise ValueError("Held-out score list is too large.")
    return {"pos": [_pm(p) for p in pos], "neg": [_pm(p) for p in neg], "method": method}


def _retarget(dept: dict[str, Any], focus: str | None) -> dict[str, Any]:
    if not focus or focus == dept["target"]:
        return dept
    old = str(dept["target"])
    cloned = json.loads(json.dumps(dept))

    def walk(node: Any) -> Any:
        if isinstance(node, str):
            return node.replace(old, focus)
        if isinstance(node, list):
            return [walk(item) for item in node]
        if isinstance(node, dict):
            return {key: walk(value) for key, value in node.items()}
        return node

    cloned = walk(cloned)
    cloned["target"] = focus
    return cloned


def score_model(
    session_id: str,
    project_id: str,
    department: str,
    method: str,
    holdout_pos: list[float] | None = None,
    holdout_neg: list[float] | None = None,
    focus: str | None = None,
    matrix: list[list[int]] | None = None,
    class_names: list[str] | None = None,
    baseline: float | None = None,
) -> dict[str, Any]:
    if method not in ("emb", "tfidf"):
        raise ValueError("Method must be emb or tfidf.")
    dept_idx, dept = _dept(department)
    dept = _retarget(dept, focus)
    if holdout_pos is not None or holdout_neg is not None:
        model = _from_holdout(holdout_pos or [], holdout_neg or [], method)
    else:
        model = _gen_model(dept_idx, method)
    model["anchor_k"] = _cutoff_k(baseline)
    if matrix and class_names and focus:
        names = [str(name) for name in class_names]
        focus_index = next((i for i, name in enumerate(names) if name.lower() == focus.lower()), -1)
        square = len(matrix) == len(names) and all(len(row) == len(names) for row in matrix)
        if focus_index >= 0 and square:
            model["anchor"] = _anchor_from_matrix(matrix, focus_index, model["anchor_k"])
    curve = _curve(model)
    order = _order(dept_idx)
    rounds = {}
    for round_no, key in enumerate(order, start=1):
        rounds[round_no] = {
            "key": key,
            "mission": _mission(curve, key),
            "reasons": _reasons(model, dept, key),
        }
    run_id = uuid.uuid4().hex
    run = {
        "id": run_id,
        "session_id": session_id,
        "project_id": project_id,
        "dept_idx": dept_idx,
        "dept": dept,
        "method": method,
        "model": model,
        "curve": curve,
        "rounds": rounds,
        "quiz_done": [False, False, False],
    }
    with _LOCK:
        _RUNS[run_id] = run
    try:
        _save_run(run)
    except (OSError, TypeError, ValueError):
        pass
    total = len(model["pos"]) + len(model["neg"])
    return {
        "runId": run_id,
        "method": method,
        "department": _public_dept(dept),
        "total": total,
        "positives": len(model["pos"]),
        "curve": _curve_public(curve),
        "quiz": _quiz_public(model, dept),
        "round": _round_view(run, 1),
    }


def grade_answer(session_id: str, project_id: str, run_id: str, index: int, raw: str) -> dict[str, Any]:
    if index not in (0, 1, 2):
        raise ValueError("Question index must be 0, 1, or 2.")
    run = _owned(run_id, session_id, project_id)
    graded = _quiz_grade(run["model"], run["dept"], index)
    parsed = _parse_answer(raw, graded["ans"])
    if parsed is None:
        return {"accepted": False}
    ok = abs(parsed - graded["ans"]) <= ANSWER_TOLERANCE
    run["quiz_done"][index] = True
    return {
        "accepted": True,
        "ok": ok,
        "value": parsed,
        "answer": graded["ans"],
        "explanation": graded["exp"],
        "formula": graded["formula"],
    }


def grade_choice(
    session_id: str,
    project_id: str,
    run_id: str,
    round_no: int,
    metric: str,
    reason_id: str,
) -> dict[str, Any]:
    if metric not in ("precision", "recall"):
        raise ValueError("Pick precision or recall.")
    if round_no not in (1, 2):
        raise ValueError("Round must be 1 or 2.")
    run = _owned(run_id, session_id, project_id)
    slot = run["rounds"][round_no]
    match = next((item for item in slot["reasons"] if item["id"] == reason_id), None)
    if match is None:
        raise ValueError("Pick one of the reasons shown.")
    key = slot["key"]
    scenario = run["dept"]["scen"][key]
    ratio = round(scenario["fn"] / scenario["fp"]) if key == "recall" else round(scenario["fp"] / scenario["fn"])
    slot["picked"] = metric
    slot["reasonReal"] = match["real"]
    slot["reasonId"] = reason_id
    try:
        _save_run(run)
    except (OSError, TypeError, ValueError):
        pass
    return {
        "needed": key,
        "metricCorrect": metric == key,
        "reasonCorrect": match["real"] == "ok",
        "critique": _critique(match["real"], key, run["model"]),
        "ratio": ratio,
    }


def lock_threshold(
    session_id: str,
    project_id: str,
    run_id: str,
    round_no: int,
    threshold: int,
) -> dict[str, Any]:
    if round_no not in (1, 2):
        raise ValueError("Round must be 1 or 2.")
    if threshold < 1 or threshold > 99:
        raise ValueError("Threshold must be between 1 and 99.")
    run = _owned(run_id, session_id, project_id)
    slot = run["rounds"][round_no]
    if "picked" not in slot:
        raise ValueError("Lock a metric before the threshold.")
    key = slot["key"]
    mission = slot["mission"]
    current = _stats(run["model"], threshold)
    if not _meets(current, key, mission["tgt"]):
        raise ValueError("The goal is not met at this threshold.")
    stars = _stars(run["model"], key, threshold, mission)
    baseline = _at_baseline(run["model"])
    best = mission["best"]
    slot["locked"] = threshold
    slot["stars"] = stars
    try:
        _save_run(run)
    except (OSError, TypeError, ValueError):
        pass
    return {
        "stars": stars,
        "locked": threshold,
        "baseline": _curve_public([baseline])[0],
        "yours": _curve_public([current])[0],
        "best": _curve_public([best])[0],
        "secondaryYours": _secondary(current, key),
        "secondaryBest": _secondary(best, key),
    }


def next_round(session_id: str, project_id: str, run_id: str) -> dict[str, Any]:
    run = _owned(run_id, session_id, project_id)
    slot = run["rounds"][1]
    if "locked" not in slot:
        raise ValueError("Finish round 1 before round 2.")
    return _round_view(run, 2)


def finish(session_id: str, project_id: str, run_id: str, read_score: int) -> dict[str, Any]:
    run = _owned(run_id, session_id, project_id)
    if "locked" not in run["rounds"][2]:
        raise ValueError("Finish both rounds first.")
    bonus = []
    total = 0
    rounds_out = []
    for round_no in (1, 2):
        slot = run["rounds"][round_no]
        key = slot["key"]
        scenario = run["dept"]["scen"][key]
        points = (1 if slot.get("picked") == key else 0) + (1 if slot.get("reasonReal") == "ok" else 0) + slot["stars"]
        total += points
        bonus.append(
            {
                "title": scenario["title"],
                "yours": _pct(_secondary(slot["mission"]["best"], key)),
            }
        )
        locked = slot["locked"]
        row = _stats(run["model"], locked)
        rounds_out.append(
            {
                "title": scenario["title"],
                "needed": key,
                "locked": locked,
                "prec": row["prec"],
                "rec": row["rec"],
                "points": points,
                "stars": slot["stars"],
            }
        )
    return {
        "department": run["dept"]["code"],
        "method": run["method"],
        "readScore": read_score,
        "total": total,
        "rounds": rounds_out,
        "bonus": bonus,
    }


def drop_runs(session_id: str, project_id: str) -> None:
    with _LOCK:
        stale = [key for key, run in _RUNS.items() if run["session_id"] == session_id and run["project_id"] == project_id]
        for key in stale:
            _RUNS.pop(key, None)
    for key in stale:
        _run_path(key).unlink(missing_ok=True)
