"""Exercise 3 scoring stays on the server and matches the lab flow."""

from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.exercises import get_project_service, router, validate_session
from app.models import ProjectType
from app.services import exercises_metric_service as metric


SESSION_ID = "sess-e3"
PROJECT_ID = "proj-e3"
BASE = f"/api/exercises/session/{SESSION_ID}/projects/{PROJECT_ID}/metric"


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


class MetricServiceTests(unittest.TestCase):
    def tearDown(self) -> None:
        metric.drop_runs(SESSION_ID, PROJECT_ID)

    def test_holdout_from_exercise_2_sets_the_quiz(self) -> None:
        pos = [0.91] * 8 + [0.2] * 2
        neg = [0.1] * 18 + [0.8] * 2
        scored = metric.score_model(
            SESSION_ID,
            PROJECT_ID,
            "ECE",
            "tfidf",
            pos,
            neg,
            "Fail",
        )
        self.assertEqual(scored["positives"], 10)
        self.assertEqual(scored["total"], 30)
        self.assertEqual(scored["department"]["target"], "Fail")
        row = scored["curve"][49]
        self.assertEqual(row["tp"], 8)
        self.assertEqual(row["fp"], 2)
        self.assertEqual(row["fn"], 2)
        precision = metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 0, "80")
        self.assertTrue(precision["ok"])
        self.assertAlmostEqual(precision["answer"], 80.0, places=1)

    def test_catalog_hides_the_answer_key(self) -> None:
        body = metric.catalog()
        self.assertEqual(len(body["departments"]), 10)
        civil = body["departments"][0]
        self.assertEqual(civil["code"], "CIVIL")
        self.assertEqual(civil["target"], "Unsafe")
        self.assertEqual([row[0] for row in civil["classes"]], ["Safe", "Unsafe"])
        self.assertIn("floor joist", civil["sample"].lower())
        self.assertNotIn("diff", civil)
        self.assertNotIn("scen", civil)

    def test_score_then_grade_choice_and_threshold(self) -> None:
        scored = metric.score_model(SESSION_ID, PROJECT_ID, "CIVIL", "emb")
        self.assertEqual(len(scored["curve"]), 99)
        self.assertNotIn("ans", scored["quiz"][0])
        reason_ids = {item["id"] for item in scored["round"]["reasons"]}
        self.assertEqual(reason_ids, {"a", "b", "c", "d"})
        self.assertNotIn("needed", scored["round"])

        row = scored["curve"][49]
        precision = (row["prec"] or 0) * 100
        graded = metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 0, f"{precision:.1f}")
        self.assertTrue(graded["accepted"])
        self.assertTrue(graded["ok"])
        rejected = metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 0, "1")
        self.assertTrue(rejected["accepted"])
        self.assertFalse(rejected["ok"])
        self.assertIsNone(metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 0, "nope")["accepted"] or None)

        # Probe both metrics; the server is the only place that knows the job.
        first = metric.grade_choice(SESSION_ID, PROJECT_ID, scored["runId"], 1, "recall", "a")
        self.assertIn(first["needed"], ("recall", "precision"))
        self.assertIn("critique", first)

        goal = scored["round"]["missionTgt"]
        needed = first["needed"]
        locked_at = next(
            row["k"]
            for row in scored["curve"]
            if (row["rec"] if needed == "recall" else (row["prec"] or 0)) >= goal
            and (needed != "precision" or row["rec"] >= 0.05)
        )
        locked = metric.lock_threshold(SESSION_ID, PROJECT_ID, scored["runId"], 1, locked_at)
        self.assertGreaterEqual(locked["stars"], 1)
        self.assertEqual(locked["locked"], locked_at)

        second = metric.next_round(SESSION_ID, PROJECT_ID, scored["runId"])
        self.assertEqual(second["round"], 2)
        self.assertNotEqual(second["scenario"]["title"], scored["round"]["scenario"]["title"])
        metric.grade_choice(SESSION_ID, PROJECT_ID, scored["runId"], 2, "precision", "b")
        other_goal = second["missionTgt"]
        # Round 2's needed metric is not on the client view; lock via the stored run.
        run = metric._RUNS[scored["runId"]]
        key = run["rounds"][2]["key"]
        locked_at_2 = next(
            row["k"]
            for row in scored["curve"]
            if (row["rec"] if key == "recall" else (row["prec"] or 0)) >= other_goal
            and (key != "precision" or row["rec"] >= 0.05)
        )
        metric.lock_threshold(SESSION_ID, PROJECT_ID, scored["runId"], 2, locked_at_2)
        summary = metric.finish(SESSION_ID, PROJECT_ID, scored["runId"], 2)
        self.assertEqual(summary["department"], "CIVIL")
        self.assertEqual(len(summary["rounds"]), 2)
        self.assertEqual(len(summary["bonus"]), 2)
        self.assertGreaterEqual(summary["total"], 2)

    def test_matrix_anchors_the_exercise_2_cutoff(self) -> None:
        pos = [0.2] * 4
        neg = [0.2] * 4
        matrix = [[1, 3], [0, 2]]
        scored = metric.score_model(
            SESSION_ID,
            PROJECT_ID,
            "ECE",
            "tfidf",
            pos,
            neg,
            "Fail",
            matrix,
            ["Pass", "Fail"],
            0.3,
        )
        anchor = scored["curve"][29]
        self.assertEqual(anchor["k"], 30)
        self.assertEqual((anchor["tp"], anchor["fp"], anchor["fn"]), (2, 3, 0))
        self.assertEqual(scored["curve"][49]["tp"], 0)
        graded = metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 0, "40")
        self.assertTrue(graded["ok"])
        self.assertAlmostEqual(graded["answer"], 40.0, places=1)

    def test_precision_recall_f1_and_accuracy_tally_with_the_cells(self) -> None:
        shapes = (
            (8, 2, 2, 18),
            (0, 0, 4, 6),
            (0, 3, 5, 2),
            (1, 1, 1, 1),
            (5, 0, 0, 5),
        )
        for tp, fp, fn, tn in shapes:
            pos = [0.9] * tp + [0.1] * fn
            neg = [0.9] * fp + [0.1] * tn
            matrix = [[tp, fn], [fp, tn]]
            scored = metric.score_model(
                SESSION_ID,
                PROJECT_ID,
                "ECE",
                "tfidf",
                pos,
                neg,
                "Fail",
                matrix,
                ["Fail", "Pass"],
                0.5,
            )
            notes = len(pos) + len(neg)
            for row in scored["curve"]:
                self.assertEqual(row["tp"] + row["fn"], row["P"], row["k"])
                self.assertEqual(row["fp"] + row["tn"], row["N"], row["k"])
                self.assertEqual(row["P"] + row["N"], notes, row["k"])
                prec = row["tp"] / (row["tp"] + row["fp"]) if row["tp"] + row["fp"] else 0.0
                rec = row["tp"] / row["P"] if row["P"] else 0.0
                f1 = (2 * prec * rec) / (prec + rec) if prec + rec else 0.0
                acc = (row["tp"] + row["tn"]) / notes
                self.assertAlmostEqual(row["prec"], prec, places=9)
                self.assertAlmostEqual(row["rec"], rec, places=9)
                self.assertAlmostEqual(row["f1"], f1, places=9)
                self.assertAlmostEqual(row["acc"], acc, places=9)
            baseline = scored["curve"][49]
            self.assertEqual((baseline["tp"], baseline["fp"], baseline["fn"], baseline["tn"]), (tp, fp, fn, tn))
            precision = metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 0, "0")
            recall = metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 1, "0")
            lazy = metric.grade_answer(SESSION_ID, PROJECT_ID, scored["runId"], 2, "0")
            self.assertAlmostEqual(precision["answer"], baseline["prec"] * 100, places=6)
            self.assertAlmostEqual(recall["answer"], baseline["rec"] * 100, places=6)
            self.assertAlmostEqual(lazy["answer"], (baseline["N"] / notes) * 100, places=6)
            self.assertIn(f"{baseline['prec'] * 100:.1f}%", precision["formula"])
            self.assertIn(f"{baseline['rec'] * 100:.1f}%", recall["formula"])
            self.assertIn(f"{(baseline['N'] / notes) * 100:.1f}%", lazy["formula"])
            metric.drop_runs(SESSION_ID, PROJECT_ID)

    def test_reloaded_run_keeps_round_slots(self) -> None:
        scored = metric.score_model(SESSION_ID, PROJECT_ID, "CIVIL", "tfidf")
        metric._RUNS.pop(scored["runId"])
        choice = metric.grade_choice(SESSION_ID, PROJECT_ID, scored["runId"], 1, "recall", "a")
        self.assertIn(choice["needed"], ("recall", "precision"))


