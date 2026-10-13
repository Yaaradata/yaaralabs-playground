"""
Benchmark text models for Text Recognition projects on the Nuvama custody sample.

Trains each variant on the 20 sample `queries` and prints one row per variant:
  test set: desk messages right (of 12), median / lowest confidence of the right answers,
            confidence of each wrong answer, confidence of the 2 off-topic messages;
  leave-one-out on the 20 queries: right (of 20) and median confidence;
  training time and prediction time (per message, after warm-up).
The current `logistic_regression_ovr` model is the baseline row.

Run from backend/:  .venv/Scripts/python.exe scripts/benchmark_text_models.py
(Downloads the candidate embedding models from Hugging Face the first time.)
"""

from __future__ import annotations

import json
import re
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.text_ovr_service import OvrTextClassifierTrainer, _fit as ovr_fit, _scores as ovr_scores, normalize_text  # noqa: E402
from app.text_embed_service import fit as embed_fit, get_embedder, scores_many  # noqa: E402

SAMPLE = ROOT.parent / "frontend" / "public" / "datasets" / "nuvama_custody_queries.json"
NONE = "None of these"

MODELS = [
    "sentence-transformers/all-MiniLM-L6-v2",
    "BAAI/bge-small-en-v1.5",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
]
VARIANTS = [
    ("CHOSEN: softmax x fam C=50 hi=p10", {"classifier": "softmax", "C": 50.0, "tfidf": False, "familiarity": True, "fam_high_pct": 10}),
    ("ovr x fam C=50 hi=p10", {"classifier": "ovr", "C": 50.0, "tfidf": False, "familiarity": True, "fam_high_pct": 10}),
    ("softmax+tfidf x fam C=200 hi=p10", {"classifier": "softmax", "C": 200.0, "tfidf": True, "familiarity": True, "fam_high_pct": 10}),
    ("ovr", {"classifier": "ovr", "C": 10.0, "tfidf": False, "familiarity": False}),
    ("ovr+tfidf", {"classifier": "ovr", "C": 10.0, "tfidf": True, "familiarity": False}),
    ("softmax x fam (median band)", {"classifier": "softmax", "C": 10.0, "tfidf": False, "familiarity": True, "fam_high_pct": 50}),
    ("softmax x fam C=50 (median band)", {"classifier": "softmax", "C": 50.0, "tfidf": False, "familiarity": True, "fam_high_pct": 50}),
    ("softmax+tfidf x fam (median band)", {"classifier": "softmax", "C": 10.0, "tfidf": True, "familiarity": True, "fam_high_pct": 50}),
]


def project_label(name: str) -> str:
    text = re.sub(r"\s*&\s*", " and ", name)
    text = re.sub(r"\s*/\s*", " or ", text)
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9\s\-_]", " ", text)).strip()


def load():
    data = json.loads(SAMPLE.read_text(encoding="utf-8"))
    texts = [q["text"] for q in data["queries"]]
    labels = [project_label(q["label"]) for q in data["queries"]]
    test = [(t["text"], t["expected"] if t["expected"] == NONE else project_label(t["expected"])) for t in data["test"]]
    return texts, labels, test


def summarise(name, test_scores, test, loo, train_s, pred_ms):
    right, wrong, off = [], [], []
    for (text, expected), s in zip(test, test_scores):
        label = max(s, key=s.get)
        conf = s[label] * 100
        if expected == NONE:
            off.append(conf)
        elif label == expected:
            right.append(conf)
        else:
            wrong.append(conf)
    loo_right = [c for ok, c in loo if ok]
    return {
        "name": name,
        "right": len(right),
        "desk": len(right) + len(wrong),
        "median": statistics.median(right) if right else 0,
        "lowest": min(right) if right else 0,
        "wrong": wrong,
        "off": off,
        "loo": len(loo_right),
        "loo_median": statistics.median([c for _, c in loo]) if loo else 0,
        "train_s": train_s,
        "pred_ms": pred_ms,
    }


def baseline(texts, labels, test):
    started = time.time()
    model = OvrTextClassifierTrainer().train_model([{"text": t, "label": l} for t, l in zip(texts, labels)])["model"]
    train_s = time.time() - started
    started = time.time()
    test_scores = [ovr_scores(model, t) for t, _ in test]
    pred_ms = (time.time() - started) / len(test) * 1000
    norm = [normalize_text(t) for t in texts]
    loo = []
    for i in range(len(texts)):
        m = ovr_fit(norm[:i] + norm[i + 1:], labels[:i] + labels[i + 1:], 20.0)
        s = ovr_scores(m, texts[i])
        p = max(s, key=s.get)
        loo.append((p == labels[i], s[p] * 100))
    return summarise("baseline logistic_regression_ovr", test_scores, test, loo, train_s, pred_ms)


def embed_variant(model_name, variant, settings, texts, labels, test):
    embedder = get_embedder(model_name)
    embedder.warm()
    started = time.time()
    model = embed_fit(texts, labels, embedder, settings)
    train_s = time.time() - started
    started = time.time()
    test_scores = [scores_many(model, [t], embedder)[0] for t, _ in test]
    pred_ms = (time.time() - started) / len(test) * 1000
    emb = embedder.embed(texts)
    loo = []
    for i in range(len(texts)):
        keep = [j for j in range(len(texts)) if j != i]
        m = embed_fit([texts[j] for j in keep], [labels[j] for j in keep], embedder, settings, train_emb=emb[keep])
        s = scores_many(m, [texts[i]], embedder)[0]
        p = max(s, key=s.get)
        loo.append((p == labels[i], s[p] * 100))
    short = model_name.split("/")[-1]
    return summarise(f"{short} | {variant}", test_scores, test, loo, train_s, pred_ms)


def fmt(r):
    wrong = ", ".join(f"{w:.0f}" for w in r["wrong"]) or "-"
    off = ", ".join(f"{o:.0f}" for o in r["off"])
    return (f"{r['name']:<58} {r['right']:>2}/{r['desk']:<2} med {r['median']:>4.0f} low {r['lowest']:>4.0f} "
            f"| wrong [{wrong:<11}] | off [{off:<7}] | LOO {r['loo']:>2}/20 med {r['loo_median']:>4.0f} "
            f"| train {r['train_s']:>5.2f}s pred {r['pred_ms']:>5.1f}ms")


def main():
    texts, labels, test = load()
    print(f"{len(texts)} training queries, {sum(1 for _, e in test if e != NONE)} desk + {sum(1 for _, e in test if e == NONE)} off-topic test messages\n")
    print(fmt(baseline(texts, labels, test)))
    models = sys.argv[1:] or MODELS
    for name in models:
        started = time.time()
        get_embedder(name).warm()
        print(f"\n# {name} (load {time.time() - started:.1f}s)")
        for variant, settings in VARIANTS:
            print(fmt(embed_variant(name, variant, settings, texts, labels, test)))


if __name__ == "__main__":
    main()
