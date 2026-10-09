"""Exercise 2 held-out scores drive Exercise 3 for every department file.

Trains on real notes from each CSV, passes the same class probabilities the
frontend stores, then checks right and wrong answers on both rounds.
"""

from __future__ import annotations

import csv
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.exercises import get_project_service, router, validate_session
from app.models import ProjectType
from app.services import exercises_metric_service as metric
from app.services import exercises_tfidf_datasets as datasets
from app.services.exercises_tfidf_service import drop_model, rows_from_payload, train


PER_CLASS = 20


def _sample_payload(dataset_id: str) -> list[dict[str, str]]:
    buckets = {name: [] for name in datasets.CLASSES[dataset_id]}
    with datasets.dataset_path(dataset_id).open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            label = str(row.get("label", "")).strip()
            if label not in buckets or len(buckets[label]) >= PER_CLASS:
                continue
            buckets[label].append({"review": row.get("text") or "", "label": label})
            if all(len(group) >= PER_CLASS for group in buckets.values()):
                break
    payload = [item for group in buckets.values() for item in group]
    if any(len(group) < 8 for group in buckets.values()):
        raise AssertionError(f"{dataset_id} did not yield enough real notes")
    return payload


def _focus_scores(result: dict, focus: str) -> tuple[list[float], list[float]]:
    classes = result["classes"]
    index = classes.index(focus)
    pos: list[float] = []
    neg: list[float] = []
    for row in result["test_probs"]:
        probs = row.get("probs") or []
        if len(probs) != len(classes):
            raise AssertionError("Exercise 2 did not return a probability for every class")
        bucket = pos if row["y"] == index else neg
        bucket.append(float(probs[index]))
    return pos, neg


def _meets(row: dict, key: str, target: float) -> bool:
    if key == "recall":
        return row["rec"] >= target - 1e-9
    return row["prec"] is not None and row["prec"] >= target - 1e-9


class _Project:
    def __init__(self, project_id: str, session_id: str) -> None:
        self.id = project_id
        self.student_id = session_id
        self.type = ProjectType.EXERCISES


