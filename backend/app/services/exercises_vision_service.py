"""Exercise 4: image classification on uploaded department images.

Images are fit into a 64×64 greyscale canvas (letterboxed — no crop, only
downscaled when larger). A validation slice (~15% of Training Data) is held
out of the fit pool and scored while the model learns. Testing Data is
scored once, after training.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import math
import os
import re
import shutil
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import SGDClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler

_SIDE = 64
_PIXELS = _SIDE * _SIDE

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parents[1] / "data" / "exercises" / "runtime" / "vision"
_MAX_FILES = 8000
_MAX_BYTES = 80 * 1024 * 1024
_MAX_FILE = 8 * 1024 * 1024
_MAX_PER_SPLIT = 2000
_MAX_CLASSES = 40
_MIN_TRAIN = 5

_IMG_RE = re.compile(r"\.(png|jpe?g|bmp|gif|webp)$", re.I)
_TRAIN_RE = re.compile(r"^(train|training)([\s_-]*(data|set|images))?$", re.I)
_TEST_RE = re.compile(r"^(test|testing|val|valid|validation)([\s_-]*(data|set|images))?$", re.I)
_SAFE = re.compile(r"[^A-Za-z0-9_-]+")

DRIVE_ROOT = "https://drive.google.com/drive/folders/1kv8UqLoTEc62nE0_7DUGDOy1uo932xXS"

DEPARTMENTS: dict[str, dict[str, object]] = {
    "civil": {
        "code": "CIVIL",
        "name": "Civil Engineering",
        "color": "mag",
        "drive": "1VKx_crJ0M9mkst-V1P5CNTJckd6h9xTp",
        "data": "Road pavement survey patches",
        "classes": "Pothole, Crack, Clean asphalt, Road shoulder",
        "sample": ["Pothole", "Crack", "Clean asphalt"],
    },
    "mech": {
        "code": "MECH",
        "name": "Mechanical Engineering",
        "color": "lime",
        "drive": "1YLYhT6ZWcY-Hcf3VSioDkZxw2tuo5Pcv",
        "data": "NEU hot-rolled steel surface defects",
        "classes": "Crazing, Inclusion, Patches, Pitted surface, Rolled-in scale, Scratches",
        "sample": ["Crazing", "Inclusion", "Patches"],
    },
    "eee": {
        "code": "EEE",
        "name": "Electrical Engineering",
        "color": "cyan",
        "drive": "1lltKdOE9cEXIu4fftwF_wYwBJ2L5UTvd",
        "data": "ELPV solar-cell electroluminescence images",
        "classes": "Mono / Poly × working / defective",
        "sample": ["Mono working", "Mono defective", "Poly working"],
    },
    "ece": {
        "code": "ECE",
        "name": "Electronics and Communication",
        "color": "blue",
        "drive": "1O4IjfGre_JHtXFHV2FHS4kK_2OlDYwox",
        "data": "DeepPCB circuit-board defects",
        "classes": "Open circuit, Short, Mouse bite, Spur, Spurious copper, Pin hole",
        "sample": ["Open circuit", "Short", "Mouse bite"],
    },
    "cse": {
        "code": "CSE",
        "name": "Computer Science",
        "color": "mag",
        "drive": "1m3hVCtQyzvguFWDV9U3r7UKLpe6Bt-HD",
        "data": "CIFAR-10 everyday photos",
        "classes": "Airplane, Automobile, Bird, Cat, Deer, Dog, Frog, Horse, Ship, Truck",
        "sample": ["Airplane", "Cat", "Dog"],
    },
    "it": {
        "code": "IT",
        "name": "Information Technology",
        "color": "gold",
        "drive": "1T1arD2WbDgHQL0h86YmQeDSgar40jBvu",
        "data": "Sign Language MNIST hand shapes",
        "classes": "Letters A to K (no J)",
        "sample": ["A", "B", "C"],
    },
    "chem": {
        "code": "CHEM",
        "name": "Chemical Engineering",
        "color": "amber",
        "drive": "1IPD9KL8u7dLM796rDTFb6IyDNcHHOWf3",
        "data": "MixedWM38 semiconductor wafer maps",
        "classes": "Centre, Donut, Edge local, Edge ring, Local, Scratch, Random, No defect",
        "sample": ["Centre", "Donut", "Scratch"],
    },
    "aero": {
        "code": "AERO",
        "name": "Aerospace Engineering",
        "color": "green",
        "drive": "1zO8o6k1EuNYzpFuDRbpQ0hbxbR_vBOs0",
        "data": "MSTAR airborne radar targets",
        "classes": "10 ground vehicles seen by SAR",
        "sample": ["BMP2", "T72", "ZSU23"],
    },
    "automobile": {
        "code": "AUTOMOBILE",
        "name": "Automobile Engineering",
        "color": "mag",
        "drive": "1973nNuokVXTqgXKJBuKngYraValv8JUh",
        "data": "GTSRB traffic signs",
        "classes": "Speed limits 30–80, Stop, Give way, No entry and more",
        "sample": ["Stop", "Speed 30", "No entry"],
    },
    "bme": {
        "code": "BME",
        "name": "Biomedical Engineering",
        "color": "cyan",
        "drive": "1TrNPd1jicX38ttYu0ANjvPXRJqJPqW3f",
        "data": "BloodMNIST blood-cell microscopy",
        "classes": "Basophil, Eosinophil, Erythroblast and 5 more",
        "sample": ["Basophil", "Lymphocyte", "Neutrophil"],
    },
}

MODEL_ORDER = ("knn", "svm", "rf", "mlp", "cnn")

_PARAM_OPTS: dict[str, dict[str, list[object]]] = {
    "knn": {
        "k": [1, 3, 5, 7, 11, 15],
        "metric": ["euclidean", "manhattan", "cosine"],
        "weights": ["uniform", "distance"],
    },
    "svm": {
        "C": [0.01, 0.1, 1, 10],
        "epochs": [5, 8, 10, 20, 30],
        "lr": [0.001, 0.005, 0.01, 0.05],
        "scale": ["on", "off"],
    },
    "rf": {
        "trees": [10, 25, 50, 100],
        "depth": [4, 8, 12, 16],
        "mtry": ["sqrt", "log2", "10%"],
        "leaf": [1, 2, 5, 10],
        "boot": ["on", "off"],
    },
    "mlp": {
        "layers": [1, 2],
        "units": [32, 64, 128, 256],
        "act": ["relu", "tanh", "sigmoid"],
        "dropout": [0, 0.2, 0.4],
        "epochs": [5, 8, 12, 20],
        "lr": [0.0005, 0.001, 0.005],
        "batch": [16, 32, 64],
    },
    "cnn": {
        "filters": [4, 8, 16],
        "kernel": [3, 5],
        "pool": ["max", "avg"],
        "dense": [32, 64, 128],
        "epochs": [5, 8, 12],
        "lr": [0.0005, 0.001, 0.003],
        "batch": [16, 32, 64],
    },
}

_DEFAULTS: dict[str, dict[str, object]] = {
    # Defaults favour generalisation over memorising the training pool.
    "knn": {"k": 11, "metric": "euclidean", "weights": "uniform"},
    "svm": {"C": 0.01, "epochs": 8, "lr": 0.005, "scale": "on"},
    "rf": {"trees": 25, "depth": 8, "mtry": "sqrt", "leaf": 5, "boot": "on"},
    "mlp": {"layers": 1, "units": 64, "act": "relu", "dropout": 0.4, "epochs": 8, "lr": 0.001, "batch": 32},
    "cnn": {"filters": 4, "kernel": 3, "pool": "max", "dense": 32, "epochs": 5, "lr": 0.001, "batch": 32},
}

_FRACS = (0.25, 0.5, 1.0)
# Keep temperatures moderate so probabilities stay honest (tiny/huge values over-peak confidence).
_TEMPS = (1.0, 1.25, 1.5, 2.0, 2.5)


class VisionError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def catalog() -> dict[str, object]:
    departments = []
    for key, row in DEPARTMENTS.items():
        departments.append(
            {
                "id": key,
                "code": row["code"],
                "name": row["name"],
                "color": row["color"],
                "drive": row["drive"],
                "data": row["data"],
                "classes": row["classes"],
                "sampleClasses": row["sample"],
            }
        )
    return {"driveRoot": DRIVE_ROOT, "departments": departments, "models": list(MODEL_ORDER)}


def _safe(text: str) -> str:
    cleaned = _SAFE.sub("", text)[:80]
    return cleaned or "x"


def _slot(session_id: str, project_id: str) -> Path:
    return _ROOT / _safe(session_id) / _safe(project_id)


def _short(name: str) -> str:
    return name if len(name) <= 11 else name[:10] + "…"


def _py(value: object) -> object:
    if isinstance(value, np.ndarray):
        return _py(value.tolist())
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, dict):
        return {str(k): _py(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_py(v) for v in value]
    return value


def _num(value: float, places: int = 4) -> float:
    if not math.isfinite(value):
        return 0.0
    return round(float(value), places)


def _match_opt(value: object, options: list[object]) -> object:
    for opt in options:
        if isinstance(opt, str):
            if value == opt:
                return opt
            continue
        try:
            if abs(float(value) - float(opt)) < 1e-9:
                return opt if not isinstance(opt, float) else float(opt)
        except (TypeError, ValueError):
            continue
    raise VisionError(f"Unknown option {value!r}. Choose one of {options}.")


def resolve_params(model: str, raw: dict[str, object] | None) -> dict[str, object]:
    if model not in _PARAM_OPTS:
        raise VisionError("Choose k-NN, SVM, Random Forest, MLP, or CNN.")
    spec = _PARAM_OPTS[model]
    base = dict(_DEFAULTS[model])
    incoming = raw or {}
    for key, options in spec.items():
        if key not in incoming or incoming[key] is None:
            continue
        base[key] = _match_opt(incoming[key], options)
    return base


def _split_name(name: str) -> str | None:
    if _TRAIN_RE.match(name):
        return "train"
    if _TEST_RE.match(name):
        return "test"
    return None


def classify_path(path: str, forced: str | None) -> tuple[str | None, str] | None:
    """Label a file from its folders.

    Letter B/img.png → train, Letter B. One folder is one class.
    Letters/Letter A/img.png → train, Letter A. Each subfolder is a class.
    Letters/Letter A/batch/img.png → train, Letter A.
    Training Data/Pothole/img.png → train, Pothole.
    """
    parts = [part for part in path.replace("\\", "/").split("/") if part and part != "."]
    dirs = parts[:-1]
    if not dirs:
        return None
    split_at: int | None = None
    split: str | None = None
    for index, name in enumerate(dirs):
        found = _split_name(name)
        if found is None:
            continue
        split_at = index
        split = found
    if split is not None and split_at is not None:
        after = dirs[split_at + 1 :]
        if after:
            return split, after[0].strip()
        if split_at > 0:
            return split, dirs[split_at - 1].strip()
        return None
    chosen = forced if forced in ("train", "test") else "train"
    # The selected folder is the class. When it contains subfolders, each subfolder is a class.
    cls = dirs[0] if len(dirs) == 1 else dirs[1]
    return chosen, cls.strip()


def _file_size(item: StagedItem) -> int:
    if item.size is not None:
        return item.size
    try:
        item.size = item.file.stat().st_size
    except OSError:
        item.size = 0
    return item.size


def _norm_class(name: str) -> str:
    return re.sub(r"[\s_-]+", " ", name.strip().lower())


@dataclass
class StagedItem:
    path: str
    split: str | None
    cls: str
    file: Path
    thumb: str | None = None
    thumb_tried: bool = False
    size: int | None = None


@dataclass
class Dataset:
    key: str
    classes: list[str]
    x: np.ndarray
    y: np.ndarray
    ntr: int
    val_idx: list[int]
    by_class: list[list[int]]
    test_idx: list[int]
    small: list[bool]
    dupes: int


@dataclass
class Run:
    id: str
    no: int
    model: str
    params: dict[str, object]
    n: int
    frac: float
    steps: int
    pool: list[int]
    log: list[dict[str, object]] = field(default_factory=list)
    status: str = "running"
    phase: str = "training"
    error: str | None = None
    done: bool = False
    stopped: bool = False
    val_acc: float | None = None
    res: dict[str, object] | None = None
    viz: dict[str, object] | None = None
    belt: list[int] = field(default_factory=list)
    live_step: int = 0
    live_seen: int = 0
    live_acc: float | None = None
    live_loss: float | None = None
    live_aux: float | None = None
    stop: threading.Event = field(default_factory=threading.Event)
    model_obj: object = None
    scaler: StandardScaler | None = None
    temperature: float = 1.5
    thread: threading.Thread | None = None
    store: Path | None = None
    t0: float | None = None
    runtime_ms: int | None = None


@dataclass
class Lab:
    session_id: str
    project_id: str
    lock: threading.Lock = field(default_factory=threading.Lock)
    department: str | None = None
    staged: list[StagedItem] = field(default_factory=list)
    skipped: int = 0
    uploaded_at: str | None = None
    updated_at: str | None = None
    dropped: set[str] = field(default_factory=set)
    dataset: Dataset | None = None
    runs: list[Run] = field(default_factory=list)
    seq: int = 0
    active: Run | None = None


_GUARD = threading.Lock()
_LABS: dict[tuple[str, str], Lab] = {}
_TF_LOCK = threading.Lock()


def _lab(session_id: str, project_id: str) -> Lab:
    key = (session_id, project_id)
    with _GUARD:
        lab = _LABS.get(key)
        if lab is None:
            lab = _load_lab(session_id, project_id) or Lab(session_id, project_id)
            _LABS[key] = lab
        return lab


def unload_lab(session_id: str, project_id: str) -> None:
    """Drop the in-memory copy and keep the files on disk."""
    with _GUARD:
        _LABS.pop((session_id, project_id), None)


def drop_lab(session_id: str, project_id: str) -> None:
    key = (session_id, project_id)
    with _GUARD:
        lab = _LABS.pop(key, None)
    if lab is not None:
        with lab.lock:
            if lab.active is not None:
                lab.active.stop.set()
    shutil.rmtree(_slot(session_id, project_id), ignore_errors=True)


def _ensure_idle(lab: Lab) -> None:
    active = lab.active
    if active is None:
        return
    # Finished / failed runs must not block the next Train.
    if active.status != "running":
        lab.active = None
        return
    thread = active.thread
    if thread is not None and not thread.is_alive():
        active.status = "error"
        active.phase = "error"
        if not active.error:
            active.error = "Training stopped unexpectedly."
        active.done = False
        lab.active = None
        return
    raise VisionError("Training is still running. Stop it before starting another run.", 409)


def _summary_locked(lab: Lab) -> dict[str, object] | None:
    if not lab.staged:
        return None
    classes: dict[str, dict[str, list[StagedItem]]] = {}
    alias: dict[str, str] = {}
    for item in lab.staged:
        key = _norm_class(item.cls)
        if key not in alias:
            alias[key] = item.cls
        item.cls = alias[key]
        bucket = classes.setdefault(item.cls, {"train": [], "test": [], "pool": []})
        if item.split == "train":
            bucket["train"].append(item)
        elif item.split == "test":
            bucket["test"].append(item)
        else:
            bucket["pool"].append(item)
    names = sorted(classes, key=lambda name: [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)])
    rows = []
    for name in names:
        bucket = classes[name]
        items = bucket["train"] + bucket["test"] + bucket["pool"]
        thumbs: list[str] = []
        for item in items[:5]:
            if not item.thumb_tried:
                item.thumb_tried = True
                item.thumb = _thumb(item.file.read_bytes()) if item.file.exists() else None
            if item.thumb:
                thumbs.append(item.thumb)
        rows.append(
            {
                "name": name,
                "images": len(items),
                "bytes": sum(_file_size(item) for item in items),
                "train": len(bucket["train"]),
                "test": len(bucket["test"]),
                "pool": len(bucket["pool"]),
                "thumbs": thumbs,
                "kept": _norm_class(name) not in lab.dropped,
            }
        )
    kept_rows = [row for row in rows if row["kept"]]
    train_n = sum(int(row["train"]) for row in kept_rows)
    test_n = sum(int(row["test"]) for row in kept_rows)
    pool_n = sum(int(row["pool"]) for row in kept_rows)
    checks = _checks(kept_rows, train_n, test_n, pool_n, lab.skipped)
    if any(not row["kept"] for row in rows) and len([row for row in kept_rows if int(row["train"]) > 0]) < 2:
        checks["list"].append(
            {
                "level": "bad",
                "message": "Tick at least 2 folders. A closed folder is left out of the next step.",
                "action": None,
            }
        )
        checks["ok"] = False
    return {
        "classes": rows,
        "train": train_n,
        "test": test_n,
        "pool": pool_n,
        "skipped": lab.skipped,
        "uploadedAt": _upload_stamp(lab, "uploaded"),
        "updatedAt": _upload_stamp(lab, "updated"),
        "checks": checks["list"],
        "ok": checks["ok"],
    }


def _upload_stamp(lab: Lab, which: str) -> str | None:
    saved = lab.uploaded_at if which == "uploaded" else lab.updated_at
    if saved:
        return saved
    moments: list[float] = []
    for item in lab.staged:
        try:
            moments.append(item.file.stat().st_mtime)
        except OSError:
            continue
    if not moments:
        return None
    moment = min(moments) if which == "uploaded" else max(moments)
    return datetime.fromtimestamp(moment).isoformat(timespec="seconds")


def _touch_upload(lab: Lab) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    if lab.uploaded_at is None:
        lab.uploaded_at = now
    lab.updated_at = now


def _checks(
    rows: list[dict[str, object]],
    train_n: int,
    test_n: int,
    pool_n: int,
    skipped: int,
) -> dict[str, object]:
    out: list[dict[str, object]] = []
    trained = [row for row in rows if int(row["train"]) > 0]
    no_test = [str(row["name"]) for row in trained if int(row["test"]) == 0]
    test_only = [str(row["name"]) for row in rows if int(row["train"]) == 0 and int(row["test"]) > 0]
    few = [str(row["name"]) for row in trained if int(row["train"]) < 5]
    if pool_n:
        out.append(
            {
                "level": "bad",
                "message": f"{pool_n} images are not inside a Training Data or Testing Data folder. Split them, or mark them as training, before the model can use this set.",
                "action": "pool",
            }
        )
    if len(trained) >= 2:
        out.append({"level": "ok", "message": f"{len(trained)} classes found in Training Data.", "action": None})
    else:
        out.append(
            {
                "level": "bad",
                "message": "Training Data needs at least 2 class folders with images inside.",
                "action": None,
            }
        )
    if len(trained) > _MAX_CLASSES:
        out.append({"level": "bad", "message": f"{len(trained)} classes is more than this exercise can show ({_MAX_CLASSES} max).", "action": None})
    if few:
        out.append({"level": "bad", "message": "Too few training images (under 5) in: " + ", ".join(few) + ".", "action": None})
    movable = [str(row["name"]) for row in trained if int(row["test"]) == 0 and _holdout_count(int(row["train"])) > 0]
    stuck = [str(row["name"]) for row in trained if int(row["test"]) == 0 and int(row["train"]) >= _MIN_TRAIN and _holdout_count(int(row["train"])) == 0]
    if movable:
        out.append(
            {
                "level": "bad",
                "message": "No testing images for: " + ", ".join(movable) + ".",
                "action": "fixtest",
            }
        )
    if stuck:
        out.append(
            {
                "level": "bad",
                "message": "Need at least 6 training images so one can be kept for testing: " + ", ".join(stuck) + ".",
                "action": None,
            }
        )
    if no_test and not movable and not stuck:
        out.append(
            {
                "level": "bad",
                "message": "No testing images for: " + ", ".join(no_test) + ".",
                "action": None,
            }
        )
    elif not no_test and test_n:
        out.append({"level": "ok", "message": "Every class has testing images, kept apart from training.", "action": None})
    if test_only:
        out.append(
            {
                "level": "warn",
                "message": "Only in Testing Data (will be ignored): " + ", ".join(test_only) + ".",
                "action": None,
            }
        )
    big = [
        str(row["name"])
        for row in trained
        if int(row["train"]) > _MAX_PER_SPLIT or int(row["test"]) > _MAX_PER_SPLIT
    ]
    if big:
        out.append(
            {
                "level": "warn",
                "message": f"Some classes have over {_MAX_PER_SPLIT} images per folder; a random {_MAX_PER_SPLIT} will be used so training stays quick.",
                "action": None,
            }
        )
    if skipped:
        out.append(
            {
                "level": "warn",
                "message": f"{skipped} image{'s were' if skipped != 1 else ' was'} skipped because {'they are' if skipped != 1 else 'it is'} not inside a class folder.",
                "action": None,
            }
        )
    ok = not any(item["level"] == "bad" for item in out) and len(trained) >= 2
    return {"list": out, "ok": ok}


def _holdout_count(train_n: int) -> int:
    """Images that can move to testing while leaving at least 5 for training."""
    if train_n < _MIN_TRAIN + 1:
        return 0
    want = max(1, int(round(train_n * 0.2)))
    return min(want, train_n - _MIN_TRAIN)


def _thumb(raw: bytes) -> str | None:
    try:
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((32, 32))
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=70)
    except Exception:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _feature_side(n_features: int) -> int:
    side = int(round(math.sqrt(n_features)))
    if side * side != n_features:
        raise VisionError("Prepared images have an unexpected size. Prepare the images again.")
    return side


def _decode(raw: bytes, side: int | None = None) -> tuple[np.ndarray, bool]:
    side_n = int(side or _SIDE)
    pixels = side_n * side_n
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    small = max(image.size) <= side_n
    if image.mode == "RGBA":
        base = Image.new("RGBA", image.size, (0, 0, 0, 255))
        image = Image.alpha_composite(base, image)
    image = image.convert("RGB")
    width, height = image.size
    # Letterbox into the canvas: keep aspect ratio. Only downscale when larger
    # than the canvas — never crop, never stretch.
    if max(width, height) > side_n:
        scale = side_n / float(max(width, height))
        width = max(1, int(round(width * scale)))
        height = max(1, int(round(height * scale)))
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (side_n, side_n), (0, 0, 0))
    canvas.paste(image, ((side_n - image.size[0]) // 2, (side_n - image.size[1]) // 2))
    arr = np.asarray(canvas, dtype=np.float32)
    gray = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    flat = gray.reshape(-1)
    ordered = np.sort(flat)
    lo_i = max(0, pixels // 100)
    hi_i = min(pixels - 1, pixels - 1 - pixels // 100)
    lo = float(ordered[lo_i])
    hi = float(ordered[hi_i])
    span = max(hi - lo, 64.0)
    features = np.clip((flat - lo) / span, 0.0, 1.0).astype(np.float32)
    if float(np.linalg.norm(features)) < 1e-6:
        features = np.full(pixels, 1e-3, dtype=np.float32)
    return features, small


def _pixel_hash(features: np.ndarray) -> int:
    acc = 2166136261
    for value in np.round(features * 63).astype(np.int64):
        acc ^= int(value) & 0xFFFFFFFF
        acc = (acc * 16777619) & 0xFFFFFFFF
    return acc


def _near_hash(features: np.ndarray) -> int:
    """Coarse 8×8 fingerprint so near-identical train/test photos collide."""
    side = _feature_side(int(features.shape[0]))
    image = features.reshape(side, side)
    step = max(1, side // 8)
    blocks = image.reshape(8, step, 8, step).mean(axis=(1, 3))
    return _pixel_hash(np.clip(blocks.reshape(-1) / (float(blocks.max()) or 1.0), 0.0, 1.0).astype(np.float32))


def _display_jpeg(raw: bytes) -> bytes:
    # UI never shows these larger than ~300px; keep files small for fast belt/wall loads.
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    image.thumbnail((320, 320), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=72, optimize=True)
    return buf.getvalue()


def _gray_png(features: np.ndarray) -> str:
    side = _feature_side(int(features.shape[0]))
    canvas = (np.clip(features, 0, 1) * 255).astype(np.uint8).reshape(side, side)
    buf = io.BytesIO()
    Image.fromarray(canvas, "L").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _add_bytes(lab: Lab, path: str, raw: bytes, forced: str | None) -> tuple[int, int]:
    if not _IMG_RE.search(path):
        return 0, 0
    if len(raw) > _MAX_FILE:
        return 0, 1
    found = classify_path(path, forced)
    if found is None:
        return 0, 1
    split, cls = found
    existing = next((item for item in lab.staged if item.path == path), None)
    if existing is not None:
        existing.file.write_bytes(raw)
        existing.split = split
        existing.cls = cls
        existing.thumb = None
        existing.thumb_tried = False
        return 1, 0
    if len(lab.staged) >= _MAX_FILES:
        raise VisionError(f"Too many images (max {_MAX_FILES}).")
    folder = _slot(lab.session_id, lab.project_id) / "staged"
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{len(lab.staged):05d}.bin"
    dest.write_bytes(raw)
    lab.staged.append(StagedItem(path=path, split=split, cls=cls, file=dest))
    return 1, 0


def _wipe_staged_locked(lab: Lab) -> None:
    for item in lab.staged:
        item.file.unlink(missing_ok=True)
    lab.staged.clear()
    lab.skipped = 0
    lab.uploaded_at = None
    lab.updated_at = None
    lab.dropped.clear()


def ingest_files(
    session_id: str,
    project_id: str,
    files: list[tuple[str, bytes]],
    forced: str | None,
    replace: bool = False,
) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        _ensure_idle(lab)
        if replace:
            _wipe_staged_locked(lab)
        added = skipped = 0
        total = sum(len(raw) for _, raw in files)
        if total > _MAX_BYTES:
            raise VisionError("That upload is too large.")
        for path, raw in files:
            plus, miss = _add_bytes(lab, path, raw, forced)
            added += plus
            skipped += miss
        lab.skipped += skipped
        if added:
            _touch_upload(lab)
            _holdout_missing_tests_locked(lab)
        _invalidate_model(lab)
        summary = _summary_locked(lab)
        _persist_locked(lab)
    return {"added": added, "skipped": skipped, "summary": summary}


def ingest_zip(session_id: str, project_id: str, raw: bytes, forced: str | None, replace: bool = False) -> dict[str, object]:
    if len(raw) > _MAX_BYTES:
        raise VisionError("That zip is too large.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise VisionError("That file is not a zip archive.") from exc
    files: list[tuple[str, bytes]] = []
    with archive:
        for info in archive.infolist():
            name = info.filename.replace("\\", "/")
            if name.endswith("/") or not _IMG_RE.search(name):
                continue
            if "__MACOSX" in name or "/." in name or name.startswith("."):
                continue
            files.append((name, archive.read(info)))
    return ingest_files(session_id, project_id, files, forced, replace=replace)


def _draw_practice_shape(draw: ImageDraw.ImageDraw, shape: int, fill: int, jitter: int) -> None:
    if shape == 0:
        draw.rectangle([8, 24 + jitter, 56, 40 + jitter], fill=fill)
    elif shape == 1:
        draw.rectangle([24 + jitter, 8, 40 + jitter, 56], fill=fill)
    else:
        draw.ellipse([14 + jitter, 14, 50 + jitter, 50], fill=fill)


def _practice_png(kind: int, rng: np.random.Generator) -> bytes:
    """Three classes with deliberate overlap so a careful model still misses some."""
    image = Image.new("L", (64, 64), int(rng.integers(35, 95)))
    draw = ImageDraw.Draw(image)
    fill = int(rng.integers(150, 235))
    jitter = int(rng.integers(-10, 11))
    shape = kind % 3
    roll = int(rng.integers(0, 10))
    if roll == 0:
        shape = (kind + 1) % 3
    elif roll == 1:
        shape = (kind + 2) % 3
    if roll == 2:
        # Ambiguous: faint second shape on top of the class cue.
        _draw_practice_shape(draw, shape, fill, jitter)
        _draw_practice_shape(draw, (shape + 1) % 3, max(40, fill // 2), jitter // 2)
    else:
        _draw_practice_shape(draw, shape, fill, jitter)
    arr = np.clip(np.asarray(image, dtype=np.int16) + rng.integers(-30, 31, (64, 64)), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, "L").save(buf, format="PNG")
    return buf.getvalue()


def load_sample(session_id: str, project_id: str, department: str) -> dict[str, object]:
    row = DEPARTMENTS.get(department)
    if row is None:
        raise VisionError("Choose a department first.")
    names = list(row["sample"])
    rng = np.random.default_rng(11)
    files: list[tuple[str, bytes]] = []
    for index, name in enumerate(names):
        for split, count in (("Training Data", 16), ("Testing Data", 4)):
            for n in range(count):
                files.append((f"Practice/{split}/{name}/img_{n:02d}.png", _practice_png(index, rng)))
    clear(session_id, project_id)
    lab = _lab(session_id, project_id)
    with lab.lock:
        lab.department = department
        _persist_locked(lab)
    return ingest_files(session_id, project_id, files, None, replace=True)


def apply_pool(session_id: str, project_id: str, mode: str) -> dict[str, object]:
    if mode not in ("split", "train"):
        raise VisionError("Choose split or train.")
    lab = _lab(session_id, project_id)
    with lab.lock:
        _ensure_idle(lab)
        rng = np.random.default_rng(5)
        if mode == "train":
            for item in lab.staged:
                if item.split is None:
                    item.split = "train"
        else:
            groups: dict[str, list[StagedItem]] = {}
            for item in lab.staged:
                if item.split is None:
                    groups.setdefault(item.cls, []).append(item)
            for group in groups.values():
                order = rng.permutation(len(group))
                test_n = _holdout_count(len(group))
                for pos, index in enumerate(order):
                    group[int(index)].split = "test" if pos < test_n else "train"
        _invalidate_model(lab)
        summary = _summary_locked(lab)
        _persist_locked(lab)
    return {"summary": summary}


def set_test_share(session_id: str, project_id: str, percent: int) -> dict[str, object]:
    """Hold out the learner's chosen share of each class for testing."""
    if percent < 0 or percent > 90:
        raise VisionError("Choose a testing quantity from 0 to 90 percent of each class.")
    lab = _lab(session_id, project_id)
    with lab.lock:
        _ensure_idle(lab)
        rng = np.random.default_rng(7)
        groups: dict[str, list[StagedItem]] = {}
        for item in lab.staged:
            groups.setdefault(item.cls, []).append(item)
        for group in groups.values():
            order = rng.permutation(len(group))
            test_n = int(round(len(group) * percent / 100))
            if len(group) >= _MIN_TRAIN + 1:
                test_n = min(test_n, len(group) - _MIN_TRAIN)
            else:
                test_n = 0
            for pos, index in enumerate(order):
                group[int(index)].split = "test" if pos < test_n else "train"
        _invalidate_model(lab)
        summary = _summary_locked(lab)
        _persist_locked(lab)
    return {"summary": summary}


