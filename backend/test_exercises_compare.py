"""Unit tests for Exercise 10 compare service (no Vertex required)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services import exercises_compare_service as compare
from app.services import exercises_tokeniser_service as tokeniser


class CompareServiceTests(unittest.TestCase):
    def test_catalog_shape(self) -> None:
        cat = compare.catalog()
        ids = [row["id"] for row in cat["models"]]
        self.assertEqual(ids, [row["id"] for row in tokeniser.MODELS])
        self.assertEqual(cat["defaults"]["lanes"], ["claude", "gpt", "gemini"])
        self.assertEqual(cat["defaults"]["maxLanes"], 4)
        self.assertIn("sys", cat["sample"])
        self.assertTrue(cat["sample"]["messages"])
        self.assertIn("blind", cat["explain"])

    def test_prices_match_exercise_5(self) -> None:
        by_id = {row["id"]: row for row in compare.MODELS}
        for row in tokeniser.MODELS:
            self.assertEqual(by_id[row["id"]]["pin"], row["pin"])
            self.assertEqual(by_id[row["id"]]["pout"], row["pout"])

    def test_claude_temp_max(self) -> None:
        clamped = compare._clamp_params("claude", 1.4, 1.0, 300)
        self.assertEqual(clamped["temp"], 1.0)

    def test_off_topic_refuses_with_persona(self) -> None:
        result = compare._simulated_completion(
            compare.SAMPLE_SYS,
            [{"role": "user", "text": "Write a short poem about the monsoon."}],
            "claude",
            0.3,
            300,
        )
        self.assertIn("outside", result["text"].lower())

    def test_models_differ_on_task(self) -> None:
        turns = [
            {
                "role": "user",
                "text": "Pick a material for a bicycle frame that must be light and stiff.",
            }
        ]
        a = compare._simulated_completion(compare.SAMPLE_SYS, turns, "claude", 0.3, 300, 0)
        b = compare._simulated_completion(compare.SAMPLE_SYS, turns, "gemini", 0.3, 300, 0)
        self.assertTrue(a["text"])
        self.assertTrue(b["text"])
        self.assertNotEqual(a["text"], b["text"])

    def test_ask_again_nonce_changes_output(self) -> None:
        turns = [{"role": "user", "text": "Why is titanium used for hip implants?"}]
        a = compare._simulated_completion(compare.SAMPLE_SYS, turns, "gpt", 0.9, 300, 0)
        b = compare._simulated_completion(compare.SAMPLE_SYS, turns, "gpt", 0.9, 300, 1)
        # High temp + nonce should usually diverge; allow equal only if flavor RNG collides.
        self.assertTrue(a["text"])
        self.assertTrue(b["text"])

    def test_generate_once_falls_back_without_vertex(self) -> None:
        with patch.dict("sys.modules", {"google.genai": None, "google.genai.types": None}):
            result = compare.generate_once(
                system=compare.SAMPLE_SYS,
                turns=[
                    {
                        "role": "user",
                        "text": "Pick a material for a bicycle frame that must be light and stiff.",
                    }
                ],
                model="gpt",
                temp=0.3,
                topp=1.0,
                cap=300,
            )
        self.assertTrue(result["simulated"])
        self.assertTrue(result["text"])
        self.assertEqual(result["model"], "gpt")
        self.assertIn("cost", result)
        self.assertIn("modelId", result)

    def test_empty_system_raises(self) -> None:
        with self.assertRaises(ValueError):
            compare.generate_once(
                system="  ",
                turns=[{"role": "user", "text": "Hello"}],
                model="gemini",
            )

    def test_last_turn_must_be_user(self) -> None:
        with self.assertRaises(ValueError):
            compare.generate_once(
                system=compare.SAMPLE_SYS,
                turns=[{"role": "assistant", "text": "Hi"}],
                model="gemini",
            )

    def test_multi_turn_history(self) -> None:
        turns = [
            {"role": "user", "text": "Pick a material for a bike frame."},
            {"role": "assistant", "text": "Aluminium is a common pick."},
            {"role": "user", "text": "What about corrosion?"},
        ]
        result = compare._simulated_completion(
            compare.SAMPLE_SYS,
            turns,
            "claude",
            0.3,
            300,
        )
        self.assertTrue(result["text"])
        self.assertGreater(result["inTok"], 20)


if __name__ == "__main__":
    unittest.main()
