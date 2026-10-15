"""
Image Recognition: does the model the app predicts with score the same as the model it trained?

The app trains a model, saves its weights to GCS, and every prediction (Use the AI, Evaluate) loads
them into a freshly built model. This trains each base model the app's way on the Nuvama documents
sample (app/image_training_service.py: same augmentation, seed and classifier), then scores the 12
standard and 20 handwritten test images twice: with the model still in memory, and after a save and
load through an in-memory bucket, the path the app takes. The two must agree.

Run from backend/:  .venv/Scripts/python.exe scripts/check_image_roundtrip.py
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.image_training_service import ImageRecognitionTrainer  # noqa: E402
from test_image_models import FakeBucket  # noqa: E402

SAMPLE = ROOT.parent / "frontend" / "public" / "datasets" / "nuvama_documents"


def load(file, size):
    """As _download_image_to_memory: RGB, resized to the model's input, raw 0-255."""
    return np.asarray(Image.open(SAMPLE / file).convert("RGB").resize(tuple(size)), dtype=np.float32)


def train(arch, manifest):
    """As prepare_training_data_direct + train_model_direct."""
    t = ImageRecognitionTrainer(arch)
    random.seed(t.seed)
    labels = [l["label"] for l in manifest["labels"]]
    images, ys = [], []
    for i, l in enumerate(manifest["labels"]):
        for f in l["files"]:
            img = load(f, t.img_size)
            for x in [img, *t._apply_minimal_augmentation(img)]:
                images.append(x)
                ys.append(i)
    t.train_model_direct(np.array(images), np.array(ys), labels)
    return t


def score(t, tests, labels):
    """As predict_from_gcs: preprocess, predict, take the top label. Returns {set: (right, total, mean top confidence)}."""
    out = {}
    for name, items in tests.items():
        x = t._preprocess(np.array([load(i["file"], t.img_size) for i in items]))
        p = t.model.predict(x, verbose=0)
        right = sum(t.class_names[int(np.argmax(row))] == i["expected"] for row, i in zip(p, items))
        out[name] = (right, len(items), float(p.max(axis=1).mean()))
    return out


def main():
    m = json.loads((SAMPLE / "manifest.json").read_text(encoding="utf-8"))
    labels = [l["label"] for l in m["labels"]]
    tests = {"standard": m["test"], "handwritten": m.get("deepTest", [])}
    fmt = lambda r: "  ".join(f"{k} {a:>2}/{b} (avg {c:.0%})" for k, (a, b, c) in r.items())  # noqa: E731
    ok = True
    for arch in ("mobilenet", "efficientnet"):
        t = train(arch, m)
        before = score(t, tests, labels)
        bucket = FakeBucket()
        t.save_model(bucket, f"image_recog/{arch}")
        loaded = ImageRecognitionTrainer()
        assert loaded.load_model_from_gcs(bucket, f"image_recog/{arch}"), loaded.last_error
        after = score(loaded, tests, labels)
        same = all(before[k][0] == after[k][0] and abs(before[k][2] - after[k][2]) < 1e-3 for k in before)
        ok &= same
        print(f"{arch:<13} trained   {fmt(before)}")
        print(f"{'':<13} reloaded  {fmt(after)}   {'same' if same else 'DIFFERENT'}")
    print("\nOK: the reloaded models predict exactly like the trained ones" if ok else "\nFAIL: a reloaded model predicts differently")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