def fix_test(session_id: str, project_id: str) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        _ensure_idle(lab)
        _holdout_missing_tests_locked(lab)
        _invalidate_model(lab)
        summary = _summary_locked(lab)
        _persist_locked(lab)
    return {"summary": summary}


def _holdout_missing_tests_locked(lab: Lab) -> bool:
    """Move ~20% of each train-only class into testing. Returns True if anything moved."""
    rng = np.random.default_rng(6)
    groups: dict[str, list[StagedItem]] = {}
    for item in lab.staged:
        groups.setdefault(item.cls, []).append(item)
    moved = False
    for group in groups.values():
        train = [item for item in group if item.split == "train"]
        test = [item for item in group if item.split == "test"]
        if train and not test:
            order = rng.permutation(len(train))
            cut = _holdout_count(len(train))
            for index in order[:cut]:
                train[int(index)].split = "test"
                moved = True
    return moved


def _invalidate_model(lab: Lab) -> None:
    for run in lab.runs:
        run.stop.set()
        _dispose_run(run)
    lab.runs.clear()
    lab.dataset = None
    lab.active = None
    # Keep display/*.jpg until the next prepare replaces them so in-flight
    # mosaic/belt requests do not 404 while the learner re-uploads.


def _clear_display(lab: Lab) -> None:
    shutil.rmtree(_slot(lab.session_id, lab.project_id) / "display", ignore_errors=True)


