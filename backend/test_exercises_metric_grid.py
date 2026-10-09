"""Every department label, scored from Exercise 2 into Exercise 3.

For each class, a lattice of confusion counts produces different accuracy,
precision, recall, and F1. Those counts are graded by the same functions the
API uses. A real TF-IDF and embeddings train then checks every class on the
held-out matrix.
"""

from __future__ import annotations

import csv
import unittest
from pathlib import Path

from sklearn.metrics import accuracy_score, precision_recall_fscore_support

from app.services import exercises_metric_service as metric
from app.services import exercises_tfidf_datasets as datasets
from app.services.exercises_tfidf_service import drop_model, rows_from_payload, train


# tp, fp, fn, tn. Each row is one precision / recall / accuracy / F1 shape.
COUNT_CASES = [
    ("perfect", 40, 0, 0, 160),
    ("high_precision_low_recall", 4, 0, 36, 160),
    ("low_precision_high_recall", 40, 80, 0, 80),
    ("balanced_middle", 20, 20, 20, 140),
    ("both_low", 5, 45, 35, 115),
    ("equal_precision_recall", 30, 10, 10, 50),
    ("precision_above_recall", 10, 0, 30, 60),
    ("recall_above_precision", 30, 20, 0, 50),
    ("no_flags", 0, 0, 40, 160),
    ("no_hits", 0, 20, 40, 140),
    ("all_flagged_positives", 40, 160, 0, 0),
    ("one_of_each", 1, 1, 1, 1),
    ("rare_positive", 1, 0, 0, 199),
    ("mostly_false_alarms", 2, 50, 8, 40),
    ("half_and_half", 50, 50, 50, 50),
]

PER_CLASS = 16


def _expected(tp: int, fp: int, fn: int, tn: int) -> dict[str, float]:
    total = tp + fp + fn + tn
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    if precision and recall:
        f1 = (2 * precision * recall) / (precision + recall)
    else:
        f1 = 0.0
    accuracy = (tp + tn) / total if total else 0.0
    lazy = (fp + tn) / total if total else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "accuracy": accuracy,
        "lazy": lazy,
        "total": float(total),
    }


def _matrix(classes: list[str], focus: str, tp: int, fp: int, fn: int, tn: int) -> list[list[int]]:
    size = len(classes)
    index = classes.index(focus)
    grid = [[0 for _ in range(size)] for _ in range(size)]
    grid[index][index] = tp
    others = [i for i in range(size) if i != index]
    if not others:
        raise AssertionError(focus)
    for offset, col in enumerate(others):
        grid[index][col] = fn // len(others) + (1 if offset < fn % len(others) else 0)
    for offset, row in enumerate(others):
        grid[row][index] = fp // len(others) + (1 if offset < fp % len(others) else 0)
    rest = [(r, c) for r in others for c in others]
    for offset, (row, col) in enumerate(rest):
        grid[row][col] = tn // len(rest) + (1 if offset < tn % len(rest) else 0)
    return grid


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
    return [item for group in buckets.values() for item in group]


def _ovr(matrix: list[list[int]], index: int) -> tuple[int, int, int, int]:
    size = len(matrix)
    tp = int(matrix[index][index])
    fn = sum(int(matrix[index][col]) for col in range(size) if col != index)
    fp = sum(int(matrix[row][index]) for row in range(size) if row != index)
    total = sum(int(cell) for row in matrix for cell in row)
    tn = total - tp - fp - fn
    return tp, fp, fn, tn


