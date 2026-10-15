"""Tests for the Text Recognition Evaluate step (app/services/text_evaluate_service.py + its route).

Trains the default text model (SentenceEmbedTrainer, modelType sentence_embed_lr) on the 20 sample
custody queries and scores the sample's 14 test messages (12 desk + 2 off-topic), without GCS. The
pinned numbers are what the current model and test set give: if the model, its settings or the test
set change, they change too.

Run from backend/:  .venv/Scripts/python.exe -m unittest test_text_evaluate -v
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.guests import evaluate as evaluate_route
from app.api.guests.guests import get_guest_service
from app.services.text_evaluate_service import (
    NONE_OF_THESE,
    EvaluateError,
    embed_scorer,
    evaluate,
    label_key,
    leave_one_out,
    leave_one_out_embed,
    match_items,
    ovr_scorer,
)
from app.text_embed_service import MODEL_TYPE as EMBED, SentenceEmbedTrainer
from app.text_ovr_service import MODEL_TYPE as OVR, OvrTextClassifierTrainer

SAMPLE = Path(__file__).resolve().parent.parent / "frontend" / "public" / "datasets" / "nuvama_custody_queries.json"
FEES, CORP, KYC, COMPLAINT = "Fees and billing", "Corporate action", "Onboarding and KYC", "Complaint or escalation"
ORDER = [FEES, CORP, KYC, COMPLAINT]


def project_label(name: str) -> str:
    """The label page's name for a sample label (same rule as frontend sample.ts projectLabelName)."""
    return {"fees and billing": FEES, "corporate action": CORP, "onboarding and kyc": KYC,
            "complaint or escalation": COMPLAINT}[label_key(name)]


def desk_counts(items, labels, desk, lean=0):
    """The page's lean slider for one desk, desk messages only (frontend evaluate.ts deskAtLean)."""
    caught = false_alarms = total = 0
    for it in items:
        if it["expected"] == NONE_OF_THESE:
            continue
        s = it["scores"]
        margin = s[desk] - max(s[l] for l in labels if l != desk)
        flagged = it["predicted"] == desk if lean == 0 else margin >= -lean / 100
        if it["expected"] == desk:
            total += 1
            caught += flagged
        else:
            false_alarms += flagged
    return caught, false_alarms, total


def sample():
    data = json.loads(SAMPLE.read_text(encoding="utf-8"))
    examples = [{"text": q["text"], "label": project_label(q["label"])} for q in data["queries"]]
    exam = [{"text": t["text"], "expected": t["expected"]} for t in data["test"]]
    return examples, exam


