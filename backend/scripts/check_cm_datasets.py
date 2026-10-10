"""Checks the Exercise 3 teaching datasets against the Ex 3 settings, for both models:

  1. every option of every setting changes the confusion matrix (no two options give the same one)
  2. the level presets improve step by step: Intermediate beats Basic and Advanced beats
     Intermediate, on both accuracy and F1

Vocabulary and "what it reads" are also checked on a flexible model (C = 100), where rare words count.
Keep OPTIONS and PRESETS in step with frontend/components/ConfusionMatrix/settings.ts.
Run from backend/:
    python scripts/check_cm_datasets.py [dataset ids...]
"""

from __future__ import annotations

import os
import sys
from itertools import combinations

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import cm_datasets, cm_trainer  # noqa: E402

THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
OPTIONS = {
    "lr": {
        "threshold": THRESHOLDS, "testSplit": [0.1, 0.2, 0.3], "C": [0.1, 0.5, 1, 10, 100], "ngrams": [1, 2],
        "maxFeatures": [500, 1000, 2000, 5000], "maxIter": [3, 5, 10, 100],
    },
    "bert": {
        "threshold": THRESHOLDS, "testSplit": [0.1, 0.2, 0.3], "maxLen": [16, 24, 32, 64], "epochs": [1, 3, 5, 10, 20],
        "lr": [0.001, 0.01, 0.1], "batch": [8, 16, 32],
    },
}
DEFAULTS = {
    "lr": {"threshold": 0.5, "testSplit": 0.2, "C": 1, "ngrams": 2, "maxFeatures": 5000, "maxIter": 100},
    "bert": {"threshold": 0.5, "testSplit": 0.2, "maxLen": 64, "epochs": 5, "lr": 0.01, "batch": 16},
}
PRESETS = {  # changes on top of the Basic settings
    "lr": {"intermediate": {"C": 10}, "advanced": {"C": 10, "threshold": 0.4}},
    "bert": {"intermediate": {"epochs": 10, "lr": 0.001}, "advanced": {"epochs": 20, "lr": 0.001}},
}
FLEXIBLE_TOO = {"lr": ("maxFeatures", "ngrams")}


def run(ds, model, params):
    fit, _ = cm_trainer.train(ds, params, model=model)
    m = cm_trainer.metrics(fit.labels, fit.scores, params["threshold"])
    return (m["tp"], m["fn"], m["fp"], m["tn"]), m


def main(ids, models):
    failures = 0
    for dataset_id in ids:
        ds = cm_datasets.load_sample(dataset_id)
        print(f"\n== {ds.name} ({dataset_id}): {len(ds.y)} items, {ds.counts[0]} {ds.classes[0]} / {ds.counts[1]} {ds.classes[1]}")
        for model in models:
            base = DEFAULTS[model]
            for key, values in OPTIONS[model].items():
                bases = {"default": {}}
                if key in FLEXIBLE_TOO.get(model, ()):
                    bases["flexible"] = {"C": 100}
                for base_name, extra in bases.items():
                    cells = {}
                    for v in values:
                        cells[v], m = run(ds, model, {**base, **extra, key: v})
                        print(f"  {model:4} {base_name:8} {key:11} {str(v):6} TP {m['tp']:3} FN {m['fn']:3} FP {m['fp']:3} "
                              f"TN {m['tn']:3}  acc {m['accuracy']:.3f}")
                    same = [(a, b) for a, b in combinations(values, 2) if cells[a] == cells[b]]
                    if same:
                        failures += 1
                        print(f"  !! {model} {key} ({base_name}): same matrix for {same}")
            levels = [("basic", base), ("intermediate", {**base, **PRESETS[model]["intermediate"]}),
                      ("advanced", {**base, **PRESETS[model]["advanced"]})]
            scores = []
            for name, params in levels:
                _, m = run(ds, model, params)
                scores.append((m["accuracy"], m["f1"]))
                print(f"  {model:4} level    {name:12} acc {m['accuracy']:.3f}  F1 {m['f1']:.3f}  "
                      f"(TP {m['tp']} FN {m['fn']} FP {m['fp']} TN {m['tn']})")
            for (lo_name, _), (hi_name, _), lo, hi in zip(levels, levels[1:], scores, scores[1:]):
                if not (hi[0] > lo[0] and hi[1] > lo[1]):
                    failures += 1
                    print(f"  !! {model}: {hi_name} does not beat {lo_name} on accuracy and F1")
    print(f"\n{'ALL CHECKS PASS' if not failures else f'{failures} check(s) failed'}")
    return failures


if __name__ == "__main__":
    args = sys.argv[1:]
    chosen_models = [a for a in args if a in OPTIONS] or list(OPTIONS)
    chosen_ids = [a for a in args if a not in OPTIONS] or ["client_emails", "it_tickets", "feedback"]
    sys.exit(1 if main(chosen_ids, chosen_models) else 0)
