"""
Text Recognition: does the model the app predicts with score the same as the model it trained?

Trains each text model the app can train on the 20 sample custody queries and scores the sample's 12
desk test messages (plus how sure it is about the 2 off-topic ones) twice: with the trained model in
memory, and after saving and loading through an in-memory bucket with the app's own load + predict
functions (the path Use the AI, Evaluate and deployed models take). The two must agree.

  sentence_embed_lr        the default (training page "Logistic Regression")
  logistic_regression_ovr  the older word-only model
  distilbert               used when the training request names no model

Run from backend/:  .venv/Scripts/python.exe scripts/check_text_roundtrip.py [model ...]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

SAMPLE = ROOT.parent / "frontend" / "public" / "datasets" / "nuvama_custody_queries.json"
NONE = "None of these"


def project_label(name: str) -> str:
    """As the label page writes them: "Fees & billing" -> "Fees and billing"."""
    name = re.sub(r"\s*&\s*", " and ", name)
    name = re.sub(r"\s*/\s*", " or ", name)
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9\s\-_]", " ", name)).strip()


class Blob:
    def __init__(self, store, name):
        self.store, self.name, self.generation = store, name, 1

    def upload_from_string(self, data, content_type=None, timeout=None, **_):
        self.store[self.name] = data.encode() if isinstance(data, str) else data

    def upload_from_filename(self, path, content_type=None, timeout=None):
        self.store[self.name] = Path(path).read_bytes()

    def download_as_bytes(self):
        return self.store[self.name]

    def download_as_text(self):
        return self.store[self.name].decode()

    def download_to_filename(self, path):
        Path(path).write_bytes(self.store[self.name])

    def exists(self):
        return self.name in self.store


class Bucket:
    def __init__(self):
        self.store = {}

    def blob(self, name):
        return Blob(self.store, name)

    def get_blob(self, name):
        return Blob(self.store, name) if name in self.store else None

    def list_blobs(self, prefix=None, **_):
        return [Blob(self.store, n) for n in sorted(self.store) if not prefix or n.startswith(prefix)]


def summary(preds, tests):
    """(right of desk messages, total, mean confidence on desk messages, off-topic confidences)"""
    desk = [(p, t) for p, t in zip(preds, tests) if t["expected"] != NONE]
    right = sum(p["label"] == t["expected"] for p, t in desk)
    conf = sum(p["confidence"] for p, _ in desk) / len(desk)
    off = [round(p["confidence"]) for p, t in zip(preds, tests) if t["expected"] == NONE]
    return right, len(desk), conf, off


def run(kind, examples, tests):
    bucket = Bucket()
    texts = [t["text"] for t in tests]
    if kind in ("sentence_embed_lr", "logistic_regression_ovr"):
        if kind == "sentence_embed_lr":
            from app.text_embed_service import SentenceEmbedTrainer as T
        else:
            from app.text_ovr_service import OvrTextClassifierTrainer as T
        trainer = T()
        model = trainer.train_model(examples)["model"]
        before = [trainer.predict(model, t) for t in texts]
        trainer.save_model_to_gcs(bucket, "models/p.pkl", model)
        fresh = T()  # a new process: nothing cached
        after = [fresh.predict_from_gcs(t, bucket, "models/p.pkl") for t in texts]
    else:
        import torch
        from app.training_service import DistilBERTTrainer, TextExample

        import os
        import time

        trainer = DistilBERTTrainer()
        # DISTILBERT="epochs=20,learning_rate=5e-5,batch_size=8" tries other settings
        for kv in filter(None, os.environ.get("DISTILBERT", "").split(",")):
            k, v = kv.split("=")
            setattr(trainer, k, type(getattr(trainer, k))(float(v)) if k != "learning_rate" else float(v))
        started = time.time()
        result = trainer.train_model([TextExample(text=e["text"], label=e["label"]) for e in examples])
        print(f"distilbert epochs={trainer.epochs} lr={trainer.learning_rate} batch={trainer.batch_size}: "
              f"trained in {time.time() - started:.0f} s, training accuracy {result['accuracy']:.0%}")
        m, tok = result["model"], result["tokenizer"]
        m.eval()
        before = []
        with torch.no_grad():
            for t in texts:
                enc = tok(t, truncation=True, padding="max_length", max_length=64, return_tensors="pt")
                p = torch.softmax(m(**enc).logits, dim=-1)[0]
                i = int(p.argmax())
                before.append({"label": trainer.class_names[i], "confidence": float(p[i]) * 100})
        trainer.save_model_to_gcs(bucket, "models/p", m, tok)
        after = [DistilBERTTrainer().predict_from_gcs(t, bucket, "models/p") for t in texts]
    return summary(before, tests), summary(after, tests)


def main():
    d = json.loads(SAMPLE.read_text(encoding="utf-8"))
    examples = [{"text": q["text"], "label": project_label(q["label"])} for q in d["queries"]]
    tests = [{"text": t["text"], "expected": t["expected"] if t["expected"] == NONE else project_label(t["expected"])} for t in d["test"]]
    kinds = sys.argv[1:] or ["sentence_embed_lr", "logistic_regression_ovr", "distilbert"]
    fmt = lambda s: f"desk {s[0]:>2}/{s[1]} (avg {s[2]:.0f}% sure)  off-topic {s[3]}% sure"  # noqa: E731
    ok = True
    for kind in kinds:
        before, after = run(kind, examples, tests)
        same = before[0] == after[0] and abs(before[2] - after[2]) < 0.5
        ok &= same
        print(f"{kind:<24} trained   {fmt(before)}")
        print(f"{'':<24} reloaded  {fmt(after)}   {'same' if same else 'DIFFERENT'}")
    print("\nOK: every reloaded model predicts like the trained one" if ok else "\nFAIL: a reloaded model predicts differently")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