class MetricGridTests(unittest.TestCase):
    def test_every_label_and_metric_shape(self) -> None:
        failures: list[str] = []
        rows: list[dict] = []
        session = "grid-session"
        for dataset_id in datasets.DEPARTMENT_ORDER:
            code = datasets.SHORT_NAMES[dataset_id]
            classes = list(datasets.CLASSES[dataset_id])
            for focus in classes:
                for name, tp, fp, fn, tn in COUNT_CASES:
                    try:
                        rows.append(self._grade_case(session, dataset_id, code, classes, focus, name, tp, fp, fn, tn))
                    except Exception as exc:
                        failures.append(f"{code}/{focus}/{name}: {exc}")
        _write_grid(rows, failures)
        self.assertFalse(failures, "\n".join(failures[:30]))

    def _grade_case(
        self,
        session: str,
        dataset_id: str,
        code: str,
        classes: list[str],
        focus: str,
        name: str,
        tp: int,
        fp: int,
        fn: int,
        tn: int,
    ) -> dict:
        expected = _expected(tp, fp, fn, tn)
        grid = _matrix(classes, focus, tp, fp, fn, tn)
        got = _ovr(grid, classes.index(focus))
        self.assertEqual(got, (tp, fp, fn, tn), f"{code} {focus} {name} matrix lost a count")
        # Tiny holdout keeps the threshold curve alive. The 0.50 quiz uses the matrix.
        scored = metric.score_model(
            session,
            f"proj-{code}-{focus}-{name}",
            code,
            "tfidf",
            [0.9, 0.2],
            [0.1, 0.8],
            focus,
            grid,
            classes,
        )
        anchor = scored["curve"][49]
        self.assertEqual(anchor["k"], 50)
        self.assertEqual(anchor["tp"], tp)
        self.assertEqual(anchor["fp"], fp)
        self.assertEqual(anchor["fn"], fn)
        self.assertEqual(anchor["tn"], tn)
        self.assertAlmostEqual(anchor["prec"] or 0.0, expected["precision"], places=6)
        self.assertAlmostEqual(anchor["rec"], expected["recall"], places=6)
        self.assertAlmostEqual(anchor["f1"], expected["f1"], places=6)
        self.assertAlmostEqual(anchor["acc"], expected["accuracy"], places=6)
        self.assertEqual(scored["department"]["target"], focus)
        self.assertIn(focus, scored["quiz"][0]["question"])
        self.assertIn(focus, scored["quiz"][1]["question"])
        run_id = scored["runId"]
        project = f"proj-{code}-{focus}-{name}"
        answers = []
        for index, key in enumerate(("precision", "recall", "lazy")):
            wrong = metric.grade_answer(session, project, run_id, index, "250")
            self.assertTrue(wrong["accepted"])
            self.assertFalse(wrong["ok"], f"{code} {focus} {name} {key}")
            shown = f"{wrong['answer']:.1f}"
            right = metric.grade_answer(session, project, run_id, index, shown)
            self.assertTrue(right["ok"], f"{code} {focus} {name} {key} {shown}")
            self.assertAlmostEqual(right["answer"], expected[key] * 100, places=4)
            answers.append(shown)
        # A fraction form is accepted when the percent is above 1.5.
        if expected["precision"] > 0.015:
            fraction = metric.grade_answer(session, project, run_id, 0, f"{expected['precision']:.4f}")
            self.assertTrue(fraction["ok"], f"{code} {focus} {name} fraction")
        return {
            "department": datasets.FULL_NAMES[dataset_id],
            "code": code,
            "focus": focus,
            "case": name,
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "tn": tn,
            "precision": answers[0],
            "recall": answers[1],
            "accuracy": f"{expected['accuracy'] * 100:.1f}",
            "f1": f"{expected['f1'] * 100:.1f}",
            "lazy": answers[2],
        }

    def test_probability_curve_matches_hand_counts(self) -> None:
        patterns = {
            "separated": ([0.99, 0.97, 0.91], [0.02, 0.08, 0.11, 0.04]),
            "all_low": ([0.12, 0.2, 0.33], [0.05, 0.1, 0.18]),
            "all_high": ([0.96, 0.88, 0.77], [0.91, 0.7, 0.66]),
            "tied_at_half": ([0.5, 0.5], [0.5, 0.5, 0.5]),
            "one_borderline": ([0.5], [0.49]),
        }
        cuts = (10, 25, 50, 75, 90)
        for dataset_id in datasets.DEPARTMENT_ORDER:
            code = datasets.SHORT_NAMES[dataset_id]
            for pattern, (pos, neg) in patterns.items():
                scored = metric.score_model(
                    "curve-session",
                    f"curve-{code}-{pattern}",
                    code,
                    "emb",
                    pos,
                    neg,
                    datasets.CLASSES[dataset_id][0],
                )
                by_k = {row["k"]: row for row in scored["curve"]}
                for k in cuts:
                    cut = k * 10
                    tp = sum(1 for value in pos if round(value * 1000) >= cut)
                    fp = sum(1 for value in neg if round(value * 1000) >= cut)
                    fn = len(pos) - tp
                    tn = len(neg) - fp
                    expected = _expected(tp, fp, fn, tn)
                    row = by_k[k]
                    self.assertEqual((row["tp"], row["fp"], row["fn"], row["tn"]), (tp, fp, fn, tn))
                    self.assertAlmostEqual(row["prec"] or 0.0, expected["precision"], places=6, msg=f"{code} {pattern} {k}")
                    self.assertAlmostEqual(row["rec"], expected["recall"], places=6)
                    self.assertAlmostEqual(row["f1"], expected["f1"], places=6)
                    self.assertAlmostEqual(row["acc"], expected["accuracy"], places=6)

    def test_trained_models_every_class(self) -> None:
        failures: list[str] = []
        records: list[dict] = []
        for dataset_id in datasets.DEPARTMENT_ORDER:
            payload = _sample_payload(dataset_id)
            for representation in ("tfidf", "embeddings"):
                try:
                    records.extend(self._train_classes(dataset_id, representation, payload))
                except Exception as exc:
                    failures.append(f"{dataset_id}/{representation}: {exc}")
        _write_trained(records, failures)
        self.assertFalse(failures, "\n".join(failures))

    def _train_classes(self, dataset_id: str, representation: str, payload: list[dict]) -> list[dict]:
        session_id = f"cls-{dataset_id}-{representation}"
        project_id = f"cls-proj-{dataset_id}-{representation}"
        method = "emb" if representation == "embeddings" else "tfidf"
        code = datasets.SHORT_NAMES[dataset_id]
        rows = rows_from_payload(payload)
        try:
            trained = train(
                session_id, project_id, rows, 0.3, 11, 300, 1, 1, 1, 1.0, "lbfgs", 60, 0.5, 4, representation,
            )
        finally:
            drop_model(session_id, project_id)
        classes = trained["classes"]
        matrix = trained["confusion_matrix"]
        y_true = [row["y"] for row in trained["test_probs"]]
        y_pred = [row["pred"] for row in trained["test_probs"]]
        accuracy = accuracy_score(y_true, y_pred)
        self.assertAlmostEqual(accuracy, trained["test_accuracy"], places=6)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_true, y_pred, labels=list(range(len(classes))), average=None, zero_division=0,
        )
        out = []
        for index, focus in enumerate(classes):
            tp, fp, fn, tn = _ovr(matrix, index)
            expected = _expected(tp, fp, fn, tn)
            self.assertAlmostEqual(precision[index], expected["precision"], places=6, msg=focus)
            self.assertAlmostEqual(recall[index], expected["recall"], places=6, msg=focus)
            self.assertAlmostEqual(f1[index], expected["f1"], places=6, msg=focus)
            pos, neg = [], []
            for row in trained["test_probs"]:
                score = float(row["probs"][index])
                (pos if row["y"] == index else neg).append(score)
            self.assertGreaterEqual(len(pos) + len(neg), 4)
            if not pos or not neg:
                continue
            scored = metric.score_model(
                session_id, project_id + focus, code, method, pos, neg, focus, matrix, classes,
            )
            anchor = scored["curve"][49]
            self.assertEqual((anchor["tp"], anchor["fp"], anchor["fn"], anchor["tn"]), (tp, fp, fn, tn))
            self.assertAlmostEqual(anchor["prec"] or 0.0, expected["precision"], places=6)
            self.assertAlmostEqual(anchor["rec"], expected["recall"], places=6)
            self.assertAlmostEqual(anchor["f1"], expected["f1"], places=6)
            self.assertAlmostEqual(anchor["acc"], expected["accuracy"], places=6)
            run_id = scored["runId"]
            for qindex, key in enumerate(("precision", "recall", "lazy")):
                graded = metric.grade_answer(session_id, project_id + focus, run_id, qindex, "250")
                self.assertFalse(graded["ok"])
                shown = f"{graded['answer']:.1f}"
                self.assertTrue(metric.grade_answer(session_id, project_id + focus, run_id, qindex, shown)["ok"])
                self.assertAlmostEqual(graded["answer"], expected[key] * 100, delta=0.05)
            out.append(
                {
                    "department": datasets.FULL_NAMES[dataset_id],
                    "method": representation,
                    "focus": focus,
                    "precision": f"{expected['precision'] * 100:.1f}",
                    "recall": f"{expected['recall'] * 100:.1f}",
                    "f1": f"{expected['f1'] * 100:.1f}",
                    "accuracy": f"{expected['accuracy'] * 100:.1f}",
                    "overall": f"{trained['test_accuracy'] * 100:.1f}",
                }
            )
        return out


