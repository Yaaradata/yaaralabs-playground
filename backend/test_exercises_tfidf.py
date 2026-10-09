"""Unit tests for the Exercise 2 sklearn TF-IDF + logistic regression service."""

from __future__ import annotations

import unittest

from app.services import exercises_metric_service as metric
from app.services.exercises_tfidf_service import (
    ReviewRow,
    _MODELS,
    drop_model,
    load_dataset_from_csv,
    predict,
    sample_payload,
    score_with_fitted,
    tokenize,
    train,
    _get_model,
)


def _balanced_slice(rows: list[ReviewRow], n: int = 400) -> list[ReviewRow]:
    buckets: dict[str, list[ReviewRow]] = {}
    for row in rows:
        buckets.setdefault(row.label, []).append(row)
    out: list[ReviewRow] = []
    per = max(8, n // max(1, len(buckets)))
    for group in buckets.values():
        out.extend(group[:per])
    return out


class TfidfStudioTests(unittest.TestCase):
    def test_predict_reloads_after_the_memory_cache_drops(self) -> None:
        rows = []
        for y, label, words in ((0, "Safe", "beam column foundation"), (1, "Unsafe", "crack spall exposed rebar")):
            for index in range(6):
                rows.append(ReviewRow(review=f"{words} note {index} {label}", y=y, label=label))
        trained = train("session-reload", "project-reload", rows, 0.3, 1, 50, 1, 1, 1, 1.0, "lbfgs", 40, 0.5, 4, "tfidf")
        self.assertTrue(trained["classes"])
        _MODELS.clear()
        scored = predict("session-reload", "project-reload", "crack spall exposed rebar on the beam")
        self.assertIn(scored["label"], trained["classes"])
        drop_model("session-reload", "project-reload")
        with self.assertRaises(LookupError):
            predict("session-reload", "project-reload", "crack spall exposed rebar on the beam")

    def test_metric_run_reloads_after_memory_drops(self) -> None:
        scored = metric.score_model("sess-run", "proj-run", "CIVIL", "tfidf", [0.9, 0.8], [0.1, 0.2], "Unsafe")
        metric._RUNS.clear()
        graded = metric.grade_answer("sess-run", "proj-run", scored["runId"], 0, "250")
        self.assertTrue(graded["accepted"])
        self.assertFalse(graded["ok"])
        metric.drop_runs("sess-run", "proj-run")
        with self.assertRaises(LookupError):
            metric.grade_answer("sess-run", "proj-run", scored["runId"], 0, "250")

    def setUp(self) -> None:
        drop_model("session-a", "project-a")
        drop_model("session-b", "project-b")

    def tearDown(self) -> None:
        drop_model("session-a", "project-a")
        drop_model("session-b", "project-b")

    def test_sample_csv_trains_sklearn_model(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        result = train("session-a", "project-a", rows, 0.25, 42)
        self.assertFalse(result["simulated"])
        self.assertGreaterEqual(result["n_features"], 8)
        self.assertGreaterEqual(result["n_train"], 4)
        self.assertGreaterEqual(result["n_test"], 2)
        self.assertEqual(result["solver"], "lbfgs")
        self.assertGreaterEqual(result["train_accuracy"], 0.9)
        self.assertAlmostEqual(result["curve"][-1]["acc"], result["test_accuracy"], places=6)
        self.assertAlmostEqual(result["curve"][-1]["f1"], result["test_f1"], places=6)
        self.assertAlmostEqual(result["curve"][-1]["train_acc"], result["train_accuracy"], places=6)
        self.assertGreaterEqual(result["cv_accuracy"], 0.0)
        self.assertLessEqual(result["cv_accuracy"], 1.0)
        self.assertGreater(len(result["curve"]), 4)
        self.assertTrue(result["model"]["vocab"])
        self.assertEqual(len(result["model"]["vocab"]), len(result["model"]["weights"]))

    def test_epochs_drive_learning_curve(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        result = train("session-a", "project-a", rows, 0.25, 42, epochs=20)
        self.assertEqual(result["epochs"], 20)
        self.assertEqual(result["n_epochs"], 20)
        self.assertEqual(result["curve"][-1]["epoch"], 20)

    def test_learning_curve_moves_across_epochs(self):
        from app.services.exercises_tfidf_datasets import load_department_table
        from app.services.exercises_tfidf_service import rows_from_payload

        rows = _balanced_slice(rows_from_payload(load_department_table("electrical")["rows"]))
        result = train("session-a", "project-a", rows, 0.2, 42, 1000, 1, 1, 1, 1.0, "lbfgs", 500, 0.5, 40)
        accs = [point["acc"] for point in result["curve"]]
        losses = [point["loss"] for point in result["curve"]]
        self.assertGreater(len(accs), 8)
        self.assertLess(accs[0], accs[-1] - 0.02)
        self.assertGreaterEqual(accs[-1], accs[len(accs) // 2] - 1e-9)
        self.assertGreater(losses[0], losses[-1])
        self.assertGreater(max(abs(losses[i] - losses[i - 1]) for i in range(1, len(losses))), 0.01)
        late = accs[int(len(accs) * 0.8)]
        self.assertGreaterEqual(accs[-1], late - 1e-9)

    def test_predict_uses_fitted_sklearn_classifier(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        train("session-a", "project-a", rows, 0.25, 42)
        positive = predict("session-a", "project-a", "I absolutely love this, it works perfectly!")
        negative = predict("session-a", "project-a", "Terrible quality, broke and a total waste.")
        self.assertGreater(positive["probability"], 0.5)
        self.assertLess(negative["probability"], 0.5)
        self.assertGreater(positive["known_tokens"], 0)
        self.assertTrue(positive["chips"])

    def test_score_matches_sklearn_predict_proba(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        result = train("session-a", "project-a", rows, 0.25, 42)
        fitted = _get_model("session-a", "project-a")
        assert fitted is not None
        text = "Great value and excellent build quality."
        scored = score_with_fitted(fitted, text)
        sklearn_p = float(fitted.classifier.predict_proba(fitted.vectorizer.transform([text]))[0, 1])
        self.assertAlmostEqual(scored["probability"], sklearn_p, places=6)
        self.assertEqual(len(result["test_probs"]), result["n_test"])

    def test_models_are_isolated_per_project(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        train("session-a", "project-a", rows, 0.25, 42)
        with self.assertRaises(LookupError):
            predict("session-b", "project-b", "I love it")
        drop_model("session-a", "project-a")
        with self.assertRaises(LookupError):
            predict("session-a", "project-a", "I love it")

    def test_requires_both_classes(self) -> None:
        with self.assertRaises(ValueError):
            train(
                "session-a",
                "project-a",
                [ReviewRow("love this product quality", 1) for _ in range(6)],
                0.25,
                42,
            )

    def test_tokenizer_drops_stopwords(self) -> None:
        self.assertEqual(tokenize("The product is great and I love it"), ["product", "great", "love"])

    def test_predict_rejects_a_single_letter(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        train("session-a", "project-a", rows, 0.25, 42)
        with self.assertRaises(ValueError):
            predict("session-a", "project-a", "m")
        with self.assertRaises(ValueError):
            predict("session-a", "project-a", "a")

    def test_department_catalog_and_multiclass_train(self) -> None:
        from app.services.exercises_tfidf_datasets import list_department_datasets, load_department_table
        from app.services.exercises_tfidf_service import rows_from_payload

        catalog = list_department_datasets()
        self.assertGreaterEqual(len(catalog), 10)
        ids = {item["id"] for item in catalog}
        self.assertIn("cse", ids)
        self.assertIn("civil", ids)
        eee = next(item for item in catalog if item["id"] == "electrical")
        self.assertIn("SCADA", eee["source"])
        self.assertIn("Normal or Fault", eee["use_case"])
        for item in catalog:
            self.assertTrue(item.get("source"), item["id"])
            self.assertTrue(item.get("use_case"), item["id"])
            self.assertNotIn("synthetic", item["source"].lower())

        cse = load_department_table("cse")
        self.assertEqual(cse["n_rows"], 40000)
        self.assertEqual(len(cse["classes"]), 2)
        cse_rows = _balanced_slice(rows_from_payload(cse["rows"]))
        cse_result = train("session-a", "project-a", cse_rows, 0.25, 42)
        self.assertEqual(cse_result["n_classes"], 2)
        self.assertEqual(cse_result["solver"], "lbfgs")
        self.assertEqual(cse_result["curve_kind"], "holdout")
        last_acc = cse_result["curve"][-1]["acc"]
        self.assertAlmostEqual(last_acc, cse_result["test_accuracy"], places=6)
        self.assertEqual(len(cse_result["confusion_matrix"]), cse_result["n_classes"])
        self.assertEqual(len(cse_result["confusion_matrix"][0]), cse_result["n_classes"])
        self.assertGreaterEqual(cse_result["test_f1"], 0.0)
        self.assertLessEqual(cse_result["test_f1"], 1.0)
        self.assertTrue(cse_result["word_weights"][0].get("label"))
        sample = cse["examples"][0]["text"]
        scored = predict("session-a", "project-a", sample)
        self.assertIn(scored["label"], cse["classes"])
        self.assertEqual(len(scored["probs"]), 2)

        civil = load_department_table("civil")
        civil_rows = _balanced_slice(rows_from_payload(civil["rows"]))
        civil_result = train("session-a", "project-a", civil_rows, 0.25, 42)
        self.assertEqual(civil_result["n_classes"], 2)
        self.assertEqual(civil_result["solver"], "lbfgs")
        for item in civil_result["test_probs"]:
            self.assertGreaterEqual(item["p"], 0.0)
            self.assertLessEqual(item["p"], 1.0)

    def test_it_holdout_curve_matches_scorecard(self) -> None:
        from app.services.exercises_tfidf_datasets import load_department_table
        from app.services.exercises_tfidf_service import rows_from_payload

        payload = load_department_table("it")
        rows = _balanced_slice(rows_from_payload(payload["rows"]), 200)
        result = train(
            "session-a",
            "project-a",
            rows,
            0.2,
            42,
            100,
            1,
            2,
            1,
            1.0,
            "saga",
            500,
            0.5,
        )
        self.assertEqual(set(result["classes"]), {"System Fault", "User Error"})
        self.assertEqual(result["curve_kind"], "holdout")
        self.assertAlmostEqual(result["curve"][-1]["acc"], result["test_accuracy"], places=6)
        self.assertGreaterEqual(result["train_accuracy"], result["test_accuracy"])
        self.assertGreaterEqual(result["test_accuracy"], 0.5)
        self.assertLessEqual(result["n_features"], 100)

    def test_electrical_holdout_matrix_matches_scorecard(self) -> None:
        from app.services.exercises_tfidf_datasets import load_department_table
        from app.services.exercises_tfidf_service import rows_from_payload

        payload = load_department_table("electrical")
        rows = _balanced_slice(rows_from_payload(payload["rows"]), 200)
        result = train("session-a", "project-a", rows, 0.2, 42, 1000, 1, 1, 1, 1.0, "saga", 100, 0.5)
        self.assertEqual(set(result["classes"]), {"Fault", "Normal"})
        self.assertEqual(result["class_counts"]["Fault"], 100)
        self.assertEqual(result["class_counts"]["Normal"], 100)
        matrix = result["confusion_matrix"]
        self.assertEqual(sum(sum(row) for row in matrix), result["n_test"])
        diagonal = 0
        for i, name in enumerate(result["classes"]):
            support = sum(matrix[i])
            self.assertGreater(support, 0, name)
            self.assertLess(support, result["class_counts"][name], name)
            diagonal += matrix[i][i]
        self.assertAlmostEqual(diagonal / result["n_test"], result["test_accuracy"], places=6)
        self.assertAlmostEqual(result["curve"][-1]["acc"], result["test_accuracy"], places=6)

    def test_department_preview_is_a_slice(self) -> None:
        from app.services.exercises_tfidf_datasets import load_department_slice, load_department_table

        preview = load_department_slice("electrical", 0, 4)
        self.assertEqual(preview["n_rows"], 40000)
        self.assertEqual(len(preview["rows"]), 4)
        page = load_department_slice("electrical", 0, 50)
        self.assertEqual(len(page["rows"]), 50)
        self.assertEqual(len({row["label"] for row in page["rows"]}), 2)
        full = load_department_table("electrical")
        self.assertEqual(full["n_rows"], 40000)
        self.assertEqual(len(full["rows"]), 40000)

    def test_binary_holdout_p_is_positive_class_probability(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        result = train("session-a", "project-a", rows, 0.25, 42)
        fitted = _get_model("session-a", "project-a")
        assert fitted is not None
        self.assertEqual(result["classes"], ["negative", "positive"])
        for item in result["test_probs"]:
            self.assertGreaterEqual(item["p"], 0.0)
            self.assertLessEqual(item["p"], 1.0)
        positive = predict("session-a", "project-a", "I absolutely love this, it works perfectly!")
        self.assertEqual(positive["label"], "positive")
        self.assertAlmostEqual(positive["probs"][1]["p"], positive["probability"], places=6)

    def test_student_hyperparameters_change_the_model(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        tight = train(
            "session-a",
            "project-a",
            rows,
            0.2,
            7,
            50,
            1,
            1,
            1,
            1.0,
            "liblinear",
            200,
            0.5,
        )
        wide = train(
            "session-a",
            "project-a",
            rows,
            0.3,
            7,
            400,
            1,
            2,
            1,
            8.0,
            "lbfgs",
            400,
            0.5,
        )
        self.assertEqual(tight["solver"], "liblinear")
        self.assertEqual(tight["seed"], 7)
        self.assertEqual(tight["test_size"], 0.2)
        self.assertLessEqual(tight["n_features"], 50)
        self.assertEqual(wide["solver"], "lbfgs")
        self.assertEqual(wide["regularization_c"], 8.0)
        self.assertEqual(wide["ngram_max"], 2)
        self.assertGreater(wide["n_features"], tight["n_features"])
        self.assertTrue(any(" " in item["word"] for item in wide["word_weights"]))

    def test_train_response_matches_api_schema(self) -> None:
        from app.models import ExercisesTfidfPredictResponse, ExercisesTfidfTrainResponse

        rows = load_dataset_from_csv(sample_payload()["csv"])
        result = train("session-a", "project-a", rows, 0.25, 42)
        parsed = ExercisesTfidfTrainResponse(**result)
        self.assertTrue(parsed.model.vocab)
        scored = predict("session-a", "project-a", "Great value and excellent build quality.")
        ExercisesTfidfPredictResponse(**scored)

    def test_embeddings_train_keeps_logistic_regression(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        result = train(
            "session-a",
            "project-a",
            rows,
            0.25,
            42,
            representation="embeddings",
        )
        self.assertEqual(result["representation"], "embeddings")
        self.assertEqual(result["n_features"], 384)
        self.assertEqual(len(result["model"]["vocab"]), 384)
        self.assertEqual(result["model"]["representation"], "embeddings")
        self.assertFalse(result["simulated"])
        self.assertGreaterEqual(result["test_accuracy"], 0.5)
        self.assertAlmostEqual(result["curve"][-1]["acc"], result["test_accuracy"], places=6)
        positive = predict("session-a", "project-a", "I absolutely love this, it works perfectly!")
        self.assertEqual(positive["label"], "positive")
        self.assertGreaterEqual(positive["probability"], 0.5)
        self.assertGreater(positive["known_tokens"], 0)
        negative = predict("session-a", "project-a", "Terrible quality, broke and a total waste.")
        self.assertEqual(negative["label"], "negative")
        self.assertLessEqual(negative["probability"], 0.5)

    def test_inspect_labeled_rows_matches_studio_rules(self) -> None:
        from app.services.exercises_tfidf_datasets import inspect_labeled_rows

        rows = [
            {"review": "", "label": "Bug"},
            {"review": "Login fails", "label": ""},
            {"review": "This Bug ticket is still open", "label": "Bug"},
            {"review": "same note", "label": "Bug"},
            {"review": "same note", "label": "Bug"},
            {"review": "same note", "label": "Feature"},
        ]
        stats = inspect_labeled_rows(rows, ["Bug", "Feature"])
        self.assertEqual(stats["empty_text"], 1)
        self.assertEqual(stats["empty_label"], 1)
        self.assertEqual(stats["groups"], 1)
        self.assertEqual(stats["extra"], 2)
        self.assertEqual(stats["mixed_labels"], 1)
        self.assertEqual(stats["label_in_text"], 1)

    def test_default_representation_stays_tfidf(self) -> None:
        rows = load_dataset_from_csv(sample_payload()["csv"])
        result = train("session-a", "project-a", rows, 0.25, 42)
        self.assertEqual(result["representation"], "tfidf")
        self.assertGreater(result["n_features"], 8)
        self.assertNotEqual(result["n_features"], 384)


if __name__ == "__main__":
    unittest.main()
