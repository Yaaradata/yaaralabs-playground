"""
Evaluate a trained Text Recognition model (the "Evaluate" step after "Use the AI").

The page shows senior learners accuracy, a confusion grid, precision and recall for one desk, and a
"lean" slider. This service only scores messages: for every item it returns the score of every label
(0-1) and the bot's normal choice. The frontend computes everything else from those scores.

Two sources:
* "test-set": the exam messages the frontend sends (the sample file's `test` list, labels mapped to
  the project's label names). Used when every `expected` is a project label or "None of these".
* "own-examples": leave-one-out on the learner's own examples, for projects whose labels do not
  match the sample (renamed labels, own data). Each example is held out, the model is refitted
  without it, and the held-out example is scored. For the default model (sentence_embed_lr) and the
  older word-only one (logistic_regression_ovr); DistilBERT and the legacy LR can't be refitted here.

Scoring is plain functions over a model dict, so the test (backend/test_text_evaluate.py) runs
without GCS.
"""

import os
import re
import tempfile
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..text_embed_service import MODEL_TYPE as EMBED_MODEL_TYPE
from ..text_ovr_service import DEFAULT_C, MODEL_TYPE as OVR_MODEL_TYPE, _fit, _scores, normalize_text

NONE_OF_THESE = "None of these"
MAX_ITEMS = 50
MAX_LEAVE_ONE_OUT = 200  # one refit per example: 200 is already about a minute of CPU
MAX_TEXT = 500

Scorer = Callable[[str], Dict[str, float]]
LeaveOneOut = Callable[[List[Dict[str, str]]], List[Dict[str, Any]]]


class EvaluateError(ValueError):
    """A request the page can't evaluate (shown to the learner as the message)."""


# ------------------------------------------------------------------ labels