def _write_grid(rows: list[dict], failures: list[str]) -> None:
    path = Path(__file__).resolve().parents[1] / "result" / "exercise-3-metric-grid.md"
    lines = [
        "# Exercise 3 metric grid",
        "",
        "Each department label was scored on 15 confusion-count shapes.",
        "Precision, recall, F1, and accuracy are computed from those counts, then checked against Exercise 3.",
        "The quiz accuracy is the lazy score (every non-focus note counted correct). Model accuracy is (TP + TN) / all.",
        "",
        f"Cases: {len(rows)}. Failures: {len(failures)}.",
        "",
    ]
    if failures:
        lines.append("## Failures")
        lines.extend(f"- {item}" for item in failures)
        lines.append("")
    lines.extend(
        [
            "| Department | Label | Shape | TP | FP | FN | TN | Precision | Recall | F1 | Model accuracy | Lazy accuracy |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['department']} | {row['focus']} | {row['case']} | {row['tp']} | {row['fp']} | {row['fn']} | {row['tn']} | {row['precision']} | {row['recall']} | {row['f1']} | {row['accuracy']} | {row['lazy']} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_trained(rows: list[dict], failures: list[str]) -> None:
    path = Path(__file__).resolve().parents[1] / "result" / "exercise-3-every-label.md"
    lines = [
        "# Exercise 2 held-out metrics for every label",
        "",
        "Each department file was trained with TF-IDF and with embeddings.",
        "Precision, recall, and F1 are one-vs-rest on that label. Model accuracy is the one-vs-rest accuracy of the same cells.",
        "Overall accuracy is the multiclass score from Exercise 2.",
        "",
        f"Labels checked: {len(rows)}. Failures: {len(failures)}.",
        "",
    ]
    if failures:
        lines.extend(["## Failures", ""] + [f"- {item}" for item in failures] + [""])
    lines.extend(
        [
            "| Department | Method | Label | Precision | Recall | F1 | One-vs-rest accuracy | Overall accuracy |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for row in rows:
        lines.append(
            f"| {row['department']} | {row['method']} | {row['focus']} | {row['precision']} | {row['recall']} | {row['f1']} | {row['accuracy']} | {row['overall']} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
