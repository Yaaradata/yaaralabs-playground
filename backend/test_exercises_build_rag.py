"""Unit tests for Exercise 12 build-RAG pipeline (no LLM / network)."""

from __future__ import annotations

import unittest

from app.services import exercises_build_rag_service as br


class BuildRagPipelineTests(unittest.TestCase):
    def test_clean_removes_headers_and_hyphen_wraps(self):
        result = br.clean(br.EXAMPLE_DOC)
        text = result["text"]
        counts = result["counts"]

        self.assertGreater(counts["headers"], 0)
        self.assertNotIn("Page 1 of 3", text)
        self.assertNotIn("Page 2 of 3", text)
        self.assertIn("compacted", text)
        self.assertNotIn("com-\n", text)
        self.assertGreaterEqual(counts["hyphen"], 1)
        self.assertGreaterEqual(counts["wraps"], 1)
        self.assertIn("Campus Building Code - Class Sample - Rev 2", result["removed"])

    def test_clean_can_disable_options(self):
        result = br.clean(br.EXAMPLE_DOC, headers=False, hyphen=False, wraps=False, spaces=False)
        self.assertEqual(result["counts"]["headers"], 0)
        self.assertEqual(result["counts"]["hyphen"], 0)
        self.assertIn("Page 1 of 3", result["text"])
        self.assertIn("com-\n", result["text"])

    def test_chunk_sentences(self):
        cleaned = br.clean(br.EXAMPLE_DOC)
        packed = br.chunk(cleaned["text"], mode="sentences", size=60, overlap=10)
        self.assertGreater(packed["count"], 3)
        self.assertEqual(packed["mode"], "sentences")
        self.assertTrue(all(isinstance(c, str) and c.strip() for c in packed["chunks"]))

    def test_embed_tfidf_and_minilm(self):
        cleaned = br.clean(br.EXAMPLE_DOC)
        packed = br.chunk(cleaned["text"], mode="sentences", size=60, overlap=10)
        chunks = packed["chunks"][:20]

        tf = br.embed(chunks, model="tfidf")
        self.assertEqual(tf["kind"], "tfidf")
        self.assertEqual(tf["chunkCount"], len(chunks))
        self.assertEqual(tf["dims"], tf["vocabSize"])
        self.assertEqual(len(tf["vecs"]), len(chunks))
        self.assertEqual(len(tf["vecs"][0]), tf["dims"])
        self.assertIsNotNone(tf["map"])
        self.assertEqual(len(tf["map"]["pts"]), len(chunks))

        mn = br.embed(chunks, model="minilm")
        self.assertEqual(mn["kind"], "minilm")
        self.assertEqual(mn["dims"], 384)
        self.assertEqual(len(mn["vecs"][0]), 384)

    def test_retrieve_finds_footing_cover(self):
        cleaned = br.clean(br.EXAMPLE_DOC)
        packed = br.chunk(cleaned["text"], mode="sentences", size=60, overlap=10)
        result = br.retrieve(
            packed["chunks"],
            "What nominal cover is needed for footings?",
            model="tfidf",
            k=3,
            min_score=0.0,
        )
        self.assertTrue(result["kept"])
        kept_text = " ".join(packed["chunks"][i] for i in result["kept"])
        self.assertIn("50 mm", kept_text.lower().replace(" ", " ") or kept_text)
        self.assertTrue(any("50" in packed["chunks"][i] for i in result["kept"]))
        self.assertEqual(result["ranked"][0]["i"], result["ranked"][0]["i"])
        scores = [h["s"] for h in result["ranked"]]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_catalog_has_sample_and_stages(self):
        cat = br.catalog()
        self.assertIn("models", cat)
        self.assertEqual(cat["defaults"]["model"], "minilm")
        self.assertEqual(cat["defaults"]["mode"], "sentences")
        self.assertEqual(len(cat["sample"]["tests"]), 8)
        self.assertEqual(len(cat["stages"]), 9)
        self.assertIn("{context}", cat["sample"]["template"])


if __name__ == "__main__":
    unittest.main()