def clear(session_id: str, project_id: str) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        _ensure_idle(lab)
        for run in lab.runs:
            run.stop.set()
            _dispose_run(run)
        department = lab.department
        _wipe_staged_locked(lab)
        lab.skipped = 0
        lab.uploaded_at = None
        lab.updated_at = None
        lab.dropped.clear()
        lab.dataset = None
        lab.runs.clear()
        lab.active = None
        lab.seq = 0
    shutil.rmtree(_slot(session_id, project_id), ignore_errors=True)
    with lab.lock:
        lab.department = department
        _persist_locked(lab)
    return {"ok": True, "summary": None}


def set_class_kept(session_id: str, project_id: str, name: str, kept: bool) -> dict[str, object]:
    """Tick keeps a class folder for the next step. Close leaves it out."""
    lab = _lab(session_id, project_id)
    key = _norm_class(name)
    with lab.lock:
        _ensure_idle(lab)
        if not any(_norm_class(item.cls) == key for item in lab.staged):
            raise VisionError("That class is not in this upload.")
        if kept:
            lab.dropped.discard(key)
        else:
            lab.dropped.add(key)
        _invalidate_model(lab)
        summary = _summary_locked(lab)
        _persist_dropped_locked(lab)
    return {"summary": summary}


def _persist_dropped_locked(lab: Lab) -> None:
    """Record which classes stay in, without recounting every image."""
    slot = _slot(lab.session_id, lab.project_id)
    manifest = slot / "lab.json"
    if not manifest.exists():
        _persist_locked(lab)
        return
    data = json.loads(manifest.read_text(encoding="utf-8"))
    data["dropped"] = sorted(lab.dropped)
    if lab.dataset is None:
        data.pop("dataset", None)
        (slot / "dataset.npz").unlink(missing_ok=True)
    manifest.write_text(json.dumps(_py(data)), encoding="utf-8")