class Ex2ToEx3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = {item["code"]: item for item in metric.catalog()["departments"]}

    def _client(self, session_id: str, project_id: str) -> TestClient:
        app = FastAPI()
        app.include_router(router)

        async def fake_session():
            return {"session_id": session_id}

        class Projects:
            async def get_project(self, project_id: str):
                if project_id != project_id:
                    return _Project(project_id, session_id)
                return _Project(project_id, session_id)

        app.dependency_overrides[validate_session] = fake_session
        app.dependency_overrides[get_project_service] = Projects
        return TestClient(app)

    def test_catalog_uses_dataset_labels(self) -> None:
        self.assertEqual(len(self.catalog), 10)
        expected = {
            "CIVIL": "Unsafe",
            "MECH": "Fault",
            "EEE": "Fault",
            "ECE": "Fail",
            "CSE": "Bug",
            "IT": "System Fault",
            "CHEM": "Abnormal",
            "AERO": "Unserviceable",
            "AUTOMOBILE": "Unsafe to Drive",
            "BME": "Device Fault",
        }
        for code, focus in expected.items():
            dept = self.catalog[code]
            labels = [row[0] for row in dept["classes"]]
            self.assertIn(focus, labels, code)
            self.assertEqual(dept["target"], focus)
            self.assertTrue(dept["sample"].strip(), code)
            self.assertNotIn("Seepage", " ".join(labels))

    def test_each_department_job_matches_its_cost(self) -> None:
        for dataset_id in datasets.DEPARTMENT_ORDER:
            code = datasets.SHORT_NAMES[dataset_id]
            dept = self.catalog[code]
            classes = [row[0] for row in dept["classes"]]
            focus = dept["target"]
            self.assertIn(focus, datasets.CLASSES[dataset_id])
            self.assertTrue(dept["sample"].strip(), code)
            for key in ("recall", "precision"):
                job = metric._JOBS[dataset_id][key]
                self.assertIn(focus, job["flow"])
                if key == "recall":
                    self.assertGreater(job["fn"], job["fp"], f"{code} recall job must cost more for a miss")
                else:
                    self.assertGreater(job["fp"], job["fn"], f"{code} precision job must cost more for a false alarm")
                for other in classes:
                    if other == focus:
                        continue
                    blob = " ".join([job["flow"], job["miss"], job["fa"]])
                    if other in blob:
                        self.assertIn(other, classes)

    def test_every_department_and_method(self) -> None:
        failures: list[str] = []
        records: list[dict] = []
        for dataset_id in datasets.DEPARTMENT_ORDER:
            for representation in ("tfidf", "embeddings"):
                try:
                    records.append(self._run_pair(dataset_id, representation))
                except Exception as exc:
                    failures.append(f"{dataset_id}/{representation}: {exc}")
                    records.append({"dataset_id": dataset_id, "representation": representation, "error": str(exc)})
        _write_report(records, failures)
        self.assertFalse(failures, "\n".join(failures))

    def _run_pair(self, dataset_id: str, representation: str) -> None:
        code = datasets.SHORT_NAMES[dataset_id]
        focus = self.catalog[code]["target"]
        session_id = f"sess-{dataset_id}-{representation}"
        project_id = f"proj-{dataset_id}-{representation}"
        method = "emb" if representation == "embeddings" else "tfidf"
        payload = _sample_payload(dataset_id)
        rows = rows_from_payload(payload)
        try:
            trained = train(
                session_id,
                project_id,
                rows,
                0.3,
                7,
                400,
                1,
                1,
                1,
                1.0,
                "lbfgs",
                80,
                0.5,
                5,
                representation,
            )
        finally:
            drop_model(session_id, project_id)

        self.assertIn(focus, trained["classes"])
        pos, neg = _focus_scores(trained, focus)
        self.assertGreaterEqual(len(pos), 4, f"{code} positives")
        self.assertGreaterEqual(len(neg), 4, f"{code} negatives")

        client = self._client(session_id, project_id)
        base = f"/api/exercises/session/{session_id}/projects/{project_id}/metric"
        scored = client.post(
            f"{base}/score",
            json={"department": code, "method": method, "focus": focus, "pos": pos, "neg": neg},
        )
        self.assertEqual(scored.status_code, 200, scored.text)
        body = scored.json()
        self.assertEqual(body["department"]["target"], focus)
        self.assertEqual(body["positives"], len(pos))
        self.assertEqual(body["total"], len(pos) + len(neg))
        self.assertIn(focus, body["quiz"][0]["question"])
        self.assertIn("column", body["quiz"][0]["question"])
        self.assertIn("row", body["quiz"][1]["question"])
        self.assertIn(datasets.FULL_NAMES[dataset_id], body["quiz"][0]["question"])
        self.assertIn(focus, body["round"]["scenario"]["flow"])
        self.assertNotIn("ans", body["quiz"][0])

        row = body["curve"][49]
        self.assertEqual(row["tp"] + row["fn"], len(pos))
        self.assertEqual(row["fp"] + row["tn"], len(neg))
        flagged = row["tp"] + row["fp"]
        if flagged:
            self.assertAlmostEqual(row["prec"], row["tp"] / flagged, places=6)

        run_id = body["runId"]
        quiz_rows = []
        for index, key in enumerate(("prec", "rec", "acc")):
            wrong = client.post(f"{base}/answer", json={"runId": run_id, "index": index, "raw": "250"})
            self.assertEqual(wrong.status_code, 200, wrong.text)
            self.assertFalse(wrong.json()["ok"], f"{code} {key} wrongly accepted")
            right_value = f"{wrong.json()['answer']:.1f}"
            right = client.post(f"{base}/answer", json={"runId": run_id, "index": index, "raw": right_value})
            self.assertTrue(right.json()["ok"], f"{code} {key} {right_value} vs {right.json()}")
            explanation = right.json()["explanation"].lower()
            self.assertIn(focus.lower() if index < 2 else "not", explanation)
            quiz_rows.append(
                {
                    "question": body["quiz"][index]["question"],
                    "wrong": "250",
                    "wrong_ok": False,
                    "answer": right_value,
                    "right_ok": True,
                    "formula": right.json()["formula"],
                }
            )

        round_rows = [self._round(client, base, body, run_id, 1, focus)]
        second = client.post(f"{base}/round", json={"runId": run_id})
        self.assertEqual(second.status_code, 200, second.text)
        nxt = second.json()
        self.assertEqual(nxt["round"], 2)
        self.assertNotEqual(nxt["scenario"]["title"], body["round"]["scenario"]["title"])
        self.assertIn(focus, nxt["scenario"]["flow"])
        round_rows.append(self._round(client, base, {"curve": body["curve"], "round": nxt}, run_id, 2, focus))

        finished = client.post(f"{base}/finish", json={"runId": run_id, "readScore": 3})
        self.assertEqual(finished.status_code, 200, finished.text)
        summary = finished.json()
        self.assertEqual(summary["department"], code)
        self.assertEqual(len(summary["rounds"]), 2)
        self.assertEqual({item["needed"] for item in summary["rounds"]}, {"recall", "precision"})
        self.assertEqual(summary["total"], sum(item["points"] for item in summary["rounds"]))
        self.assertNotIn("other", summary)
        return {
            "dataset_id": dataset_id,
            "representation": representation,
            "code": code,
            "name": datasets.FULL_NAMES[dataset_id],
            "focus": focus,
            "classes": trained["classes"],
            "sample": self.catalog[code]["sample"],
            "positives": len(pos),
            "negatives": len(neg),
            "matrix": {"tp": row["tp"], "fn": row["fn"], "fp": row["fp"], "tn": row["tn"]},
            "quiz": quiz_rows,
            "rounds": round_rows,
            "total": summary["total"],
            "round_points": [item["points"] for item in summary["rounds"]],
        }

    def _round(self, client: TestClient, base: str, scored: dict, run_id: str, round_no: int, focus: str) -> None:
        reasons = scored["round"]["reasons"]
        probe = client.post(
            f"{base}/choice",
            json={"runId": run_id, "round": round_no, "metric": "recall", "reasonId": reasons[0]["id"]},
        )
        self.assertEqual(probe.status_code, 200, probe.text)
        needed = probe.json()["needed"]
        self.assertIn(needed, ("recall", "precision"))
        if probe.json()["metricCorrect"]:
            self.assertEqual(needed, "recall")
        else:
            self.assertEqual(needed, "precision")

        wrong_metric = "precision" if needed == "recall" else "recall"
        flipped = client.post(
            f"{base}/choice",
            json={"runId": run_id, "round": round_no, "metric": wrong_metric, "reasonId": reasons[0]["id"]},
        )
        self.assertFalse(flipped.json()["metricCorrect"], focus)

        correct_flags = []
        for reason in reasons:
            graded = client.post(
                f"{base}/choice",
                json={"runId": run_id, "round": round_no, "metric": needed, "reasonId": reason["id"]},
            )
            self.assertEqual(graded.status_code, 200, graded.text)
            self.assertTrue(graded.json()["metricCorrect"])
            self.assertIn(focus, graded.json()["critique"] + scored["round"]["scenario"]["flow"])
            correct_flags.append(graded.json()["reasonCorrect"])
        self.assertEqual(correct_flags.count(True), 1, f"{focus} round {round_no} reasons")

        goal = scored["round"]["missionTgt"]
        bad_rows = [row for row in scored["curve"] if not _meets(row, needed, goal)]
        if bad_rows:
            rejected = client.post(
                f"{base}/lock",
                json={"runId": run_id, "round": round_no, "threshold": bad_rows[0]["k"]},
            )
            self.assertEqual(rejected.status_code, 400, f"{focus} locked a miss")
        good_rows = [
            row for row in scored["curve"]
            if _meets(row, needed, goal) and (needed != "precision" or row["rec"] >= 0.05)
        ]
        self.assertTrue(good_rows, f"{focus} round {round_no} has no threshold that meets {goal}")
        good = good_rows[0]
        locked = client.post(
            f"{base}/lock",
            json={"runId": run_id, "round": round_no, "threshold": good["k"]},
        )
        self.assertEqual(locked.status_code, 200, locked.text)
        self.assertGreaterEqual(locked.json()["stars"], 1)
        self.assertLessEqual(locked.json()["stars"], 3)
        self.assertEqual(locked.json()["yours"]["k"], good["k"])
        scenario = scored["round"]["scenario"]
        return {
            "title": scenario["title"],
            "who": scenario["who"],
            "flow": scenario["flow"],
            "needed": needed,
            "goal": goal,
            "wrong_metric_rejected": True,
            "correct_reasons": 1,
            "miss_threshold": bad_rows[0]["k"] if bad_rows else None,
            "locked_threshold": good["k"],
            "stars": locked.json()["stars"],
            "precision": locked.json()["yours"]["prec"],
            "recall": locked.json()["yours"]["rec"],
        }


