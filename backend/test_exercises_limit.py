"""Unit tests for Exercise 11 limit service."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services import exercises_limit_service as limit_lab
from app.services import exercises_tokeniser_service as tokeniser


class LimitServiceTests(unittest.TestCase):
    def test_catalog_shape(self) -> None:
        cat = limit_lab.catalog()
        ids = [row["id"] for row in cat["models"]]
        self.assertEqual(ids, [row["id"] for row in tokeniser.MODELS])
        self.assertEqual(cat["limits"], [1000, 2000, 4000, 8000])
        self.assertIn("longText", cat["sample"])
        self.assertTrue(cat["sample"]["messages"])
        self.assertEqual(cat["msgOverhead"], 4)

    def test_sample_sys_non_empty(self) -> None:
        self.assertIn("MatSel", limit_lab.SAMPLE_SYS)

    def test_generate_chat_falls_back_without_vertex(self) -> None:
        with patch.dict("sys.modules", {"google.genai": None, "google.genai.types": None}):
            result = limit_lab.generate_chat(
                system=limit_lab.SAMPLE_SYS,
                turns=[{"role": "user", "text": "Pick a material for a drone arm."}],
                model="gpt",
                temp=0.3,
                topp=1.0,
                cap=300,
            )
        self.assertTrue(result["simulated"])
        self.assertTrue(result["text"])
        self.assertGreater(result["inTok"], 0)

    def test_generate_compact_requires_transcript(self) -> None:
        with self.assertRaises(ValueError):
            limit_lab.generate_compact("   ")

    def test_generate_compact_falls_back_without_vertex(self) -> None:
        transcript = "User: What payload?\n\nAssistant: 2 kg."
        with patch.dict("sys.modules", {"google.genai": None, "google.genai.types": None}):
            result = limit_lab.generate_compact(transcript, model="gemini", cap=300)
        self.assertTrue(result["text"])


if __name__ == "__main__":
    unittest.main()