def prepare(session_id: str, project_id: str) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        _ensure_idle(lab)
        summary = _summary_locked(lab)
        if summary is None or not summary["ok"]:
            raise VisionError("Fix the data checks before using these images.")
        staged = [item for item in lab.staged if _norm_class(item.cls) not in lab.dropped]
    rng = np.random.default_rng(11)
    grouped: dict[str, dict[str, list[StagedItem]]] = {}
    for item in staged:
        grouped.setdefault(item.cls, {"train": [], "test": []})
        if item.split == "train":
            grouped[item.cls]["train"].append(item)
        elif item.split == "test":
            grouped[item.cls]["test"].append(item)
    names = [name for name, bucket in grouped.items() if bucket["train"]]
    names.sort(key=lambda name: [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)])

    def take(items: list[StagedItem]) -> list[StagedItem]:
        if len(items) <= _MAX_PER_SPLIT:
            return items
        pick = rng.permutation(len(items))[:_MAX_PER_SPLIT]
        return [items[int(i)] for i in pick]

    train_rows: list[tuple[StagedItem, int]] = []
    test_rows: list[tuple[StagedItem, int]] = []
    for cls, name in enumerate(names):
        for item in take(grouped[name]["train"]):
            train_rows.append((item, cls))
        for item in take(grouped[name]["test"]):
            test_rows.append((item, cls))
    rng.shuffle(train_rows)
    rng.shuffle(test_rows)
    ordered = train_rows + test_rows
    features: list[np.ndarray | None] = []
    labels: list[int] = []
    small: list[bool] = []
    display: list[bytes | None] = []
    failed = 0
    for item, cls in ordered:
        try:
            raw = item.file.read_bytes()
            vec, is_small = _decode(raw)
            jpg = _display_jpeg(raw)
        except Exception:
            features.append(None)
            labels.append(cls)
            small.append(False)
            display.append(None)
            failed += 1
            continue
        features.append(vec)
        labels.append(cls)
        small.append(is_small)
        display.append(jpg)
    kept = [i for i, vec in enumerate(features) if vec is not None]
    ntr = sum(1 for i in kept if i < len(train_rows))
    if ntr < 2 or len(kept) - ntr < 1:
        raise VisionError("Not enough readable images to continue.")
    x = np.stack([features[i] for i in kept]).astype(np.float32)
    y = np.asarray([labels[i] for i in kept], dtype=np.int64)
    small_kept = [small[i] for i in kept]
    classes = names
    by_class: list[list[int]] = []
    for cls in range(len(classes)):
        by_class.append([n for n in range(ntr) if int(y[n]) == cls])
    if any(len(group) == 0 for group in by_class):
        raise VisionError("Not enough readable training images in every class.")
    val_idx: list[int] = []
    rng = np.random.default_rng(17)
    for group in by_class:
        if len(group) < 3:
            continue
        hold = max(1, int(round(len(group) * 0.15)))
        hold = min(hold, len(group) - 2)
        if hold < 1:
            continue
        # Random hold-out so validation is not always the same tail of the folder.
        order = rng.permutation(len(group))
        val_idx.extend(int(group[int(i)]) for i in order[:hold])
    if not val_idx:
        raise VisionError("Each class needs at least 3 readable training images so one can be held out for validation.")
    test_idx = list(range(ntr, len(kept)))
    test_labels = {int(y[index]) for index in test_idx}
    missing_test = [classes[cls] for cls in range(len(classes)) if cls not in test_labels]
    if missing_test:
        raise VisionError("No readable testing images for: " + ", ".join(missing_test) + ".")
    seen: set[int] = set()
    near_seen: set[int] = set()
    dupes = 0
    for n in range(ntr):
        seen.add(_pixel_hash(x[n]))
        near_seen.add(_near_hash(x[n]))
    # Drop test images that are copies / near-copies of training photos so scores
    # cannot be inflated by identical letterboxed frames.
    kept_test: list[int] = []
    for n in test_idx:
        exact = _pixel_hash(x[n]) in seen
        near = _near_hash(x[n]) in near_seen
        if exact or near:
            dupes += 1
            continue
        kept_test.append(int(n))
    if kept_test:
        # Keep at least one image per class when possible after de-duplication.
        present = {int(y[i]) for i in kept_test}
        for cls in range(len(classes)):
            if cls in present:
                continue
            candidates = [i for i in test_idx if int(y[i]) == cls]
            if candidates:
                kept_test.append(int(candidates[0]))
        test_idx = sorted(set(kept_test))
    else:
        # Everything matched training — fall back to the raw test split.
        dupes = len(test_idx)
    test_labels = {int(y[index]) for index in test_idx}
    missing_test = [classes[cls] for cls in range(len(classes)) if cls not in test_labels]
    if missing_test:
        raise VisionError("No readable testing images for: " + ", ".join(missing_test) + ".")
    dataset = Dataset(
        key=uuid.uuid4().hex[:12],
        classes=classes,
        x=x,
        y=y,
        ntr=ntr,
        val_idx=val_idx,
        by_class=by_class,
        test_idx=test_idx,
        small=small_kept,
        dupes=dupes,
    )
    display_dir = _slot(session_id, project_id) / "display"
    _clear_display(lab)
    display_dir.mkdir(parents=True, exist_ok=True)
    for out_i, src_i in enumerate(kept):
        blob = display[src_i]
        if not blob:
            blob = _features_jpeg(features[src_i])  # type: ignore[arg-type]
        (display_dir / f"{out_i}.jpg").write_bytes(blob)
    with lab.lock:
        _ensure_idle(lab)
        for run in lab.runs:
            _dispose_run(run)
        lab.runs.clear()
        lab.active = None
        lab.dataset = dataset
        meta = _dataset_meta(dataset)
        meta["failed"] = failed
        _persist_locked(lab)
    return meta