def _pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{float(value) * 100:.1f}%"


def _write_report(records: list[dict], failures: list[str]) -> None:
    path = Path(__file__).resolve().parents[1] / "result" / "exercise-2-to-3.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Exercise 2 to Exercise 3",
        "",
        "Each department file was trained twice, once with TF-IDF and once with embeddings.",
        "The trainer used 20 real notes from each class in that CSV, held out 30 percent, and passed those class probabilities into Exercise 3.",
        "Quiz percents, the right metric, and the stars are calculated from that held-out test. A typed answer of 250 was rejected, then the calculated percent was accepted.",
        "The locked threshold in each round is the first point on the curve that meets the goal. It proves a miss is refused and a hit is accepted. It is not a recommended setting.",
        "",
        f"Pairs run: {len(records)}. Failures: {len(failures)}.",
        "",
    ]
    if failures:
        lines.append("## Failures")
        lines.append("")
        for item in failures:
            lines.append(f"- {item}")
        lines.append("")
    lines.extend(
        [
            "## Summary",
            "",
            "| Department | Method | Focus | Test notes | Precision | Recall | Lazy accuracy | Round 1 | Round 2 | Points |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for record in records:
        if record.get("error"):
            lines.append(f"| {record['dataset_id']} | {record['representation']} |  |  |  |  |  |  |  | failed |")
            continue
        precision = record["quiz"][0]["answer"]
        recall = record["quiz"][1]["answer"]
        accuracy = record["quiz"][2]["answer"]
        round_bits = []
        for item in record["rounds"]:
            round_bits.append(f"{item['needed']} @ {item['locked_threshold'] / 100:.2f} ({item['stars']}★)")
        lines.append(
            "| {name} | {method} | {focus} | {notes} | {precision} | {recall} | {accuracy} | {r1} | {r2} | {points} |".format(
                name=record["name"],
                method=record["representation"],
                focus=record["focus"],
                notes=f"{record['positives']}+{record['negatives']}",
                precision=precision,
                recall=recall,
                accuracy=accuracy,
                r1=round_bits[0],
                r2=round_bits[1],
                points=f"{record['round_points'][0]}+{record['round_points'][1]}={record['total']}",
            )
        )
    lines.append("")
    current = None
    for record in records:
        if record.get("error"):
            continue
        if record["dataset_id"] != current:
            current = record["dataset_id"]
            lines.extend(["", f"## {record['name']}", "", f"Focus label: **{record['focus']}**. Classes: {', '.join(record['classes'])}.", ""])
            lines.append(f"Sample {record['focus']} note from the file: {record['sample']}")
            lines.append("")
        matrix = record["matrix"]
        lines.extend(
            [
                f"### {record['representation']}",
                "",
                f"Held-out notes passed to Exercise 3: {record['positives']} {record['focus']}, {record['negatives']} other.",
                f"At threshold 0.50: caught {matrix['tp']}, missed {matrix['fn']}, false alarms {matrix['fp']}, ignored {matrix['tn']}.",
                "",
                "| Question | Wrong 250 | Calculated answer | Formula |",
                "| --- | --- | --- | --- |",
            ]
        )
        for quiz in record["quiz"]:
            lines.append(f"| {quiz['question']} | rejected | {quiz['answer']}% | {quiz['formula']} |")
        lines.append("")
        for index, item in enumerate(record["rounds"], start=1):
            miss = "none on this model" if item["miss_threshold"] is None else f"{item['miss_threshold'] / 100:.2f} rejected"
            lines.extend(
                [
                    f"**Round {index} — {item['title']}** ({item['who']}). Needs **{item['needed']}** at {_pct(item['goal'])}.",
                    "",
                    item["flow"],
                    "",
                    f"Wrong metric rejected. Exactly one reason accepted. A miss threshold ({miss}) was refused. Locked {item['locked_threshold'] / 100:.2f} at precision {_pct(item['precision'])}, recall {_pct(item['recall'])}, {item['stars']} stars.",
                    "",
                ]
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