def label_key(name: str) -> str:
    """Compare label names the way the label page writes them: "Fees & billing" == "Fees and billing"."""
    text = str(name or "")
    text = re.sub(r"\s*&\s*", " and ", text)
    text = re.sub(r"\s*/\s*", " or ", text)
    text = re.sub(r"[^a-zA-Z0-9\s\-_]", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def match_items(items: List[Dict[str, str]], labels: List[str]) -> Optional[List[Dict[str, str]]]:
    """Items with `expected` mapped to the project's label names, or None if any label doesn't match."""
    by_key = {label_key(label): label for label in labels}
    matched = []
    for item in items:
        expected = str(item.get("expected", ""))
        if expected == NONE_OF_THESE:
            name = NONE_OF_THESE
        else:
            name = by_key.get(label_key(expected))
            if name is None:
                return None
        matched.append({"text": str(item.get("text", "")), "expected": name})
    return matched


# ------------------------------------------------------------------ scoring


def _choice(scores: Dict[str, float]) -> str:
    return max(scores.items(), key=lambda kv: kv[1])[0]


def ovr_scorer(model: Dict[str, Any]) -> Scorer:
    return lambda text: _scores(model, text)


def embed_scorer(model: Dict[str, Any]) -> Scorer:
    from ..text_embed_service import embed_text_trainer

    return lambda text: embed_text_trainer.scores(model, [text])[0]


def scorer_from_prediction(predict: Callable[[str], Dict[str, Any]], labels: List[str]) -> Scorer:
    """DistilBERT / legacy LR: build the score dict from `label` + `alternatives` (0-100 -> 0-1)."""

    def score(text: str) -> Dict[str, float]:
        result = predict(text)
        scores = {label: 0.0 for label in labels}
        scores[str(result["label"])] = float(result.get("confidence", 0)) / 100
        for alt in result.get("alternatives") or []:
            scores[str(alt["label"])] = float(alt.get("confidence", 0)) / 100
        return scores

    return score


def score_items(score: Scorer, items: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    out = []
    for item in items:
        scores = score(item["text"])
        out.append({
            "text": item["text"],
            "expected": item["expected"],
            "predicted": _choice(scores),
            "scores": {label: round(value, 4) for label, value in scores.items()},
        })
    return out


def practice(score: Scorer, examples: List[Dict[str, str]]) -> Dict[str, int]:
    """The deployed model on the messages it learned from."""
    correct = sum(_choice(score(ex["text"])) == ex["label"] for ex in examples)
    return {"correct": correct, "total": len(examples)}


def _held_out(examples: List[Dict[str, str]], refit_and_score: Callable[[List[int], int], Dict[str, float]]) -> List[Dict[str, Any]]:
    labels = [ex["label"] for ex in examples]
    out = []
    for i, ex in enumerate(examples):
        keep = [j for j in range(len(examples)) if j != i]
        if len({labels[j] for j in keep}) < 2:
            continue  # can't train a 2-label model without this example
        scores = refit_and_score(keep, i)
        for label in set(labels) - set(scores):
            scores[label] = 0.0  # the only example of this label was held out
        out.append({
            "text": ex["text"],
            "expected": ex["label"],
            "predicted": _choice(scores),
            "scores": {label: round(value, 4) for label, value in scores.items()},
        })
    return out


def leave_one_out(examples: List[Dict[str, str]], c_value: float = DEFAULT_C) -> List[Dict[str, Any]]:
    """Word-only model (logistic_regression_ovr): hold out each example, refit, score it."""
    texts = [normalize_text(ex["text"]) for ex in examples]
    labels = [ex["label"] for ex in examples]
    return _held_out(
        examples,
        lambda keep, i: _scores(_fit([texts[j] for j in keep], [labels[j] for j in keep], c_value), examples[i]["text"]),
    )


def leave_one_out_embed(examples: List[Dict[str, str]], model: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Sentence-meaning model: same settings as the deployed model; embeddings computed once."""
    from ..text_embed_service import fit, get_embedder, scores_many

    embedder = get_embedder(model.get("embed_model"))
    texts = [ex["text"] for ex in examples]
    labels = [ex["label"] for ex in examples]
    emb = embedder.embed(texts)

    def refit_and_score(keep: List[int], i: int) -> Dict[str, float]:
        m = fit([texts[j] for j in keep], [labels[j] for j in keep], embedder, model.get("settings"), train_emb=emb[keep])
        return scores_many(m, [texts[i]], embedder)[0]

    return _held_out(examples, refit_and_score)


def evaluate(
    score: Scorer,
    model_type: str,
    labels: List[str],
    examples: List[Dict[str, str]],
    items: List[Dict[str, str]],
    own_examples: Optional[LeaveOneOut] = None,
) -> Dict[str, Any]:
    """The whole response body, from a scorer for the deployed model. `own_examples` runs the
    leave-one-out when the exam can't be used (default: the word-only model's)."""
    if len(items) > MAX_ITEMS:
        raise EvaluateError(f"Send at most {MAX_ITEMS} messages.")
    for item in items:
        if not str(item.get("text", "")).strip():
            raise EvaluateError("Every message needs some text.")
        if len(str(item["text"])) > MAX_TEXT:
            raise EvaluateError(f"Messages can be at most {MAX_TEXT} characters.")

    matched = match_items(items, labels) if items else None
    if matched is not None:
        source, scored = "test-set", score_items(score, matched)
    else:
        if model_type not in (OVR_MODEL_TYPE, EMBED_MODEL_TYPE):
            raise EvaluateError("Use the workshop labels, or the default model, to evaluate.")
        if len(examples) > MAX_LEAVE_ONE_OUT:
            raise EvaluateError(f"The exam on your own examples works with at most {MAX_LEAVE_ONE_OUT} examples.")
        source, scored = "own-examples", (own_examples or leave_one_out)(examples)

    return {
        "success": True,
        "source": source,
        "modelType": model_type,
        "labels": labels,
        "items": scored,
        "practice": practice(score, examples),
    }


# ------------------------------------------------------------------ deployed model


def project_examples(guest_project: Dict[str, Any]) -> List[Dict[str, str]]:
    """The learner's examples, as the train endpoint reads them."""
    out = []
    for ex in guest_project.get("dataset", {}).get("examples", []) or []:
        if isinstance(ex, dict) and str(ex.get("text", "")).strip() and str(ex.get("label", "")).strip():
            out.append({"text": str(ex["text"]), "label": str(ex["label"]).strip()})
    return out


def deployed_scorer(
    model_type: str, labels: List[str], bucket, gcs_path: str
) -> Tuple[Scorer, Optional[LeaveOneOut], Callable[[], None]]:
    """A scorer for the deployed model (loaded once), its leave-one-out, and a cleanup function."""
    from ..text_embed_service import embed_text_trainer
    from ..text_ovr_service import ovr_text_trainer
    from ..training_service import distilbert_trainer, trainer

    if model_type == EMBED_MODEL_TYPE:
        model = embed_text_trainer.load(bucket, gcs_path)
        return embed_scorer(model), (lambda examples: leave_one_out_embed(examples, model)), lambda: None

    if model_type == OVR_MODEL_TYPE:
        return ovr_scorer(ovr_text_trainer._load(bucket, gcs_path)), leave_one_out, lambda: None

    if model_type == "distilbert":
        # The DistilBERT trainer has no in-memory predict; each call downloads the model.
        return scorer_from_prediction(lambda t: distilbert_trainer.predict_from_gcs(t, bucket, gcs_path), labels), None, lambda: None

    # Legacy Logistic Regression: download once, predict from the local file
    fd, path = tempfile.mkstemp(suffix=".pkl")
    os.close(fd)
    bucket.blob(gcs_path).download_to_filename(path)
    return scorer_from_prediction(lambda t: trainer.predict(t, path), labels), None, lambda: os.path.exists(path) and os.remove(path)
