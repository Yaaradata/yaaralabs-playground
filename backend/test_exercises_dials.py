"""Unit tests for Exercise 8 dials service (no Vertex required)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services import exercises_dials_service as dials
from app.services import exercises_tokeniser_service as tokeniser


class DialsServiceTests(unittest.TestCase):
    def test_catalog_shape(self) -> None:
        cat = dials.catalog()
        ids = [row["id"] for row in cat["models"]]
        self.assertEqual(ids, [row["id"] for row in tokeniser.MODELS])
        self.assertEqual(
            ids,
            ["gemini-38-flash", "gpt-6-luna", "claude-haiku-55"],
        )
        keys = [row["key"] for row in cat["dials"]]
        self.assertEqual(keys, ["temp", "topk", "topp", "cap"])
        self.assertIn("temp", cat["presets"])
        self.assertEqual(cat["defaults"]["view"], "temp")
        self.assertEqual(cat["defaults"]["model"], "gemini-38-flash")
        self.assertIn("factual", cat["explain"])

    def test_prices_match_exercise_5(self) -> None:
        by_id = {row["id"]: row for row in dials.MODELS}
        for row in tokeniser.MODELS:
            self.assertEqual(by_id[row["id"]]["pin"], row["pin"])
            self.assertEqual(by_id[row["id"]]["pout"], row["pout"])
            self.assertEqual(by_id[row["id"]]["name"], row["name"])

    def test_claude_temp_max_is_one(self) -> None:
        clamped = dials._clamp_dials("claude", {"temp": 1.4, "topk": 0, "topp": 1, "cap": 60})
        self.assertEqual(clamped["temp"], 1.0)

    def test_clamp_respects_temp_max_and_cap(self) -> None:
        clamped = dials._clamp_dials(
            "gemini",
            {"temp": 9, "topk": 200, "topp": 0.01, "cap": 1},
        )
        self.assertEqual(clamped["temp"], 2.0)
        self.assertEqual(clamped["topk"], 100.0)
        self.assertEqual(clamped["topp"], 0.05)
        self.assertEqual(clamped["cap"], 5.0)

    def test_low_temperature_is_consistent(self) -> None:
        prompt = "Write a one-line handover note."
        dial = {"temp": 0.1, "topk": 0, "topp": 1, "cap": 60}
        a = dials._simulated_completion(prompt, "gemini", dial, 0)
        b = dials._simulated_completion(prompt, "gemini", dial, 1)
        self.assertEqual(a["text"], b["text"])

    def test_high_temperature_adds_variety(self) -> None:
        prompt = "Write a one-line handover note."
        dial = {"temp": 1.4, "topk": 0, "topp": 1, "cap": 60}
        texts = {
            dials._simulated_completion(prompt, "gemini", dial, i)["text"]
            for i in range(5)
        }
        self.assertGreaterEqual(len(texts), 2)

    def test_output_cap_truncates(self) -> None:
        prompt = "Write a long creative handover note with many details."
        dial = {"temp": 1.2, "topk": 0, "topp": 1, "cap": 8}
        result = dials._simulated_completion(prompt, "gemini", dial, 0)
        self.assertEqual(result["stop"], "max_tokens")
        self.assertTrue(result["text"])

    def test_generate_once_falls_back_without_vertex(self) -> None:
        # google.genai import fails → classroom simulator path.
        with patch.dict("sys.modules", {"google.genai": None, "google.genai.types": None}):
            result = dials.generate_once(
                prompt="Say hello in one short line.",
                model="gpt-6-luna",
                dials={"temp": 0.2, "topk": 0, "topp": 1, "cap": 40},
                index=0,
            )
        self.assertTrue(result["simulated"])
        self.assertTrue(result["text"])
        self.assertIn("cost", result)
        self.assertEqual(result["model"], "openai/gpt-6-luna")  # GPT runs through OpenRouter
        self.assertEqual(result["dials"]["temp"], 0.2)

    def test_cost_scales_with_tokens(self) -> None:
        # cost follows the price table (exercises_vertex_models) and doubles with twice the tokens
        for model in ("gemini-38-flash", "gpt-6-luna", "claude-haiku-55"):
            one = dials.cost_of(100, 100, model)
            self.assertGreater(one, 0)
            self.assertAlmostEqual(dials.cost_of(200, 200, model), 2 * one)
        self.assertGreater(dials.cost_of(100, 100, "gemini-38-flash"), dials.cost_of(100, 100, "gpt-6-luna"))

    def test_topk_disabled_for_gpt(self) -> None:
        with patch.dict("sys.modules", {"google.genai": None, "google.genai.types": None}):
            result = dials.generate_once(
                prompt="Short note.",
                model="gpt-6-luna",
                dials={"temp": 0.7, "topk": 20, "topp": 1, "cap": 40},
                index=0,
            )
        self.assertEqual(result["dials"]["topk"], 0)
        self.assertEqual(result["model"], "openai/gpt-6-luna")  # GPT runs through OpenRouter


if __name__ == "__main__":
    unittest.main()
