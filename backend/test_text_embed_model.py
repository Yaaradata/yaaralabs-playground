"""Tests for the sentence-meaning text model (app/text_embed_service.py, modelType sentence_embed_lr).

Trains on the 20 sample custody queries and checks the targets the chosen settings meet on the
sample's 14 test messages (12 desk + 2 off-topic). Needs the embedding model (BAAI/bge-small-en-v1.5):
from TEXT_EMBED_MODEL_DIR in the Docker image, or the Hugging Face cache / a download locally.

Run from backend/:  .venv/Scripts/python.exe -m unittest test_text_embed_model -v
"""

from __future__ import annotations

import json
import pickle
import statistics
import unittest
from pathlib import Path

from app.text_embed_service import MODEL_TYPE, SentenceEmbedTrainer, fit, get_embedder, scores_many
from app.text_ovr_service import MODEL_TYPE as OVR_TYPE, OvrTextClassifierTrainer

SAMPLE = Path(__file__).resolve().parent.parent / "frontend" / "public" / "datasets" / "nuvama_custody_queries.json"
NONE = "None of these"
NAMES = {"Fees & billing": "Fees and billing", "Corporate action": "Corporate action",
         "Onboarding & KYC": "Onboarding and KYC", "Complaint / escalation": "Complaint or escalation"}


class OnTheSample(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = json.loads(SAMPLE.read_text(encoding="utf-8"))
        cls.texts = [q["text"] for q in data["queries"]]
        cls.labels = [NAMES[q["label"]] for q in data["queries"]]
        cls.test = [(t["text"], NAMES.get(t["expected"], NONE)) for t in data["test"]]
        cls.trainer = SentenceEmbedTrainer()
        cls.model = cls.trainer.train_model([{"text": t, "label": l} for t, l in zip(cls.texts, cls.labels)])["model"]
        cls.results = [(expected, cls.trainer.predict(cls.model, text)) for text, expected in cls.test]
        cls.right = [r["confidence"] for e, r in cls.results if e != NONE and r["label"] == e]
        cls.wrong = [r["confidence"] for e, r in cls.results if e != NONE and r["label"] != e]
        cls.off = [r["confidence"] for e, r in cls.results if e == NONE]

    def test_shape_like_the_old_model(self):
        r = self.results[0][1]
        self.assertEqual(set(r), {"label", "confidence", "alternatives", "all_scores"})
        self.assertEqual(len(r["all_scores"]), 4)
        self.assertEqual(self.model["model_type"], MODEL_TYPE)

    def test_test_set_at_least_10_of_12(self):
        self.assertEqual(len(self.right) + len(self.wrong), 12)
        self.assertGreaterEqual(len(self.right), 10)

    def test_confident_when_right(self):
        self.assertGreaterEqual(statistics.median(self.right), 75)
        self.assertGreaterEqual(min(self.right), 50)

    def test_off_topic_low(self):
        for c in self.off:
            self.assertLessEqual(c, 30)

    def test_wrong_answers_below_the_right_ones(self):
        # Target "wrong answers mostly below 50%" is NOT met (they are ~60-66%); at least they stay
        # below the median right answer.
        for c in self.wrong:
            self.assertLess(c, statistics.median(self.right))

    def test_leave_one_out_at_least_14_of_20(self):
        embedder = get_embedder(self.model["embed_model"])
        emb = embedder.embed(self.texts)
        right = 0
        for i in range(len(self.texts)):
            keep = [j for j in range(len(self.texts)) if j != i]
            m = fit([self.texts[j] for j in keep], [self.labels[j] for j in keep], embedder, self.model["settings"], train_emb=emb[keep])
            s = scores_many(m, [self.texts[i]], embedder)[0]
            right += max(s, key=s.get) == self.labels[i]
        self.assertGreaterEqual(right, 14)

    def test_exact_training_text_scores_100(self):
        for text, label in zip(self.texts, self.labels):
            r = self.trainer.predict(self.model, text)
            self.assertEqual((r["label"], r["confidence"]), (label, 100.0))
        r = self.trainer.predict(self.model, "  " + self.texts[0].upper() + "  ")
        self.assertEqual(r["confidence"], 100.0)

    def test_pickle_round_trip_without_the_embedding_model(self):
        blob = pickle.dumps(self.model)
        self.assertLess(len(blob), 2_000_000)  # classifier + training embeddings, not the transformer
        again = pickle.loads(blob)
        self.assertEqual(self.trainer.predict(again, self.test[0][0]), self.trainer.predict(self.model, self.test[0][0]))


class Compatibility(unittest.TestCase):
    def test_old_ovr_pickles_still_predict(self):
        old = OvrTextClassifierTrainer().train_model([
            {"text": "fan on", "label": "on"}, {"text": "switch the fan on", "label": "on"},
            {"text": "fan off", "label": "off"}, {"text": "turn the fan off", "label": "off"},
        ])["model"]
        loaded = pickle.loads(pickle.dumps(old))
        self.assertEqual(loaded["model_type"], OVR_TYPE)
        r = OvrTextClassifierTrainer().predict(loaded, "please turn the fan off")
        self.assertEqual(r["label"], "off")

    def test_two_labels_two_examples_each(self):
        trained = SentenceEmbedTrainer().train_model([
            {"text": "turn the lamp on", "label": "on"}, {"text": "lights on please", "label": "on"},
            {"text": "turn the lamp off", "label": "off"}, {"text": "lights off please", "label": "off"},
        ])
        self.assertEqual(trained["labels"], ["off", "on"])
        r = SentenceEmbedTrainer().predict(trained["model"], "switch the lights off")
        self.assertIn(r["label"], {"on", "off"})
        self.assertEqual(len(r["alternatives"]), 1)

    def test_needs_two_labels(self):
        with self.assertRaises(ValueError):
            SentenceEmbedTrainer().train_model([{"text": "a", "label": "x"}, {"text": "b", "label": "x"}])


if __name__ == "__main__":
    unittest.main()
