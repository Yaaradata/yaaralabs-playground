"""
Measure the three numbers shown under each model on the training page (Text and Image Recognition):

  accuracy  right answers on the sample's unseen test set (desk messages / document images)
  unknown   off-topic inputs the model marks as unknown: top confidence below 50% (the app's
            LOW_CONFIDENCE line), so it does not pass them off as one of the labels
  speed     median time per prediction on this machine, after warm-up
  train     seconds to train on the 20 samples (what the cards show as Speed)

Each model is trained with the app's own trainer on the sample data (20 messages / 20 images).
Off-topic inputs: text = the sample's 2 "None of these" messages + 10 below; images = photos of
everyday things from Wikimedia Commons (downloaded once to scratch, used only here).

Run from backend/:  .venv/Scripts/python.exe scripts/measure_model_cards.py [text|image]
"""

from __future__ import annotations

import io
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PUBLIC = ROOT.parent / "frontend" / "public" / "datasets"
SCRATCH = ROOT / "scripts" / "_offtopic_images"
LOW = 0.5

OFF_TOPIC_TEXT = [
    "Can you recommend a good restaurant near Bandra for dinner tonight?",
    "Who won the cricket match yesterday?",
    "My laptop keeps restarting after the latest update.",
    "What time does the airport lounge open?",
    "Please book a cab for me to the office at 9.",
    "Is it going to rain in Pune this weekend?",
    "Happy birthday to the whole team!",
    "How do I reset my email password?",
    "Can you suggest a movie for the weekend?",
    "The coffee machine on the fourth floor is broken.",
]
OFF_TOPIC_IMAGE_QUERIES = ["cat", "mountain landscape", "bicycle", "coffee cup", "dog", "beach",
                           "flower macro", "city skyline", "car street", "bird", "fruit bowl", "train station"]


def timed(fn, items):
    fn(items[0])  # warm-up
    out, ms = [], []
    for x in items:
        t = time.perf_counter()
        out.append(fn(x))
        ms.append((time.perf_counter() - t) * 1000)
    return out, statistics.median(ms)


def report(name, test, preds, off_preds, ms, train_s=None):
    right = sum(p[0] == e for p, e in zip(preds, test))
    unknown = sum(c < LOW for _, c in off_preds)
    row = {"model": name, "accuracy": f"{right}/{len(test)}", "accuracy_pct": round(100 * right / len(test)),
           "unknown": f"{unknown}/{len(off_preds)}", "unknown_pct": round(100 * unknown / len(off_preds)),
           "ms_per_prediction": round(ms, 1), "train_seconds": None if train_s is None else round(train_s, 1)}
    print(json.dumps(row), flush=True)


# ------------------------------------------------------------------ text

def text():
    d = json.loads((PUBLIC / "nuvama_custody_queries.json").read_text(encoding="utf-8"))
    train = [{"text": q["text"], "label": q["label"]} for q in d["queries"]]
    desk = [t for t in d["test"] if t["expected"] != "None of these"]
    off = [t["text"] for t in d["test"] if t["expected"] == "None of these"] + OFF_TOPIC_TEXT
    test_texts, test_labels = [t["text"] for t in desk], [t["expected"] for t in desk]

    from app.text_embed_service import SentenceEmbedTrainer
    lr = SentenceEmbedTrainer()
    t0 = time.perf_counter()
    m = lr.train_model(train)["model"]
    lr_s = time.perf_counter() - t0

    def lr_pred(t):
        r = lr.predict(m, t)
        return r["label"], r["confidence"] / 100

    preds, ms = timed(lr_pred, test_texts)
    off_preds, _ = timed(lr_pred, off)
    report("logistic_regression", test_labels, preds, off_preds, ms, lr_s)

    import torch
    from app.training_service import DistilBERTTrainer, TextExample
    bt = DistilBERTTrainer()
    t0 = time.perf_counter()
    res = bt.train_model([TextExample(text=x["text"], label=x["label"]) for x in train])
    bert_s = time.perf_counter() - t0
    model, tok = res["model"], res["tokenizer"]
    model.eval()

    def bert_pred(t):
        with torch.no_grad():
            enc = tok(t, return_tensors="pt", truncation=True, padding=True, max_length=128)
            p = torch.softmax(model(**enc).logits, dim=-1)[0].numpy()
        i = int(np.argmax(p))
        return bt.class_names[i], float(p[i])

    preds, ms = timed(bert_pred, test_texts)
    off_preds, _ = timed(bert_pred, off)
    report("distilbert", test_labels, preds, off_preds, ms, bert_s)


# ------------------------------------------------------------------ images

def offtopic_images():
    SCRATCH.mkdir(exist_ok=True)
    files = sorted(SCRATCH.glob("*.jpg"))
    if len(files) >= 10:
        return files
    api = "https://commons.wikimedia.org/w/api.php"
    for q in OFF_TOPIC_IMAGE_QUERIES:
        out = SCRATCH / (q.replace(" ", "_") + ".jpg")
        if out.exists():
            continue
        params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6,
                  "gsrsearch": f"{q} filetype:bitmap", "gsrlimit": 5, "prop": "imageinfo",
                  "iiprop": "url|mime", "iiurlwidth": 640}
        req = urllib.request.Request(api + "?" + urllib.parse.urlencode(params), headers={"User-Agent": "yaaralabs-measure/1.0"})
        pages = json.loads(urllib.request.urlopen(req, timeout=30).read()).get("query", {}).get("pages", {})
        for p in sorted(pages.values(), key=lambda p: p.get("index", 0)):
            info = (p.get("imageinfo") or [{}])[0]
            if info.get("mime") in ("image/jpeg", "image/png") and info.get("thumburl"):
                r = urllib.request.Request(info["thumburl"], headers={"User-Agent": "yaaralabs-measure/1.0"})
                Image.open(io.BytesIO(urllib.request.urlopen(r, timeout=30).read())).convert("RGB").save(out, quality=88)
                break
    return sorted(SCRATCH.glob("*.jpg"))


def image():
    from app.image_training_service import ImageRecognitionTrainer
    base = PUBLIC / "nuvama_documents"
    man = json.loads((base / "manifest.json").read_text(encoding="utf-8"))
    examples = [{"label": l["label"], "image_url": str(base / f)} for l in man["labels"] for f in l["files"]]
    tests = [(base / t["file"], t["expected"]) for t in man["test"]]
    off = offtopic_images()
    print(f"off-topic photos: {len(off)}", flush=True)

    for arch in ("mobilenet", "efficientnet"):
        tr = ImageRecognitionTrainer(arch)

        def local(path, tr=tr):
            return np.array(Image.open(path).convert("RGB").resize(tuple(tr.img_size))).astype(np.float32)

        tr._download_image_to_memory = local
        t0 = time.perf_counter()
        images, labels, names = tr.prepare_training_data_direct(examples)
        tr.train_model_direct(images, labels, names)
        train_s = time.perf_counter() - t0

        def pred(path, tr=tr):
            r = tr.predict_image(str(path))
            return r["predicted_class"], r["confidence"] / 100

        preds, ms = timed(pred, [p for p, _ in tests])
        off_preds, _ = timed(pred, off)
        report(arch, [e for _, e in tests], preds, off_preds, ms, train_s)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    if which in ("image", "both"):
        image()
    if which in ("text", "both"):
        text()
