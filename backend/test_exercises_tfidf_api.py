"""HTTP tests for Exercise 2 TF-IDF endpoints, without Firestore."""

from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.exercises import get_project_service, router, validate_session
from app.models import ProjectType
from app.services import exercises_tfidf_service as tfidf_service
from app.services.exercises_tfidf_service import drop_model, sample_payload


SESSION_ID = "sess-e2"
PROJECT_ID = "proj-e2"
BASE = f"/api/exercises/session/{SESSION_ID}/projects/{PROJECT_ID}"
TRAIN_PARAMS = {
    "test_size": 0.25,
    "seed": 42,
    "max_features": 1000,
    "ngram_min": 1,
    "ngram_max": 2,
    "min_df": 1,
    "regularization_c": 1.0,
    "solver": "lbfgs",
    "max_iter": 500,
    "epochs": 100,
    "threshold": 0.5,
}


class FakeProject:
    def __init__(self, project_id: str, session_id: str, project_type: ProjectType) -> None:
        self.id = project_id
        self.student_id = session_id
        self.type = project_type


class FakeProjectService:
    def __init__(self) -> None:
        self.project = FakeProject(PROJECT_ID, SESSION_ID, ProjectType.EXERCISES)

    async def get_project(self, project_id: str):
        if project_id != self.project.id:
            return None
        return self.project


async def fake_session():
    return {"session_id": SESSION_ID}