class EvaluateOnSample(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.examples, cls.exam = sample()
        cls.model = SentenceEmbedTrainer().train_model(cls.examples)["model"]
        cls.labels = cls.model["labels"]
        cls.result = evaluate(embed_scorer(cls.model), EMBED, cls.labels, cls.examples, cls.exam)
        cls.items = cls.result["items"]
        cls.desk = [it for it in cls.items if it["expected"] != NONE_OF_THESE]

    def test_source_and_shape(self):
        self.assertEqual(self.result["source"], "test-set")
        self.assertEqual(self.result["modelType"], EMBED)
        self.assertEqual(len(self.items), 14)
        for it in self.items:
            self.assertEqual(set(it["scores"]), set(ORDER))
            self.assertEqual(it["predicted"], max(it["scores"], key=it["scores"].get))

    def test_practice_20_of_20(self):
        self.assertEqual(self.result["practice"], {"correct": 20, "total": 20})

    def test_exam_10_of_12_desk_messages(self):
        self.assertEqual(len(self.desk), 12)
        self.assertEqual(sum(it["predicted"] == it["expected"] for it in self.desk), 10)

    def test_grid(self):
        grid = {r: [sum(1 for it in self.desk if it["expected"] == r and it["predicted"] == c) for c in ORDER] for r in ORDER}
        self.assertEqual(grid[FEES], [3, 0, 0, 0])
        self.assertEqual(grid[CORP], [0, 3, 0, 0])
        self.assertEqual(grid[KYC], [0, 0, 2, 1])
        self.assertEqual(grid[COMPLAINT], [1, 0, 0, 2])
        missed = {it["text"]: it["predicted"] for it in self.desk if it["predicted"] != it["expected"]}
        self.assertEqual(missed, {
            "Our authorised signatory has left the company. Please remove her.": COMPLAINT,
            "You charged us twice and nobody has fixed it in a month. Escalate this now.": FEES,
        })

    def test_off_topic_scores_low(self):
        off = [it for it in self.items if it["expected"] == NONE_OF_THESE]
        self.assertEqual(len(off), 2)
        for it in off:
            self.assertLess(it["scores"][it["predicted"]], 0.005)  # 0% sure: far below the 50% line

    def test_complaint_precision_recall(self):
        caught, false_alarms, total = desk_counts(self.items, self.labels, COMPLAINT, 0)
        self.assertEqual((caught, total), (2, 3))           # recall 67%
        self.assertEqual(caught + false_alarms, 3)          # flagged 3, right 2: precision 67%

    def test_lean_slider_for_complaint(self):
        self.assertEqual(desk_counts(self.items, self.labels, COMPLAINT, -10), (2, 1, 3))
        self.assertEqual(desk_counts(self.items, self.labels, COMPLAINT, 0), (2, 1, 3))
        self.assertEqual(desk_counts(self.items, self.labels, COMPLAINT, 10), (2, 1, 3))
        self.assertEqual(desk_counts(self.items, self.labels, COMPLAINT, 25), (2, 1, 3))
        self.assertEqual(desk_counts(self.items, self.labels, COMPLAINT, 40), (3, 2, 3))

    def test_lean_zero_is_the_normal_choice(self):
        for desk in ORDER:
            caught, fa, _ = desk_counts(self.items, self.labels, desk, 0)
            self.assertEqual(caught + fa, sum(1 for it in self.desk if it["predicted"] == desk))


class LabelMatching(unittest.TestCase):
    def test_label_key(self):
        self.assertEqual(label_key("Fees & billing"), label_key("Fees and billing"))
        self.assertEqual(label_key("Complaint / escalation"), label_key("Complaint or escalation"))
        self.assertEqual(label_key("Onboarding & KYC"), label_key("onboarding and kyc"))

    def test_match_items_maps_to_project_names(self):
        out = match_items([{"text": "a", "expected": "Fees & billing"}, {"text": "b", "expected": NONE_OF_THESE}], ORDER)
        self.assertEqual(out, [{"text": "a", "expected": FEES}, {"text": "b", "expected": NONE_OF_THESE}])

    def test_match_items_unknown_label(self):
        self.assertIsNone(match_items([{"text": "a", "expected": "Fees & billing"}], ["Billing", CORP]))


class OwnExamples(unittest.TestCase):
    """A renamed label: the exam can't be matched, so the page uses the learner's own examples."""

    @classmethod
    def setUpClass(cls):
        examples, cls.exam = sample()
        cls.examples = [{"text": e["text"], "label": "Billing" if e["label"] == FEES else e["label"]} for e in examples]
        cls.model = SentenceEmbedTrainer().train_model(cls.examples)["model"]
        cls.labels = cls.model["labels"]
        cls.ovr_model = OvrTextClassifierTrainer().train_model(cls.examples)["model"]

    def test_default_model_falls_back_to_leave_one_out(self):
        r = evaluate(embed_scorer(self.model), EMBED, self.labels, self.examples, self.exam,
                     lambda ex: leave_one_out_embed(ex, self.model))
        self.assertEqual(r["source"], "own-examples")
        self.assertEqual(len(r["items"]), 20)
        self.assertEqual({it["expected"] for it in r["items"]}, set(self.labels))
        self.assertEqual(r["practice"], {"correct": 20, "total": 20})
        self.assertGreaterEqual(sum(it["predicted"] == it["expected"] for it in r["items"]), 14)

    def test_word_only_model_falls_back_too(self):
        r = evaluate(ovr_scorer(self.ovr_model), OVR, self.labels, self.examples, self.exam)
        self.assertEqual(r["source"], "own-examples")
        self.assertEqual(len(r["items"]), 20)

    def test_empty_items_use_own_examples(self):
        r = evaluate(ovr_scorer(self.ovr_model), OVR, self.labels, self.examples, [])
        self.assertEqual(r["source"], "own-examples")

    def test_held_out_text_is_not_an_exact_match(self):
        # A held-out example must not score 1.0 by exact match: it was not in that model's training texts
        for it in leave_one_out(self.examples) + leave_one_out_embed(self.examples, self.model):
            self.assertLess(it["scores"][it["expected"]], 1.0)

    def test_other_models_need_the_workshop_labels(self):
        with self.assertRaises(EvaluateError) as ctx:
            evaluate(ovr_scorer(self.ovr_model), "distilbert", self.labels, self.examples, self.exam)
        self.assertIn("Use the workshop labels, or the default model, to evaluate.", str(ctx.exception))


class FakeGuestService:
    def __init__(self, project):
        self.project = project

    async def validate_session(self, session_id):
        return {"session_id": session_id, "active": True}

    async def get_guest_project_by_id(self, project_id):
        return self.project


class Route(unittest.TestCase):
    def client(self, project):
        app = FastAPI()
        app.include_router(evaluate_route.router, prefix="/api/guests")
        app.dependency_overrides[get_guest_service] = lambda: FakeGuestService(project)
        return TestClient(app)

    def post(self, project, items=None):
        return self.client(project).post("/api/guests/session/s1/projects/p1/evaluate", json={"items": items or []})

    def project(self, **over):
        base = {"createdBy": "guest:s1", "type": "text-recognition", "status": "trained",
                "model": {"modelType": OVR, "gcsPath": "x.pkl", "labels": [FEES, CORP]},
                "dataset": {"examples": [{"text": "bill", "label": FEES}, {"text": "dividend", "label": CORP}]}}
        base.update(over)
        return base

    def test_400_when_not_text_recognition(self):
        r = self.post(self.project(type="image-recognition"))
        self.assertEqual(r.status_code, 400)

    def test_400_when_not_trained(self):
        r = self.post(self.project(status="draft"))
        self.assertEqual(r.status_code, 400)

    def test_404_other_session(self):
        r = self.post(self.project(createdBy="guest:someone-else"))
        self.assertEqual(r.status_code, 404)

    def test_400_other_model_without_workshop_labels(self):
        p = self.project(model={"modelType": "distilbert", "gcsPath": "x", "labels": [FEES, CORP]})
        original = evaluate_route.deployed_scorer
        evaluate_route.deployed_scorer = lambda *a: ((lambda t: {FEES: 0.6, CORP: 0.4}), None, lambda: None)
        try:
            r = self.post(p, [{"text": "hi", "expected": "Billing"}])
        finally:
            evaluate_route.deployed_scorer = original
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"], "Use the workshop labels, or the default model, to evaluate.")

    def test_too_many_items(self):
        r = self.post(self.project(), [{"text": "x", "expected": FEES}] * 51)
        self.assertEqual(r.status_code, 422)

    def test_ok_with_in_memory_model(self):
        model = OvrTextClassifierTrainer().train_model([
            {"text": "my bill is high", "label": FEES}, {"text": "invoice please", "label": FEES},
            {"text": "dividend date", "label": CORP}, {"text": "bonus shares", "label": CORP},
        ])["model"]
        original = evaluate_route.deployed_scorer
        evaluate_route.deployed_scorer = lambda *a: (ovr_scorer(model), leave_one_out, lambda: None)
        try:
            r = self.post(self.project(), [{"text": "why is the bill so high", "expected": "Fees & billing"}])
        finally:
            evaluate_route.deployed_scorer = original
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["source"], "test-set")
        self.assertEqual(body["items"][0]["expected"], FEES)


