"""Unit tests for Exercise 5 tokeniser service (no Vertex required)."""

from __future__ import annotations

import unittest

from app.services import exercises_tokeniser_service as tokeniser


class TokeniserServiceTests(unittest.TestCase):
    def test_catalog_shape(self) -> None:
        cat = tokeniser.catalog()
        ids = [row["id"] for row in cat["models"]]
        self.assertEqual(
            ids,
            ["gpt", "claude", "gemini", "grok", "deepseek", "phi", "qwen"],
        )
        self.assertIn("en", {row["id"] for row in cat["langs"]})
        self.assertIn("ta", {row["id"] for row in cat["langs"]})
        self.assertEqual(cat["lengths"], [50, 100, 150])
        self.assertEqual(cat["defaults"]["models"], ["gpt", "claude", "deepseek"])

    def test_english_cheaper_than_tamil_on_gpt2(self) -> None:
        en = tokeniser.tokenize("gpt2", tokeniser.REF["en"])["count"]
        ta = tokeniser.tokenize("gpt2", tokeniser.REF["ta"])["count"]
        self.assertGreater(ta, en)
        self.assertGreaterEqual(ta / max(1, en), 1.5)

    def test_o200k_narrows_gap_vs_gpt2(self) -> None:
        gpt2_ratio = tokeniser.tokenize("gpt2", tokeniser.REF["ta"])["count"] / max(
            1, tokeniser.tokenize("gpt2", tokeniser.REF["en"])["count"]
        )
        o200k_ratio = tokeniser.tokenize("o200k", tokeniser.REF["ta"])["count"] / max(
            1, tokeniser.tokenize("o200k", tokeniser.REF["en"])["count"]
        )
        self.assertLess(o200k_ratio, gpt2_ratio)

    def test_segments_reassemble(self) -> None:
        text = tokeniser.REF["hi"]
        result = tokeniser.tokenize("o200k", text, want_segments=True)
        joined = "".join(seg["text"] for seg in result["segments"])
        self.assertEqual(joined, text)
        self.assertEqual(result["count"], len(result["ids"]))
        self.assertGreater(result["count"], 0)

    def test_batch_preserves_order(self) -> None:
        rows = tokeniser.tokenize_batch(
            [
                {"enc": "o200k", "text": "alpha"},
                {"enc": "cl100k", "text": "beta"},
                {"enc": "gpt2", "text": "gamma"},
            ]
        )
        self.assertEqual([row["enc"] for row in rows], ["o200k", "cl100k", "gpt2"])

    def test_build_prompt_rejects_unknown_lang(self) -> None:
        with self.assertRaises(ValueError):
            tokeniser.build_prompt("Why?", "xx", 50)

    def test_simulated_answer_respects_word_budget(self) -> None:
        text = tokeniser._simulated_answer("Why binary search?", "en", 25)
        self.assertLessEqual(len(text.split()), 25)
        self.assertTrue(text.strip())

    def test_ref_tpw_keys(self) -> None:
        tpw = tokeniser.ref_tpw()
        self.assertIn("en", tpw)
        self.assertIn("ta", tpw)
        self.assertIn("o200k", tpw["en"])
        self.assertGreater(tpw["ta"]["gpt2"], tpw["en"]["gpt2"])


if __name__ == "__main__":
    unittest.main()