class TfidfApiTests(unittest.TestCase):
    def setUp(self) -> None:
        drop_model(SESSION_ID, PROJECT_ID)
        # every test trains the same project: forget the last training time so the 3 s "train again" guard
        # (a real classroom protection) doesn't refuse the next test's training
        tfidf_service._LAST_TRAIN.pop(tfidf_service._model_key(SESSION_ID, PROJECT_ID), None)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[validate_session] = fake_session
        app.dependency_overrides[get_project_service] = FakeProjectService
        self.client = TestClient(app)

    def tearDown(self) -> None:
        drop_model(SESSION_ID, PROJECT_ID)

    def test_sample_endpoint(self) -> None:
        res = self.client.get(f"{BASE}/tfidf/sample")
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertIn("review,sentiment", body["csv"])
        self.assertGreaterEqual(body["n_rows"], 20)

    def test_dataset_catalog_and_load(self) -> None:
        listed = self.client.get(f"{BASE}/tfidf/datasets")
        self.assertEqual(listed.status_code, 200, listed.text)
        datasets = listed.json()["datasets"]
        self.assertEqual(len(datasets), 10)
        ids = {item["id"] for item in datasets}
        self.assertIn("cse", ids)
        self.assertIn("civil", ids)
        eee = next(item for item in datasets if item["id"] == "electrical")
        self.assertIn("SCADA", eee["source"])
        self.assertTrue(eee["use_case"].startswith("Sort a same-shift electrical note"))

        cse = self.client.get(f"{BASE}/tfidf/datasets/cse")
        self.assertEqual(cse.status_code, 200, cse.text)
        payload = cse.json()
        self.assertEqual(payload["n_rows"], 40000)
        self.assertGreaterEqual(len(payload["rows"]), 2)
        self.assertLessEqual(len(payload["rows"]), 8)
        self.assertEqual(payload["filename"], "cse_dataset.csv")
        self.assertEqual(len(payload["classes"]), 2)
        self.assertTrue(payload["rows"][0]["review"])
        self.assertTrue(payload["rows"][0]["label"])

        page = self.client.get(f"{BASE}/tfidf/datasets/cse?offset=0&limit=50")
        self.assertEqual(page.status_code, 200, page.text)
        self.assertEqual(len(page.json()["rows"]), 50)
        self.assertEqual(page.json()["n_rows"], 40000)
        later = self.client.get(f"{BASE}/tfidf/datasets/cse?offset=50&limit=50")
        self.assertEqual(later.status_code, 200, later.text)
        self.assertEqual(len(later.json()["rows"]), 50)
        self.assertNotEqual(page.json()["rows"][0]["review"], later.json()["rows"][0]["review"])

        missing = self.client.get(f"{BASE}/tfidf/datasets/not-a-dept")
        self.assertEqual(missing.status_code, 404)

    def test_wrong_project_type_is_rejected(self) -> None:
        service = FakeProjectService()
        service.project = FakeProject(PROJECT_ID, SESSION_ID, ProjectType.TEXT_RECOGNITION)
        self.client.app.dependency_overrides[get_project_service] = lambda: service
        res = self.client.get(f"{BASE}/tfidf/datasets")
        self.assertEqual(res.status_code, 400)

    def test_predict_before_train(self) -> None:
        res = self.client.post(f"{BASE}/tfidf/predict", json={"text": "I love this"})
        self.assertEqual(res.status_code, 409)

    def test_retail_train_and_predict(self) -> None:
        from app.services.exercises_tfidf_service import load_dataset_from_csv

        rows = load_dataset_from_csv(sample_payload()["csv"])
        payload = [{"review": row.review, "label": row.label, "y": row.y} for row in rows]
        trained = self.client.post(
            f"{BASE}/tfidf/train",
            json={"rows": payload, **TRAIN_PARAMS},
        )
        self.assertEqual(trained.status_code, 200, trained.text)
        body = trained.json()
        self.assertFalse(body["simulated"])
        self.assertEqual(body["n_classes"], 2)
        self.assertEqual(body["solver"], "lbfgs")
        self.assertTrue(body["model"]["vocab"])
        self.assertEqual(body["classes"], ["negative", "positive"])
        self.assertEqual(body["curve_kind"], "holdout")
        self.assertAlmostEqual(body["curve"][-1]["acc"], body["test_accuracy"], places=6)
        self.assertEqual(len(body["confusion_matrix"]), 2)

        positive = self.client.post(
            f"{BASE}/tfidf/predict",
            json={"text": "I absolutely love this, it works perfectly!"},
        )
        self.assertEqual(positive.status_code, 200, positive.text)
        pos_body = positive.json()
        self.assertEqual(pos_body["label"], "positive")
        self.assertGreater(pos_body["probability"], 0.5)

        negative = self.client.post(
            f"{BASE}/tfidf/predict",
            json={"text": "Terrible quality, broke and a total waste."},
        )
        self.assertEqual(negative.status_code, 200, negative.text)
        self.assertEqual(negative.json()["label"], "negative")
        self.assertLess(negative.json()["probability"], 0.5)

        stub = self.client.post(f"{BASE}/tfidf/predict", json={"text": "m"})
        self.assertEqual(stub.status_code, 400, stub.text)

    def test_cse_multiclass_train_and_predict(self) -> None:
        loaded = self.client.get(f"{BASE}/tfidf/datasets/cse?limit=200")
        self.assertEqual(loaded.status_code, 200, loaded.text)
        payload = loaded.json()
        self.assertEqual(payload["n_rows"], 40000)
        self.assertGreaterEqual(len(payload["rows"]), 50)
        buckets: dict[str, list] = {}
        for row in payload["rows"]:
            buckets.setdefault(row["label"], []).append({"review": row["review"], "label": row["label"]})
        self.assertEqual(len(buckets), 2)
        rows = []
        for group in buckets.values():
            self.assertGreaterEqual(len(group), 2)
            rows.extend(group[:40])
        trained = self.client.post(
            f"{BASE}/tfidf/train",
            json={"rows": rows, **TRAIN_PARAMS},
        )
        self.assertEqual(trained.status_code, 200, trained.text)
        body = trained.json()
        self.assertEqual(body["n_classes"], 2)
        self.assertEqual(body["solver"], "lbfgs")
        self.assertEqual(len(body["confusion_matrix"]), body["n_classes"])
        self.assertGreaterEqual(body["test_precision"], 0.0)
        self.assertGreaterEqual(body["test_f1"], 0.0)
        self.assertTrue(body["model"]["weights"])
        sample = loaded.json()["examples"][0]["text"]
        scored = self.client.post(f"{BASE}/tfidf/predict", json={"text": sample})
        self.assertEqual(scored.status_code, 200, scored.text)
        pred = scored.json()
        self.assertIn(pred["label"], body["classes"])
        self.assertEqual(len(pred["probs"]), body["n_classes"])

    def test_train_accepts_student_hyperparameters(self) -> None:
        from app.services.exercises_tfidf_service import load_dataset_from_csv

        rows = load_dataset_from_csv(sample_payload()["csv"])
        payload = [{"review": row.review, "label": row.label, "y": row.y} for row in rows]
        trained = self.client.post(
            f"{BASE}/tfidf/train",
            json={
                "rows": payload,
                "test_size": 0.2,
                "seed": 11,
                "max_features": 80,
                "ngram_min": 1,
                "ngram_max": 2,
                "min_df": 1,
                "regularization_c": 2.5,
                "solver": "liblinear",
                "max_iter": 250,
                "epochs": 80,
                "threshold": 0.4,
            },
        )
        self.assertEqual(trained.status_code, 200, trained.text)
        body = trained.json()
        self.assertEqual(body["solver"], "liblinear")
        self.assertEqual(body["regularization_c"], 2.5)
        self.assertEqual(body["max_features"], 80)
        self.assertEqual(body["ngram_max"], 2)
        self.assertEqual(body["seed"], 11)
        self.assertLessEqual(body["n_features"], 80)

    def test_train_embeddings_then_predict(self) -> None:
        from app.services.exercises_tfidf_service import load_dataset_from_csv

        rows = load_dataset_from_csv(sample_payload()["csv"])
        payload = [{"review": row.review, "label": row.label, "y": row.y} for row in rows]
        trained = self.client.post(
            f"{BASE}/tfidf/train",
            json={**TRAIN_PARAMS, "rows": payload, "representation": "embeddings"},
        )
        self.assertEqual(trained.status_code, 200, trained.text)
        body = trained.json()
        self.assertEqual(body["representation"], "embeddings")
        self.assertEqual(body["n_features"], 384)
        scored = self.client.post(f"{BASE}/tfidf/predict", json={"text": "I love this, it works great!"})
        self.assertEqual(scored.status_code, 200, scored.text)
        pred = scored.json()
        self.assertEqual(pred["label"], "positive")
        self.assertGreaterEqual(pred["probability"], 0.5)

    def test_train_rejects_one_class(self) -> None:
        rows = [{"review": "love this product quality", "label": "positive"} for _ in range(6)]
        res = self.client.post(
            f"{BASE}/tfidf/train",
            json={"rows": rows, **TRAIN_PARAMS},
        )
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