class Progress(unittest.TestCase):
    """The page shows "Tested 6 of 14" while the exam runs (it showed only "Running the exam…")."""

    def setUp(self):
        self.examples, self.exam = sample()
        self.model = OvrTextClassifierTrainer().train_model(self.examples)["model"]
        self.labels = self.model["labels"]

    def test_exam_and_practice_count_up(self):
        seen = []
        evaluate(ovr_scorer(self.model), OVR, self.labels, self.examples, self.exam,
                 progress=lambda stage, done, total: seen.append((stage, done, total)))
        self.assertEqual([s for s in seen if s[0] == "exam"], [("exam", i, 14) for i in range(1, 15)])
        self.assertEqual(seen[-1], ("practice", 20, 20))

    def test_own_examples_count_up(self):
        seen = []
        evaluate(ovr_scorer(self.model), OVR, self.labels, self.examples, [],
                 progress=lambda stage, done, total: seen.append((stage, done, total)))
        own = [s for s in seen if s[0] == "own"]
        self.assertEqual(own[0], ("own", 0, 20))
        self.assertEqual(own[-1], ("own", 20, 20))

    def stream(self, project, scorer, items):
        original = evaluate_route.deployed_scorer
        evaluate_route.deployed_scorer = lambda *a: scorer
        try:
            r = Route().client(project).post("/api/guests/session/s1/projects/p1/evaluate?stream=1", json={"items": items})
        finally:
            evaluate_route.deployed_scorer = original
        self.assertEqual(r.status_code, 200)
        return [json.loads(x) for x in r.text.splitlines() if x.strip()]

    def test_stream_route_sends_progress_then_result(self):
        project = Route().project(model={"modelType": OVR, "gcsPath": "x.pkl", "labels": self.labels},
                                  dataset={"examples": self.examples})
        lines = self.stream(project, (ovr_scorer(self.model), leave_one_out, lambda: None), self.exam)
        self.assertEqual(lines[0]["stage"], "loading")
        self.assertIn({"stage": "exam", "done": 7, "total": 14}, lines)
        self.assertIn({"stage": "practice", "done": 20, "total": 20}, lines)
        self.assertEqual(lines[-1]["result"]["source"], "test-set")
        self.assertEqual(len(lines[-1]["result"]["items"]), 14)

    def test_stream_route_sends_the_error_as_the_last_line(self):
        project = Route().project(model={"modelType": "distilbert", "gcsPath": "x", "labels": [FEES, CORP]})
        lines = self.stream(project, ((lambda t: {FEES: 0.6, CORP: 0.4}), None, lambda: None),
                            [{"text": "hi", "expected": "Billing"}])
        self.assertEqual(lines[-1], {"error": "Use the workshop labels, or the default model, to evaluate.", "status": 400})


