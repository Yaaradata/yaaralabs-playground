"""Unit tests for Exercise 11 RAG service."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services import exercises_rag_service as rag


class RagServiceTests(unittest.TestCase):
    def test_catalog_shape(self) -> None:
        cat = rag.catalog()
        self.assertTrue(cat["models"])
        self.assertEqual(cat["searchKind"], "tfidf")
        self.assertIn("doc", cat["sample"])
        self.assertIn("strict", cat["prompts"])
        self.assertEqual(cat["defaults"]["k"], 3)
        self.assertTrue(cat["defaults"]["strict"])

    def test_chunk_words_overlap(self) -> None:
        text = " ".join(f"w{i}" for i in range(100))
        chunks = rag.chunk_document(text, mode="words", size=40, overlap=10)
        self.assertGreater(len(chunks), 1)
        self.assertLessEqual(len(chunks[0].split()), 40)

    def test_chunk_sentences_and_sections(self) -> None:
        doc = rag.SAMPLE_DOC
        by_sent = rag.chunk_document(doc, mode="sentences", size=80, overlap=10)
        by_sec = rag.chunk_document(doc, mode="sections", size=120, overlap=10)
        by_words = rag.chunk_document(doc, mode="words", size=40, overlap=5)
        self.assertTrue(by_sent)
        self.assertTrue(by_sec)
        self.assertTrue(by_words)
        # Sections keep paragraph boundaries; words use a sliding window.
        self.assertNotEqual(by_sec[0], by_words[0])
        self.assertGreater(len(by_words), len(by_sec))

    def test_search_finds_cover_chunk(self) -> None:
        chunks = rag.chunk_document(rag.SAMPLE_DOC, mode="words", size=60, overlap=10)
        result = rag.search_chunks(chunks, "minimum nominal cover for a column", k=3, min_score=0.0)
        self.assertTrue(result["hits"])
        joined = " ".join(h["text"].lower() for h in result["hits"])
        self.assertIn("column", joined)
        self.assertIn("40", joined)

    def test_search_min_score_drops_hits(self) -> None:
        chunks = rag.chunk_document(rag.SAMPLE_DOC, mode="words", size=60, overlap=10)
        low = rag.search_chunks(chunks, "seismic zone factor Chennai", k=3, min_score=0.0)
        high = rag.search_chunks(chunks, "seismic zone factor Chennai", k=3, min_score=0.4)
        self.assertGreaterEqual(len(low["hits"]), len(high["hits"]))

    def test_build_prompt_strict_and_nodoc(self) -> None:
        hits = [{"i": 2, "text": "Columns: 40 mm.", "score": 0.5}]
        strict = rag.build_prompt("cover?", use_doc=True, strict=True, hits=hits)
        self.assertIn("The document does not say", strict["system"])
        self.assertIn("[3]", strict["user"])
        nodoc = rag.build_prompt("cover?", use_doc=False, strict=True, hits=[])
        self.assertEqual(nodoc["user"], "cover?")
        self.assertNotIn("Context passages", nodoc["user"])

    def test_ask_requires_document_when_use_doc(self) -> None:
        with self.assertRaises(ValueError):
            rag.ask("What is cover?", use_doc=True, document="")

    def test_ask_grounded_simulated_fallback(self) -> None:
        with patch.object(rag.compare, "generate_once", side_effect=RuntimeError("offline")):
            result = rag.ask(
                "What is the minimum nominal cover for a column?",
                document=rag.SAMPLE_DOC,
                model="claude",
                strict=True,
                use_doc=True,
                k=3,
            )
        self.assertTrue(result["simulated"])
        self.assertTrue(result["hits"])
        self.assertIn("prompt", result)
        self.assertIn("40", result["text"])

    def test_ask_without_document_hallucinates(self) -> None:
        with patch.object(rag.compare, "generate_once", side_effect=RuntimeError("offline")):
            result = rag.ask(
                "What is the minimum nominal cover for a column?",
                use_doc=False,
                document="",
                model="gpt",
            )
        self.assertFalse(result["useDoc"])
        self.assertEqual(result["hits"], [])
        self.assertIn("guessing", result["text"].lower())

    def test_ask_strict_unknown_says_does_not_say(self) -> None:
        with patch.object(rag.compare, "generate_once", side_effect=RuntimeError("offline")):
            result = rag.ask(
                "What seismic zone factor should I use for a building in Chennai?",
                document=rag.SAMPLE_DOC,
                strict=True,
                use_doc=True,
                k=3,
                min_score=0.0,
            )
        self.assertEqual(result["text"].strip(), "The document does not say.")


if __name__ == "__main__":
    unittest.main()
