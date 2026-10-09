"""Exercise 4 trains on the server and keeps testing images out of the fit."""

from __future__ import annotations

import io
import time
import unittest
import zipfile

import numpy as np

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.exercises import get_project_service, router, validate_session
from app.models import ProjectType
from app.services import exercises_vision_service as vision


SESSION_ID = "sess-e4"
PROJECT_ID = "proj-e4"
BASE = f"/api/exercises/session/{SESSION_ID}/projects/{PROJECT_ID}/vision"


class FakeProject:
    def __init__(self) -> None:
        self.id = PROJECT_ID
        self.student_id = SESSION_ID
        self.type = ProjectType.EXERCISES


class FakeProjectService:
    async def get_project(self, project_id: str):
        if project_id != PROJECT_ID:
            return None
        return FakeProject()


async def fake_session():
    return {"session_id": SESSION_ID}


class VisionServiceTests(unittest.TestCase):
    def tearDown(self) -> None:
        vision.drop_lab(SESSION_ID, PROJECT_ID)

    def test_catalog_lists_departments(self) -> None:
        body = vision.catalog()
        self.assertEqual(len(body["departments"]), 10)
        civil = body["departments"][0]
        self.assertEqual(civil["code"], "CIVIL")
        self.assertIn("Pothole", civil["classes"])
        self.assertTrue(str(body["driveRoot"]).startswith("https://drive.google.com/"))

    def test_loose_folders_can_be_split_then_prepared(self) -> None:
        rng_files = []
        summary = vision.load_sample(SESSION_ID, PROJECT_ID, "civil")["summary"]
        self.assertTrue(summary["ok"])
        self.assertEqual(summary["train"], 48)
        self.assertEqual(summary["test"], 12)
        prepared = vision.prepare(SESSION_ID, PROJECT_ID)
        self.assertEqual(prepared["K"], 3)
        self.assertGreater(prepared["valCount"], 0)
        self.assertEqual(prepared["nte"], 12)
        self.assertEqual(len(prepared["y"]), prepared["nall"])
        self.assertTrue(all(index < prepared["ntr"] for index in prepared["valIdx"]))
        rng_files.append(prepared)

    def test_knn_learns_the_practice_shapes(self) -> None:
        vision.load_sample(SESSION_ID, PROJECT_ID, "mech")
        vision.prepare(SESSION_ID, PROJECT_ID)
        run = vision.start_train(
            SESSION_ID,
            PROJECT_ID,
            "knn",
            {"k": 3, "metric": "euclidean", "weights": "distance"},
            1,
            background=False,
        )
        self.assertEqual(run["status"], "done")
        self.assertGreaterEqual(run["res"]["acc"], 0.7)
        self.assertLess(run["res"]["acc"], 1)
        self.assertLess(run["valAcc"], 1)
        off = sum(value for row_i, row in enumerate(run["res"]["cm"]) for col_i, value in enumerate(row) if row_i != col_i)
        self.assertGreater(off, 0)
        self.assertEqual(len(run["res"]["cm"]), 3)
        self.assertEqual(sum(sum(row) for row in run["res"]["cm"]), run["res"]["m"])
        self.assertEqual(run["viz"]["kind"], "knn")
        index = vision.state(SESSION_ID, PROJECT_ID)["dataset"]["testIdx"][0]
        guess = vision.predict_index(SESSION_ID, PROJECT_ID, run["id"], index)
        self.assertEqual(guess["pred"], run["res"]["pred"][0])
        self.assertEqual(len(guess["probs"]), 3)
        wide = vision.start_train(
            SESSION_ID,
            PROJECT_ID,
            "knn",
            {"k": 5, "metric": "euclidean", "weights": "distance"},
            1,
            background=False,
        )
        self.assertGreaterEqual(wide["res"]["acc"], 0.7)
        self.assertLess(wide["res"]["acc"], 1)
        self.assertTrue(guess["seen"].startswith("data:image/png"))
        blob = vision.image_bytes(SESSION_ID, PROJECT_ID, index)
        self.assertTrue(blob.startswith(b"\xff\xd8"))

    def test_validation_is_excluded_from_fit_pool(self) -> None:
        vision.load_sample(SESSION_ID, PROJECT_ID, "mech")
        prepared = vision.prepare(SESSION_ID, PROJECT_ID)
        run = vision.start_train(
            SESSION_ID,
            PROJECT_ID,
            "knn",
            {"k": 11, "metric": "euclidean", "weights": "uniform"},
            1,
            background=False,
        )
        self.assertEqual(run["status"], "done")
        lab = vision._lab(SESSION_ID, PROJECT_ID)
        self.assertIsNotNone(lab.dataset)
        self.assertTrue(lab.runs)
        held = set(prepared["valIdx"])
        self.assertTrue(held)
        self.assertTrue(held.isdisjoint(lab.runs[-1].pool))
        self.assertEqual(run["n"], len(lab.runs[-1].pool))
        self.assertLess(run["valAcc"], 1)
        self.assertLess(run["res"]["acc"], 1)

    def test_svm_and_forest_finish(self) -> None:
        vision.load_sample(SESSION_ID, PROJECT_ID, "ece")
        vision.prepare(SESSION_ID, PROJECT_ID)
        svm = vision.start_train(
            SESSION_ID,
            PROJECT_ID,
            "svm",
            {"C": 1, "epochs": 5, "lr": 0.05, "scale": "on"},
            1,
            background=False,
        )
        self.assertEqual(svm["status"], "done")
        self.assertEqual(len(svm["log"]), 5)
        self.assertGreaterEqual(svm["res"]["acc"], 0.5)
        forest = vision.start_train(
            SESSION_ID,
            PROJECT_ID,
            "rf",
            {"trees": 10, "depth": 8, "mtry": "sqrt", "leaf": 1, "boot": "on"},
            0.5,
            background=False,
        )
        self.assertEqual(forest["status"], "done")
        self.assertEqual(forest["viz"]["kind"], "rf")
        self.assertEqual(len(forest["viz"]["treeAcc"]), 10)
        self.assertLess(forest["n"], svm["n"])

    def test_zip_without_split_folders_needs_a_fix(self) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as archive:
            png = _png()
            for name in ("Cat", "Dog"):
                for i in range(8):
                    archive.writestr(f"Dept/{name}/img_{i}.png", png)
        ingested = vision.ingest_zip(SESSION_ID, PROJECT_ID, buf.getvalue(), None)
        self.assertEqual({row["name"] for row in ingested["summary"]["classes"]}, {"Cat", "Dog"})
        self.assertEqual(ingested["summary"]["train"], 12)
        self.assertEqual(ingested["summary"]["test"], 4)
        self.assertTrue(ingested["summary"]["ok"])
        self.assertFalse(any(row["action"] == "fixtest" for row in ingested["summary"]["checks"]))
        prepared = vision.prepare(SESSION_ID, PROJECT_ID)
        self.assertEqual(prepared["K"], 2)
        self.assertGreater(prepared["nte"], 0)

    def test_fix_test_will_not_leave_a_class_under_five(self) -> None:
        stuck = vision.ingest_files(SESSION_ID, PROJECT_ID, _class_files(("A", "B"), 5), None)
        self.assertFalse(stuck["summary"]["ok"])
        self.assertFalse(any(row["action"] == "fixtest" for row in stuck["summary"]["checks"]))
        self.assertTrue(any("6 training images" in row["message"] for row in stuck["summary"]["checks"]))
        stayed = vision.fix_test(SESSION_ID, PROJECT_ID)
        self.assertEqual(stayed["summary"]["train"], 10)
        self.assertEqual(stayed["summary"]["test"], 0)

    def test_fix_test_moves_a_fifth_when_six_or_more_remain(self) -> None:
        vision.ingest_files(SESSION_ID, PROJECT_ID, _class_files(("A", "B"), 8), None)
        fixed = vision.fix_test(SESSION_ID, PROJECT_ID)
        self.assertEqual(fixed["summary"]["train"], 12)
        self.assertEqual(fixed["summary"]["test"], 4)
        self.assertTrue(fixed["summary"]["ok"])

    def test_replace_and_overwrite(self) -> None:
        vision.ingest_files(SESSION_ID, PROJECT_ID, _class_files(("Cat", "Dog"), 6), None, replace=True)
        replaced = vision.ingest_files(SESSION_ID, PROJECT_ID, _class_files(("Stop", "Speed"), 6), None, replace=True)
        names = {row["name"] for row in replaced["summary"]["classes"]}
        self.assertEqual(names, {"Stop", "Speed"})
        again = vision.ingest_files(SESSION_ID, PROJECT_ID, _class_files(("Stop", "Speed"), 6), None)
        self.assertEqual(again["added"], 12)
        self.assertEqual(again["skipped"], 0)
        self.assertEqual({row["name"] for row in again["summary"]["classes"]}, {"Stop", "Speed"})

    def test_class_subfolders_are_all_labelled(self) -> None:
        self.assertEqual(vision.classify_path("Letter B/img.png", None), ("train", "Letter B"))
        self.assertEqual(vision.classify_path("Letters/Letter A/img.png", None), ("train", "Letter A"))
        self.assertEqual(vision.classify_path("Letters/Letter A/batch/img.png", None), ("train", "Letter A"))
        self.assertEqual(vision.classify_path("Letters/Letter A/train/img.png", None), ("train", "Letter A"))
        self.assertEqual(vision.classify_path("Letters/Training Data/Pothole/img.png", None), ("train", "Pothole"))
        self.assertIsNone(vision.classify_path("Training Data/img.png", None))
        png = _png()
        files: list[tuple[str, bytes]] = []
        for name in ("Letter A", "Letter B", "Letter C"):
            for index in range(6):
                files.append((f"Letters/{name}/img_{index}.png", png))
            files.append((f"Letters/{name}/train/extra.png", png))
        ingested = vision.ingest_files(SESSION_ID, PROJECT_ID, files, None, replace=True)
        names = [row["name"] for row in ingested["summary"]["classes"]]
        self.assertEqual(names, ["Letter A", "Letter B", "Letter C"])
        self.assertEqual(ingested["added"], 21)
        self.assertEqual(ingested["skipped"], 0)
        self.assertEqual(sum(row["images"] for row in ingested["summary"]["classes"]), 21)
        self.assertEqual(sum(row["bytes"] for row in ingested["summary"]["classes"]), 21 * len(png))
        self.assertEqual(ingested["summary"]["train"], 18)
        self.assertEqual(ingested["summary"]["test"], 3)
        self.assertEqual(ingested["summary"]["pool"], 0)
        self.assertTrue(ingested["summary"]["ok"])
        second = vision.ingest_files(SESSION_ID, PROJECT_ID, [("Letter D/img_0.png", png)], None)
        self.assertEqual({row["name"] for row in second["summary"]["classes"]}, {"Letter A", "Letter B", "Letter C", "Letter D"})
        self.assertEqual(second["summary"]["classes"][-1]["train"], 1)

    def test_learner_chooses_the_testing_quantity(self) -> None:
        png = _png()
        files = [(f"{name}/img_{index}.png", png) for name in ("A", "B") for index in range(10)]
        vision.ingest_files(SESSION_ID, PROJECT_ID, files, None, replace=True)
        chosen = vision.set_test_share(SESSION_ID, PROJECT_ID, 30)
        self.assertEqual(chosen["summary"]["train"], 14)
        self.assertEqual(chosen["summary"]["test"], 6)
        self.assertTrue(chosen["summary"]["ok"])
        self.assertFalse(any("80 : 20" in row["message"] for row in chosen["summary"]["checks"]))

    def test_closed_folder_is_left_out(self) -> None:
        png = _png()
        files = [(f"{name}/img_{index}.png", png) for name in ("A", "B", "C") for index in range(8)]
        vision.ingest_files(SESSION_ID, PROJECT_ID, files, None, replace=True)
        vision.set_test_share(SESSION_ID, PROJECT_ID, 20)
        closed = vision.set_class_kept(SESSION_ID, PROJECT_ID, "C", False)
        flags = {row["name"]: row["kept"] for row in closed["summary"]["classes"]}
        self.assertEqual(flags, {"A": True, "B": True, "C": False})
        self.assertTrue(closed["summary"]["ok"])
        prepared = vision.prepare(SESSION_ID, PROJECT_ID)
        self.assertEqual([row["name"] for row in prepared["classes"]], ["A", "B"])
        both_closed = vision.set_class_kept(SESSION_ID, PROJECT_ID, "B", False)
        self.assertFalse(both_closed["summary"]["ok"])
        self.assertTrue(any("Tick at least 2 folders" in row["message"] for row in both_closed["summary"]["checks"]))

    def test_upload_times_follow_each_folder(self) -> None:
        png = _png()
        first = vision.ingest_files(SESSION_ID, PROJECT_ID, [("Letter A/a.png", png)], None, replace=True)
        self.assertTrue(first["summary"]["uploadedAt"])
        self.assertEqual(first["summary"]["uploadedAt"], first["summary"]["updatedAt"])
        second = vision.ingest_files(SESSION_ID, PROJECT_ID, [("Letter B/b.png", png)], None)
        self.assertEqual(second["summary"]["uploadedAt"], first["summary"]["uploadedAt"])
        self.assertGreaterEqual(second["summary"]["updatedAt"], first["summary"]["updatedAt"])

    def test_unload_keeps_department_dataset_and_model(self) -> None:
        vision.load_sample(SESSION_ID, PROJECT_ID, "civil")
        vision.prepare(SESSION_ID, PROJECT_ID)
        run = vision.start_train(
            SESSION_ID,
            PROJECT_ID,
            "knn",
            {"k": 3, "metric": "euclidean", "weights": "distance"},
            1,
            background=False,
        )
        index = vision.state(SESSION_ID, PROJECT_ID)["dataset"]["testIdx"][0]
        first = vision.predict_index(SESSION_ID, PROJECT_ID, run["id"], index)
        vision.unload_lab(SESSION_ID, PROJECT_ID)
        state = vision.state(SESSION_ID, PROJECT_ID)
        self.assertEqual(state["department"], "civil")
        self.assertEqual(state["dataset"]["K"], 3)
        self.assertEqual(state["runs"][0]["res"]["acc"], run["res"]["acc"])
        second = vision.predict_index(SESSION_ID, PROJECT_ID, run["id"], index)
        self.assertEqual(second["pred"], first["pred"])
        self.assertEqual(second["probs"], first["probs"])