class _Blob:
    def __init__(self, name, path, downloads):
        self.name, self.path, self.downloads = name, path, downloads

    def download_to_filename(self, dest):
        self.downloads.append(self.name)
        shutil.copyfile(self.path, dest)


class _Bucket:
    """A folder on disk served as a GCS bucket; counts downloads."""

    def __init__(self, folder):
        self.folder, self.downloads = Path(folder), []

    def list_blobs(self, prefix):
        return [_Blob(f"{prefix}/{f.name}", f, self.downloads) for f in sorted(self.folder.iterdir())]


class DistilBertLoadsOnce(unittest.TestCase):
    """Evaluate on a DistilBERT project downloaded the whole model again for every message (14 exam
    messages + every example), so the live page sat on "Running the exam…" for many minutes."""

    @classmethod
    def setUpClass(cls):
        import torch
        from transformers import AutoTokenizer, DistilBertConfig, DistilBertForSequenceClassification

        torch.manual_seed(0)
        cls.dir = tempfile.TemporaryDirectory()
        AutoTokenizer.from_pretrained("distilbert-base-uncased", local_files_only=True).save_pretrained(cls.dir.name)
        config = DistilBertConfig(n_layers=1, dim=32, hidden_dim=64, n_heads=2, num_labels=2)
        DistilBertForSequenceClassification(config).save_pretrained(cls.dir.name)
        (Path(cls.dir.name) / "metadata.json").write_text(json.dumps({
            "class_names": [FEES, CORP], "label_to_id": {FEES: 0, CORP: 1}, "id_to_label": {"0": FEES, "1": CORP},
            "training_texts": ["my bill is high"], "training_labels": [FEES],
        }))

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_scorer_downloads_the_model_once(self):
        from app.services.text_evaluate_service import deployed_scorer

        bucket = _Bucket(self.dir.name)
        score, _, cleanup = deployed_scorer("distilbert", [FEES, CORP], bucket, "models/m1")
        try:
            for text in ["why was I charged twice", "when is the dividend paid", "my bill is high"] * 5:
                self.assertEqual(set(score(text)), {FEES, CORP})
        finally:
            cleanup()
        self.assertEqual(len(bucket.downloads), len(list(Path(self.dir.name).iterdir())))

    def test_same_answers_as_predict_from_gcs(self):
        from app.training_service import distilbert_trainer

        bucket = _Bucket(self.dir.name)
        predict, cleanup = distilbert_trainer.load_predictor(bucket, "models/m1")
        try:
            for text in ["why was I charged twice", "My bill is high", "bonus shares"]:
                self.assertEqual(predict(text), distilbert_trainer.predict_from_gcs(text, bucket, "models/m1"))
        finally:
            cleanup()


if __name__ == "__main__":
    unittest.main()