class MetricApiTests(unittest.TestCase):
    def setUp(self) -> None:
        metric.drop_runs(SESSION_ID, PROJECT_ID)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[validate_session] = fake_session
        app.dependency_overrides[get_project_service] = FakeProjectService
        self.client = TestClient(app)

    def tearDown(self) -> None:
        metric.drop_runs(SESSION_ID, PROJECT_ID)

    def test_catalog_and_score_http(self) -> None:
        listed = self.client.get(f"{BASE}/catalog")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(len(listed.json()["departments"]), 10)

        scored = self.client.post(f"{BASE}/score", json={"department": "AERO", "method": "tfidf"})
        self.assertEqual(scored.status_code, 200, scored.text)
        body = scored.json()
        self.assertEqual(body["department"]["target"], "Unserviceable")
        self.assertEqual(len(body["quiz"]), 3)
        self.assertNotIn("ans", body["quiz"][0])

        missed = self.client.post(
            f"{BASE}/answer",
            json={"runId": body["runId"], "index": 1, "raw": "0"},
        )
        self.assertEqual(missed.status_code, 200, missed.text)
        self.assertFalse(missed.json()["ok"])

        unknown = self.client.post(f"{BASE}/score", json={"department": "NOPE", "method": "emb"})
        self.assertEqual(unknown.status_code, 400)


if __name__ == "__main__":
    unittest.main()