def _class_files(names: tuple[str, str], count: int) -> list[tuple[str, bytes]]:
    files: list[tuple[str, bytes]] = []
    for kind, name in enumerate(names):
        for index in range(count):
            raw = vision._practice_png(kind, np.random.default_rng(kind * 100 + index))
            files.append((f"Training Data/{name}/img_{index}.png", raw))
    return files


def _png() -> bytes:
    return vision._practice_png(0, np.random.default_rng(1))


class VisionApiTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[validate_session] = fake_session
        app.dependency_overrides[get_project_service] = lambda: FakeProjectService()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        vision.drop_lab(SESSION_ID, PROJECT_ID)

    def test_sample_prepare_and_train_over_http(self) -> None:
        catalog = self.client.get(f"{BASE}/catalog")
        self.assertEqual(catalog.status_code, 200)
        self.assertEqual(len(catalog.json()["departments"]), 10)
        sample = self.client.post(f"{BASE}/sample", json={"department": "cse"})
        self.assertEqual(sample.status_code, 200, sample.text)
        self.assertTrue(sample.json()["summary"]["ok"])
        prepared = self.client.post(f"{BASE}/prepare")
        self.assertEqual(prepared.status_code, 200, prepared.text)
        body = prepared.json()
        self.assertEqual(body["K"], 3)
        image = self.client.get(f"{BASE}/images/0")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.headers["content-type"], "image/jpeg")
        started = self.client.post(f"{BASE}/train", json={"model": "knn", "params": {"k": 1}, "frac": 1})
        self.assertEqual(started.status_code, 200, started.text)
        run_id = started.json()["id"]
        done = None
        for _ in range(200):
            polled = self.client.get(f"{BASE}/runs/{run_id}")
            self.assertEqual(polled.status_code, 200)
            done = polled.json()
            if done["status"] in ("done", "error"):
                break
            time.sleep(0.1)
        self.assertIsNotNone(done)
        self.assertEqual(done["status"], "done")
        self.assertGreaterEqual(done["res"]["acc"], 0.7)