def _dataset_meta(dataset: Dataset) -> dict[str, object]:
    wall: list[int] = []
    for i in range(40):
        group = dataset.by_class[i % len(dataset.classes)]
        if group:
            wall.append(group[(i // len(dataset.classes)) % len(group)])
    rep = [group[0] if group else dataset.val_idx[0] for group in dataset.by_class]
    test_y = dataset.y[dataset.test_idx]
    counts = np.bincount(test_y, minlength=len(dataset.classes))
    base = float(counts.max() / max(1, len(dataset.test_idx)))
    return {
        "key": dataset.key,
        "classes": [{"name": name, "short": _short(name)} for name in dataset.classes],
        "K": len(dataset.classes),
        "ntr": dataset.ntr,
        "nte": len(dataset.test_idx),
        "nall": int(dataset.x.shape[0]),
        "valIdx": dataset.val_idx,
        "byClass": dataset.by_class,
        "testIdx": dataset.test_idx,
        "y": [int(v) for v in dataset.y.tolist()],
        "small": dataset.small,
        "rep": rep,
        "wall": wall,
        "dupes": dataset.dupes,
        "baseRate": _num(base),
        "trainCount": int(dataset.ntr),
        "valCount": len(dataset.val_idx),
        "side": _feature_side(int(dataset.x.shape[1])),
    }


def _features_jpeg(features: np.ndarray) -> bytes:
    side = _feature_side(int(features.shape[0]))
    canvas = (np.clip(features, 0, 1) * 255).astype(np.uint8).reshape(side, side)
    buf = io.BytesIO()
    Image.fromarray(canvas, "L").convert("RGB").save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def image_bytes(session_id: str, project_id: str, index: int) -> bytes:
    """Serve a display thumbnail for the mosaic / belt / class chips.

    Prefer the prepared JPEG on disk. If that file is missing (or the lab was
    just invalidated by a re-upload), fall back to rendering from the in-memory
    dataset so the UI never shows broken tiles for a valid index.
    """
    if index < 0:
        raise VisionError("That image is not in the prepared set.", 404)
    path = _slot(session_id, project_id) / "display" / f"{index}.jpg"
    if path.exists():
        try:
            blob = path.read_bytes()
            if blob.startswith(b"\xff\xd8"):
                return blob
        except OSError:
            pass
    lab = _lab(session_id, project_id)
    with lab.lock:
        dataset = lab.dataset
        row = None if dataset is None or index >= int(dataset.x.shape[0]) else np.asarray(dataset.x[index], dtype=np.float32).copy()
    if row is not None:
        return _features_jpeg(row)
    raise VisionError("That image is not in the prepared set.", 404)


def state(session_id: str, project_id: str) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        summary = _summary_locked(lab)
        dataset = _dataset_meta(lab.dataset) if lab.dataset is not None else None
        runs = [_public_run(run) for run in lab.runs]
        active = lab.active.id if lab.active is not None and lab.active.status == "running" else None
        department = lab.department
    return {"summary": summary, "dataset": dataset, "runs": runs, "activeRunId": active, "department": department}


def _softmax(rows: np.ndarray, scale: float) -> np.ndarray:
    scaled = rows * scale
    scaled = scaled - scaled.max(axis=1, keepdims=True)
    exp = np.exp(scaled)
    return exp / exp.sum(axis=1, keepdims=True)


def _smooth(probs: np.ndarray) -> np.ndarray:
    k = probs.shape[-1]
    return probs * 0.98 + 0.02 / k


def score_matrix(probs: np.ndarray, y: np.ndarray) -> dict[str, object]:
    k = probs.shape[1]
    pred = np.argmax(probs, axis=1).astype(int)
    cm = np.zeros((k, k), dtype=int)
    for truth, guess in zip(y.tolist(), pred.tolist()):
        cm[int(truth), int(guess)] += 1
    cls: list[dict[str, object]] = []
    for c in range(k):
        tp = int(cm[c, c])
        rs = int(cm[c].sum())
        cs = int(cm[:, c].sum())
        cls.append(
            {
                "p": _num(tp / cs) if cs else 0.0,
                "r": _num(tp / rs) if rs else 0.0,
                "tp": tp,
                "rs": rs,
                "cs": cs,
                "undef": bool(cs == 0 and rs > 0),
            }
        )
    m = int(len(y))
    acc = float(sum(int(row["tp"]) for row in cls) / m) if m else 0.0
    loss = 0.0
    for i, truth in enumerate(y.tolist()):
        loss -= math.log(max(float(probs[i, int(truth)]), 1e-7))
    loss = loss / m if m else 0.0
    conf = [_num(float(probs[i, pred[i]])) for i in range(m)]
    return {
        "cm": cm.tolist(),
        "cls": cls,
        "pred": pred.tolist(),
        "conf": conf,
        "acc": _num(acc),
        "loss": _num(loss),
        "P": _num(sum(float(row["p"]) for row in cls) / k) if k else 0.0,
        "R": _num(sum(float(row["r"]) for row in cls) / k) if k else 0.0,
        "m": m,
    }


def _log_entry(scored: dict[str, object], step: int, loss: float | None = None) -> dict[str, object]:
    return {
        "e": step,
        "acc": scored["acc"],
        "loss": _num(loss) if loss is not None else scored["loss"],
        "P": scored["P"],
        "R": scored["R"],
        "cls": [{"p": row["p"], "r": row["r"]} for row in scored["cls"]],  # type: ignore[index]
    }


def _train_pool(dataset: Dataset, frac: float) -> list[int]:
    """Fit on a fraction of training images, never including the validation hold-out."""
    held = {int(i) for i in dataset.val_idx}
    pool: list[int] = []
    for group in dataset.by_class:
        eligible = [int(i) for i in group if int(i) not in held]
        if not eligible:
            raise VisionError("Not enough training images left after holding out validation.")
        count = max(1, int(round(len(eligible) * frac)))
        count = min(count, len(eligible))
        pool.extend(eligible[:count])
    return pool


def _flat(values: np.ndarray, places: int = 3) -> list[float]:
    return [_num(float(v), places) for v in values.reshape(-1).tolist()]


def _record(lab: Lab, run: Run, entry: dict[str, object], viz: dict[str, object] | None, belt: list[int], aux: float | None) -> None:
    with lab.lock:
        run.log.append(entry)
        run.live_step = int(entry["e"])
        run.live_acc = float(entry["acc"])
        run.live_loss = float(entry["loss"])
        run.live_aux = aux
        # Keep the conveyor strip stable so the browser can reuse cached thumbnails.
        # Refresh only occasionally — CSS animation already sells the motion.
        if not run.belt or len(run.log) % 5 == 1:
            run.belt = belt[-14:]
        if viz is not None:
            run.viz = viz


def _pace(run: Run, ticks: int | None = None) -> None:
    """Stream ticks over a realistic window so the live UI can breathe and move."""
    if run.stop.is_set():
        return
    n = max(1, int(ticks if ticks is not None else run.steps))
    # Aim for ~12–24s of live progress; larger pools take a touch longer.
    target = 12.0 + min(12.0, len(run.pool) / 320.0)
    delay = target / n
    delay = min(1.45, max(0.28, delay))
    # Slight jitter + mild ease so ticks don't feel like a metronome.
    done = max(0, len(run.log))
    ease = 1.12 - 0.22 * min(1.0, done / n)
    jitter = 0.82 + 0.36 * float(np.random.default_rng().random())
    run.stop.wait(delay * ease * jitter)


def _belt_sample(pool: list[int], seed: int, count: int = 14) -> list[int]:
    if not pool:
        return []
    take = min(count, len(pool))
    order = np.random.default_rng(seed).permutation(len(pool))
    return [int(pool[int(i)]) for i in order[:take]]


def _fit_knn(run: Run, dataset: Dataset, lab: Lab) -> None:
    x = dataset.x[run.pool]
    y = dataset.y[run.pool]
    k = min(int(run.params["k"]), len(run.pool))
    with lab.lock:
        run.phase = "fitting"
        run.belt = _belt_sample(run.pool, 3)
    # Brief settle so learners see the fitting phase before scores start moving.
    run.stop.wait(0.7)
    if run.stop.is_set():
        return
    model = KNeighborsClassifier(
        n_neighbors=k,
        metric=str(run.params["metric"]),
        weights=str(run.params["weights"]),
        n_jobs=1,
    )
    model.fit(x, y)
    run.model_obj = model
    val = np.asarray(dataset.val_idx, dtype=int)
    with lab.lock:
        run.phase = "scoring"
    # More ticks on larger validation sets → smoother, more dynamic curves.
    chunks = max(16, min(36, max(8, len(val) // 12)))
    marks = sorted(set([max(1, len(val) * i // chunks) for i in range(1, chunks)] + [len(val)]))
    # Keep steps = validation size so the curve x-axis ("images checked") matches log.e.
    with lab.lock:
        run.steps = max(1, len(val))
    probs = _smooth(model.predict_proba(dataset.x[val]))
    for tick, mark in enumerate(marks):
        if run.stop.is_set():
            break
        query = int(val[min(mark - 1, len(val) - 1)])
        dist, ind = model.kneighbors(dataset.x[query : query + 1], n_neighbors=k)
        neighbors = []
        for pos in range(ind.shape[1]):
            pool_i = int(ind[0, pos])
            neighbors.append(
                {
                    "index": int(run.pool[pool_i]),
                    "cls": int(y[pool_i]),
                    "dist": _num(float(dist[0, pos]), 3),
                }
            )
        q_probs = model.predict_proba(dataset.x[query : query + 1])[0]
        q_probs = _smooth(q_probs.reshape(1, -1))[0]
        viz = {
            "kind": "knn",
            "query": query,
            "truth": int(dataset.y[query]),
            "pred": int(np.argmax(q_probs)),
            "probs": _flat(q_probs),
            "neighbors": neighbors,
        }
        scored = score_matrix(probs[:mark], dataset.y[val[:mark]])
        _record(lab, run, _log_entry(scored, mark), viz, _belt_sample(run.pool, 11 + tick * 17), None)
        with lab.lock:
            run.live_seen = mark
        _pace(run, ticks=len(marks))


def _svm_scores(model: SGDClassifier, scaler: StandardScaler | None, rows: np.ndarray, k: int) -> np.ndarray:
    data = scaler.transform(rows) if scaler is not None else rows
    scores = model.decision_function(data)
    if k == 2 and scores.ndim == 1:
        scores = np.column_stack([-scores, scores])
    return scores


def _hinge(scores: np.ndarray, y: np.ndarray) -> float:
    total = 0.0
    k = scores.shape[1]
    for i, truth in enumerate(y.tolist()):
        for cls in range(k):
            margin = (1.0 if cls == int(truth) else -1.0) * float(scores[i, cls])
            if margin < 1:
                total += 1 - margin
    return total / max(1, len(y) * k)


def _fit_svm(run: Run, dataset: Dataset, lab: Lab) -> None:
    x = dataset.x[run.pool]
    y = dataset.y[run.pool]
    scaler = StandardScaler() if run.params["scale"] == "on" else None
    data = scaler.fit_transform(x) if scaler is not None else x
    run.scaler = scaler
    k = len(dataset.classes)
    epochs = int(run.params["epochs"])
    lr = float(run.params["lr"])
    model = SGDClassifier(
        loss="hinge",
        penalty="l2",
        alpha=1.0 / (float(run.params["C"]) * max(1, len(run.pool))),
        learning_rate="constant",
        eta0=lr,
        fit_intercept=True,
        max_iter=1,
        tol=None,
        random_state=9,
    )
    classes = np.arange(k)
    rng = np.random.default_rng(9)
    val = np.asarray(dataset.val_idx, dtype=int)
    for epoch in range(epochs):
        if run.stop.is_set():
            break
        model.set_params(eta0=lr / (1 + 0.15 * epoch))
        order = rng.permutation(len(data))
        # Mild feature noise discourages memorising near-copies of the same photo.
        batch = data[order] + rng.normal(0.0, 0.04, size=data[order].shape)
        model.partial_fit(batch, y[order], classes=classes)
        scores = _svm_scores(model, scaler, dataset.x[val], k)
        probs = _smooth(_softmax(scores, 1.5))
        hinge = _hinge(_svm_scores(model, scaler, data, k), y)
        scored = score_matrix(probs, dataset.y[val])
        weights = model.coef_
        if weights.shape[0] == 1 and k == 2:
            weights = np.vstack([-weights, weights])
        viz = {"kind": "svm", "weights": [_flat(weights[c] / (np.max(np.abs(weights)) or 1)) for c in range(k)]}
        _record(lab, run, _log_entry(scored, epoch + 1), viz, _belt_sample(run.pool, 31 + epoch * 13), hinge)
        with lab.lock:
            run.live_seen += len(run.pool)
        _pace(run, ticks=epochs)
    if not run.log:
        return
    run.model_obj = model
    z = _svm_scores(model, scaler, dataset.x[val], k)
    best_t, best_l = 1.5, float("inf")
    for temp in _TEMPS:
        probs = _smooth(_softmax(z, temp))
        loss = 0.0
        for i, truth in enumerate(dataset.y[val].tolist()):
            loss -= math.log(max(float(probs[i, int(truth)]), 1e-7))
        # Prefer calibrated but not needle-sharp probabilities.
        peak = float(np.mean(np.max(probs, axis=1)))
        score = loss + 0.35 * max(0.0, peak - 0.85)
        if score < best_l:
            best_l = score
            best_t = temp
    run.temperature = best_t


def _fit_rf(run: Run, dataset: Dataset, lab: Lab) -> None:
    x = dataset.x[run.pool]
    y = dataset.y[run.pool]
    trees = int(run.params["trees"])
    mtry = run.params["mtry"]
    max_features: str | float = 0.1 if mtry == "10%" else str(mtry)
    model = RandomForestClassifier(
        n_estimators=1,
        warm_start=True,
        max_depth=int(run.params["depth"]),
        max_features=max_features,
        min_samples_leaf=int(run.params["leaf"]),
        min_samples_split=max(2, int(run.params["leaf"]) * 2),
        bootstrap=run.params["boot"] == "on",
        max_samples=0.8 if run.params["boot"] == "on" else None,
        random_state=21,
        n_jobs=1,
    )
    val = np.asarray(dataset.val_idx, dtype=int)
    accs: list[float] = []
    for tree in range(trees):
        if run.stop.is_set():
            break
        model.n_estimators = tree + 1
        model.fit(x, y)
        alone = model.estimators_[-1].predict(dataset.x[val])
        accs.append(float(np.mean(alone == dataset.y[val])) if len(val) else 0.0)
        probs = _smooth(model.predict_proba(dataset.x[val]))
        scored = score_matrix(probs, dataset.y[val])
        depth = float(np.mean([est.tree_.max_depth for est in model.estimators_]))
        viz = {
            "kind": "rf",
            "treeAcc": [_num(a) for a in accs],
            "trees": trees,
            "importance": _flat(model.feature_importances_),
            "meanDepth": _num(depth, 2),
        }
        _record(lab, run, _log_entry(scored, tree + 1), viz, _belt_sample(run.pool, 47 + tree * 19), depth)
        with lab.lock:
            run.live_seen += len(run.pool)
        _pace(run, ticks=trees)
    run.model_obj = model


def _require_tf():
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    try:
        import tensorflow as tf
    except Exception as exc:  # pragma: no cover - depends on the environment
        raise VisionError("TensorFlow is not available, so the MLP and CNN cannot train on this server.") from exc
    return tf


def _fit_net(run: Run, dataset: Dataset, lab: Lab) -> None:
    with lab.lock:
        run.phase = "loading"
    tf = _require_tf()
    with _TF_LOCK:
        _fit_net_locked(tf, run, dataset, lab)


def _fit_net_locked(tf: object, run: Run, dataset: Dataset, lab: Lab) -> None:
    keras = tf.keras  # type: ignore[attr-defined]
    k = len(dataset.classes)
    params = run.params
    epochs = int(params["epochs"])
    batch = int(params["batch"])
    x_pool = dataset.x[run.pool]
    y_pool = dataset.y[run.pool]
    val = np.asarray(dataset.val_idx, dtype=int)
    side = _feature_side(int(dataset.x.shape[1]))
    pixels = side * side
    cnn = run.model == "cnn"
    if cnn:
        x_fit = x_pool.reshape((-1, side, side, 1))
        x_val = dataset.x[val].reshape((-1, side, side, 1))
    else:
        x_fit = x_pool
        x_val = dataset.x[val]
    y_fit = keras.utils.to_categorical(y_pool, k)
    model = keras.Sequential()
    reg = keras.regularizers.l2(1e-3)
    if cnn:
        pool = keras.layers.MaxPooling2D if params["pool"] == "max" else keras.layers.AveragePooling2D
        filters = int(params["filters"])
        kernel = int(params["kernel"])
        model.add(keras.layers.Conv2D(filters, kernel, padding="same", activation="relu", input_shape=(side, side, 1), kernel_initializer="he_normal", kernel_regularizer=reg))
        model.add(pool((2, 2)))
        model.add(keras.layers.Conv2D(filters * 2, kernel, padding="same", activation="relu", kernel_initializer="he_normal", kernel_regularizer=reg))
        model.add(pool((2, 2)))
        model.add(keras.layers.Flatten())
        model.add(keras.layers.Dense(int(params["dense"]), activation="relu", kernel_regularizer=reg))
        model.add(keras.layers.Dropout(0.4))
    else:
        act = "sigmoid" if params["act"] == "sigmoid" else str(params["act"])
        init = "he_normal" if act == "relu" else "glorot_uniform"
        for layer in range(int(params["layers"])):
            units = int(params["units"]) if layer == 0 else max(16, int(params["units"]) // 2)
            kwargs = {"units": units, "activation": act, "kernel_initializer": init, "kernel_regularizer": reg}
            if layer == 0:
                kwargs["input_shape"] = (pixels,)
            model.add(keras.layers.Dense(**kwargs))
            if float(params["dropout"]):
                model.add(keras.layers.Dropout(float(params["dropout"])))
    model.add(keras.layers.Dense(k, activation="softmax", kernel_regularizer=reg))
    model.compile(optimizer=keras.optimizers.Adam(float(params["lr"])), loss="categorical_crossentropy")
    run.model_obj = model

    def snapshot(step: int) -> None:
        probs = model.predict(x_val, verbose=0)
        scored = score_matrix(np.asarray(probs, dtype=np.float32), dataset.y[val])
        viz = _net_viz(tf, model, run, dataset, val)
        belt = [int(run.pool[int(i)]) for i in np.random.default_rng(step).integers(0, len(run.pool), size=min(14, len(run.pool)))]
        _record(lab, run, _log_entry(scored, step), viz, belt, None)

    class _Callback(keras.callbacks.Callback):
        def on_batch_end(self, batch_index: int, logs: dict | None = None) -> None:
            if run.stop.is_set():
                self.model.stop_training = True
            with lab.lock:
                run.live_seen += batch
                run.phase = "training"

        def on_epoch_end(self, epoch: int, logs: dict | None = None) -> None:
            if run.stop.is_set():
                self.model.stop_training = True
            snapshot(epoch + 1)
            _pace(run, ticks=epochs)

    with lab.lock:
        run.phase = "training"
    snapshot(0)
    model.fit(x_fit, y_fit, epochs=epochs, batch_size=batch, shuffle=True, verbose=0, callbacks=[_Callback()])


def _net_viz(tf: object, model: object, run: Run, dataset: Dataset, val: np.ndarray) -> dict[str, object]:
    if run.model == "mlp":
        kernel = np.asarray(model.layers[0].get_weights()[0])  # type: ignore[attr-defined]
        units = kernel.shape[1]
        show = min(12, units)
        scale = float(np.max(np.abs(kernel[:, :show])) or 1)
        return {
            "kind": "mlp",
            "units": int(units),
            "neurons": [_flat(kernel[:, i] / scale) for i in range(show)],
        }
    kernel = np.asarray(model.layers[0].get_weights()[0])  # type: ignore[attr-defined]
    ks = int(kernel.shape[0])
    filters = int(kernel.shape[3])
    probe = int(val[0]) if len(val) else 0
    side = _feature_side(int(dataset.x.shape[1]))
    probe_model = tf.keras.Model(inputs=model.inputs, outputs=model.layers[0].output)  # type: ignore[attr-defined]
    maps = np.asarray(probe_model.predict(dataset.x[probe].reshape(1, side, side, 1), verbose=0))[0]
    filt: list[list[float]] = []
    drawn: list[list[float]] = []
    for j in range(filters):
        weights = kernel[:, :, 0, j]
        scale = float(np.max(np.abs(weights)) or 1)
        filt.append(_flat(weights / scale))
        channel = maps[:, :, j]
        lo = float(channel.min())
        hi = float(channel.max())
        span = hi - lo or 1
        drawn.append(_flat((channel - lo) / span))
    return {"kind": "cnn", "kernel": ks, "filters": filt, "maps": drawn, "probe": probe}


_TRAINERS = {"knn": _fit_knn, "svm": _fit_svm, "rf": _fit_rf, "mlp": _fit_net, "cnn": _fit_net}


def _predict_probs(run: Run, rows: np.ndarray) -> np.ndarray:
    _ensure_model(run)
    if run.model_obj is None or rows.shape[0] == 0:
        raise VisionError("That run has no model yet.")
    if run.model == "knn":
        return _smooth(run.model_obj.predict_proba(rows))
    if run.model == "svm":
        return _smooth(_softmax(_svm_scores(run.model_obj, run.scaler, rows, len(run.model_obj.classes_)), run.temperature))
    if run.model == "rf":
        return _smooth(run.model_obj.predict_proba(rows))
    if run.model == "cnn":
        side = _feature_side(int(rows.shape[1]))
        xt = rows.reshape((-1, side, side, 1))
    else:
        xt = rows
    return np.asarray(run.model_obj.predict(xt, verbose=0), dtype=np.float32)


def _mark_runtime(run: Run) -> None:
    if run.t0 is None:
        return
    run.runtime_ms = max(0, int(round((time.perf_counter() - run.t0) * 1000)))


def _score_test(run: Run, dataset: Dataset) -> None:
    probs = _predict_probs(run, dataset.x[dataset.test_idx])
    run.res = score_matrix(probs, dataset.y[dataset.test_idx])
    run.val_acc = float(run.log[-1]["acc"]) if run.log else None
    run.done = True
    run.status = "done"
    run.phase = "done"
    _mark_runtime(run)


def _dispose_run(run: Run) -> None:
    run.model_obj = None


def _train_job(lab: Lab, run: Run, dataset: Dataset) -> None:
    run.t0 = time.perf_counter()
    try:
        _TRAINERS[run.model](run, dataset, lab)
        with lab.lock:
            run.phase = "scoring"
        if run.model_obj is not None and run.log:
            _score_test(run, dataset)
        else:
            with lab.lock:
                run.status = "error"
                run.phase = "error"
                run.error = "Training stopped before it could score anything."
                _mark_runtime(run)
                if lab.active is run:
                    lab.active = None
            return
        if run.stop.is_set():
            run.stopped = True
    except Exception as exc:
        logger.exception("Exercise 4 training failed")
        with lab.lock:
            run.status = "error"
            run.phase = "error"
            run.error = str(exc)
            run.done = False
            _mark_runtime(run)
    finally:
        with lab.lock:
            if run.runtime_ms is None:
                _mark_runtime(run)
            # Always release the lab lock slot when this job ends.
            if lab.active is run:
                lab.active = None
            if run.status == "running":
                run.status = "done" if run.done else "error"
                run.phase = "done" if run.done else "error"
        # Persist after releasing so the next Train is not blocked on disk I/O.
        try:
            _persist_lab(lab)
        except Exception:
            logger.exception("Failed to persist vision lab after training")


def start_train(
    session_id: str,
    project_id: str,
    model: str,
    params: dict[str, object] | None,
    frac: float,
    *,
    background: bool = True,
) -> dict[str, object]:
    if model not in _TRAINERS:
        raise VisionError("Choose k-NN, SVM, Random Forest, MLP, or CNN.")
    try:
        frac_f = float(frac)
    except (TypeError, ValueError) as exc:
        raise VisionError("Choose 25%, 50%, or 100% of the training images.") from exc
    if not any(abs(frac_f - item) < 1e-9 for item in _FRACS):
        raise VisionError("Choose 25%, 50%, or 100% of the training images.")
    resolved = resolve_params(model, params)
    lab = _lab(session_id, project_id)
    with lab.lock:
        _ensure_idle(lab)
        dataset = lab.dataset
        if dataset is None:
            raise VisionError("Prepare images before training.")
        pool = _train_pool(dataset, frac_f)
        if len(pool) < 2:
            raise VisionError("Not enough training images for that fraction.")
        lab.seq += 1
        steps = len(dataset.val_idx) if model == "knn" else int(resolved["trees"] if model == "rf" else resolved["epochs"])
        run = Run(
            id=uuid.uuid4().hex[:12],
            no=lab.seq,
            model=model,
            params=resolved,
            n=len(pool),
            frac=frac_f,
            steps=max(1, steps),
            pool=pool,
        )
        lab.runs.append(run)
        lab.active = run
    if background:
        thread = threading.Thread(target=_train_job, args=(lab, run, dataset), daemon=True)
        run.thread = thread
        thread.start()
    else:
        _train_job(lab, run, dataset)
    return run_snapshot(session_id, project_id, run.id)


def run_snapshot(session_id: str, project_id: str, run_id: str) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        run = next((item for item in lab.runs if item.id == run_id), None)
        if run is None and lab.active is not None and lab.active.id == run_id:
            run = lab.active
        if run is None:
            raise VisionError("That training run was not found.", 404)
        return _public_run(run)


def _public_run(run: Run) -> dict[str, object]:
    progress = 0.0
    if run.phase == "scoring" or run.done:
        progress = 1.0
    elif run.steps:
        progress = min(1.0, run.live_step / run.steps)
    return {
        "id": run.id,
        "no": run.no,
        "model": run.model,
        "params": run.params,
        "n": run.n,
        "frac": run.frac,
        "steps": run.steps,
        "status": run.status,
        "phase": run.phase,
        "error": run.error,
        "done": run.done,
        "stopped": run.stopped,
        "valAcc": None if run.val_acc is None else _num(run.val_acc),
        "log": list(run.log),
        "res": run.res,
        "viz": run.viz,
        "belt": list(run.belt),
        "runtimeMs": run.runtime_ms,
        "live": {
            "step": run.live_step,
            "seen": run.live_seen,
            "acc": None if run.live_acc is None else _num(run.live_acc),
            "loss": None if run.live_loss is None else _num(run.live_loss),
            "aux": None if run.live_aux is None else _num(run.live_aux),
            "progress": _num(progress),
        },
    }


def set_department(session_id: str, project_id: str, department: str) -> dict[str, object]:
    if department not in DEPARTMENTS:
        raise VisionError("Choose a department first.")
    lab = _lab(session_id, project_id)
    with lab.lock:
        lab.department = department
        _persist_locked(lab)
    return {"department": department}


def _dataset_payload(dataset: Dataset) -> dict[str, object]:
    return {
        "key": dataset.key,
        "classes": dataset.classes,
        "ntr": dataset.ntr,
        "valIdx": dataset.val_idx,
        "byClass": dataset.by_class,
        "testIdx": dataset.test_idx,
        "small": dataset.small,
        "dupes": dataset.dupes,
    }


def _write_run(slot: Path, run: Run, *, rewrite_model: bool = True) -> None:
    folder = slot / "runs" / run.id
    folder.mkdir(parents=True, exist_ok=True)
    run.store = folder
    payload = _public_run(run)
    payload["temperature"] = run.temperature
    (folder / "run.json").write_text(json.dumps(_py(payload)), encoding="utf-8")
    if run.model_obj is None:
        return
    if run.model in ("knn", "svm", "rf"):
        path = folder / "model.joblib"
        if rewrite_model or not path.exists():
            joblib.dump(run.model_obj, path)
        if run.scaler is not None:
            scaler = folder / "scaler.joblib"
            if rewrite_model or not scaler.exists():
                joblib.dump(run.scaler, scaler)
        return
    if run.model in ("mlp", "cnn"):
        path = folder / "model.keras"
        if rewrite_model or not path.exists():
            run.model_obj.save(path)


def _persist_snapshot(lab: Lab) -> dict[str, object]:
    """Copy lab state needed for disk I/O. Caller must hold lab.lock."""
    staged = [
        {"path": item.path, "split": item.split, "cls": item.cls, "file": item.file.name}
        for item in lab.staged
        if item.file.exists()
    ]
    payload: dict[str, object] = {
        "department": lab.department,
        "skipped": lab.skipped,
        "uploadedAt": lab.uploaded_at,
        "updatedAt": lab.updated_at,
        "dropped": sorted(lab.dropped),
        "seq": lab.seq,
        "staged": staged,
    }
    dataset = lab.dataset
    x = None
    y = None
    if dataset is None:
        payload.pop("dataset", None)
    else:
        x = dataset.x
        y = dataset.y
        payload["dataset"] = _dataset_payload(dataset)
    runs: list[tuple[Run, bool]] = []
    for run in lab.runs:
        if run.status == "running":
            continue
        # Only rewrite model blobs for runs that have not been saved yet.
        rewrite_model = run.store is None or not (run.store / ("model.keras" if run.model in ("mlp", "cnn") else "model.joblib")).exists()
        runs.append((run, rewrite_model))
    return {
        "session_id": lab.session_id,
        "project_id": lab.project_id,
        "payload": payload,
        "x": x,
        "y": y,
        "runs": runs,
        "keep": {run.id for run in lab.runs if run.status != "running"},
    }


def _persist_write(snap: dict[str, object]) -> None:
    slot = _slot(str(snap["session_id"]), str(snap["project_id"]))
    slot.mkdir(parents=True, exist_ok=True)
    payload = dict(snap["payload"])  # type: ignore[arg-type]
    npz = slot / "dataset.npz"
    x = snap["x"]
    y = snap["y"]
    if x is None or y is None:
        npz.unlink(missing_ok=True)
    else:
        np.savez_compressed(npz, x=x, y=y)
    (slot / "lab.json").write_text(json.dumps(_py(payload)), encoding="utf-8")
    runs_dir = slot / "runs"
    keep = snap["keep"]
    if runs_dir.exists():
        for folder in runs_dir.iterdir():
            if folder.is_dir() and folder.name not in keep:
                shutil.rmtree(folder, ignore_errors=True)
    for run, rewrite_model in snap["runs"]:  # type: ignore[misc]
        _write_run(slot, run, rewrite_model=bool(rewrite_model))


def _persist_locked(lab: Lab) -> None:
    """Persist while lab.lock is already held (blocks other lab ops until I/O finishes)."""
    _persist_write(_persist_snapshot(lab))


def _persist_lab(lab: Lab) -> None:
    """Snapshot under the lock, then write files after releasing so Train can start."""
    with lab.lock:
        snap = _persist_snapshot(lab)
    _persist_write(snap)


def _load_run(folder: Path) -> Run | None:
    meta_path = folder / "run.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    live = meta.get("live") or {}
    run = Run(
        id=str(meta["id"]),
        no=int(meta["no"]),
        model=str(meta["model"]),
        params=dict(meta.get("params") or {}),
        n=int(meta["n"]),
        frac=float(meta["frac"]),
        steps=int(meta["steps"]),
        pool=[],
        log=list(meta.get("log") or []),
        status=str(meta.get("status") or "done"),
        phase=str(meta.get("phase") or "done"),
        error=meta.get("error"),
        done=bool(meta.get("done")),
        stopped=bool(meta.get("stopped")),
        val_acc=None if meta.get("valAcc") is None else float(meta["valAcc"]),
        res=meta.get("res"),
        viz=meta.get("viz"),
        belt=[int(v) for v in meta.get("belt") or []],
        live_step=int(live.get("step") or 0),
        live_seen=int(live.get("seen") or 0),
        live_acc=None if live.get("acc") is None else float(live["acc"]),
        live_loss=None if live.get("loss") is None else float(live["loss"]),
        live_aux=None if live.get("aux") is None else float(live["aux"]),
        temperature=float(meta.get("temperature") or 1.5),
        runtime_ms=None if meta.get("runtimeMs") is None else int(meta["runtimeMs"]),
    )
    run.store = folder
    return run


def _load_lab(session_id: str, project_id: str) -> Lab | None:
    slot = _slot(session_id, project_id)
    manifest = slot / "lab.json"
    if not manifest.exists():
        return None
    data = json.loads(manifest.read_text(encoding="utf-8"))
    lab = Lab(session_id, project_id)
    department = data.get("department")
    lab.department = department if isinstance(department, str) else None
    lab.skipped = int(data.get("skipped") or 0)
    uploaded = data.get("uploadedAt")
    updated = data.get("updatedAt")
    lab.uploaded_at = uploaded if isinstance(uploaded, str) else None
    lab.updated_at = updated if isinstance(updated, str) else None
    dropped = data.get("dropped") or []
    lab.dropped = {str(name) for name in dropped} if isinstance(dropped, list) else set()
    lab.seq = int(data.get("seq") or 0)
    staged_dir = slot / "staged"
    for row in data.get("staged") or []:
        file = staged_dir / str(row.get("file") or "")
        if not file.exists():
            continue
        lab.staged.append(
            StagedItem(path=str(row.get("path") or file.name), split=row.get("split"), cls=str(row.get("cls") or ""), file=file)
        )
    meta = data.get("dataset")
    npz = slot / "dataset.npz"
    if isinstance(meta, dict) and npz.exists():
        with np.load(npz) as loaded:
            features = np.array(loaded["x"])
            labels = np.array(loaded["y"])
        lab.dataset = Dataset(
            key=str(meta["key"]),
            classes=[str(name) for name in meta["classes"]],
            x=features,
            y=labels,
            ntr=int(meta["ntr"]),
            val_idx=[int(v) for v in meta["valIdx"]],
            by_class=[[int(v) for v in group] for group in meta["byClass"]],
            test_idx=[int(v) for v in meta["testIdx"]],
            small=[bool(v) for v in meta["small"]],
            dupes=int(meta.get("dupes") or 0),
        )
    runs_dir = slot / "runs"
    if runs_dir.exists():
        for folder in sorted(runs_dir.iterdir()):
            if not folder.is_dir():
                continue
            run = _load_run(folder)
            if run is not None:
                lab.runs.append(run)
    return lab


def _ensure_model(run: Run) -> None:
    if run.model_obj is not None or run.store is None:
        return
    folder = run.store
    if run.model in ("knn", "svm", "rf"):
        path = folder / "model.joblib"
        if not path.exists():
            return
        run.model_obj = joblib.load(path)
        scaler = folder / "scaler.joblib"
        if scaler.exists():
            run.scaler = joblib.load(scaler)
        return
    if run.model in ("mlp", "cnn"):
        path = folder / "model.keras"
        if not path.exists():
            return
        tf = _require_tf()
        run.model_obj = tf.keras.models.load_model(path)


def stop_train(session_id: str, project_id: str, run_id: str) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        run = next((item for item in lab.runs if item.id == run_id), None)
        if run is None:
            raise VisionError("That training run was not found.", 404)
        if run.status != "running":
            if lab.active is run:
                lab.active = None
            return {"ok": True}
        run.stop.set()
    return {"ok": True}


def predict_index(session_id: str, project_id: str, run_id: str, index: int) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        dataset = lab.dataset
        run = next((item for item in lab.runs if item.id == run_id and item.done), None)
        if dataset is None or run is None:
            raise VisionError("Train a model before testing images.")
        if index < 0 or index >= int(dataset.x.shape[0]):
            raise VisionError("That image is not in the prepared set.", 404)
        rows = dataset.x[index : index + 1]
        probs = _predict_probs(run, rows)[0]
        truth = int(dataset.y[index])
        seen = _gray_png(dataset.x[index])
    pred = int(np.argmax(probs))
    return {
        "index": index,
        "pred": pred,
        "probs": _flat(probs),
        "truth": truth,
        "ok": pred == truth,
        "seen": seen,
    }


def predict_upload(session_id: str, project_id: str, run_id: str, raw: bytes) -> dict[str, object]:
    lab = _lab(session_id, project_id)
    with lab.lock:
        dataset = lab.dataset
        run = next((item for item in lab.runs if item.id == run_id and item.done), None)
        if dataset is None or run is None:
            raise VisionError("Train a model before testing images.")
        side = _feature_side(int(dataset.x.shape[1]))
    try:
        features, small = _decode(raw, side=side)
    except VisionError:
        raise
    except Exception as exc:
        raise VisionError("Could not read that image.") from exc
    with lab.lock:
        dataset = lab.dataset
        run = next((item for item in lab.runs if item.id == run_id and item.done), None)
        if dataset is None or run is None:
            raise VisionError("Train a model before testing images.")
        if int(features.shape[0]) != int(dataset.x.shape[1]):
            raise VisionError("That model was trained on a different image size. Prepare images and train again.")
        rows = features.reshape(1, -1)
        probs = _predict_probs(run, rows)[0]
        seen = _gray_png(features)
    pred = int(np.argmax(probs))
    return {
        "index": None,
        "pred": pred,
        "probs": _flat(probs),
        "truth": None,
        "ok": None,
        "seen": seen,
        "small": small,
    }
