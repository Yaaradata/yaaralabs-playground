"""Unit tests for Exercise 9 persona service (no Vertex required)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services import exercises_persona_service as persona
from app.services import exercises_tokeniser_service as tokeniser


class PersonaServiceTests(unittest.TestCase):
    def test_catalog_shape(self) -> None:
        cat = persona.catalog()
        ids = [row["id"] for row in cat["models"]]
        self.assertEqual(ids, [row["id"] for row in tokeniser.MODELS])
        keys = [row["k"] for row in cat["conditions"]]
        self.assertEqual(keys, ["zero", "one", "few"])
        self.assertIn("task", cat["types"])
        self.assertIn("sys", cat["sample"])
        self.assertEqual(cat["defaults"]["model"], "gemini-38-flash")
        self.assertIn("tradeoff", cat["explain"])

    def test_prices_match_exercise_5(self) -> None:
        by_id = {row["id"]: row for row in persona.MODELS}
        for row in tokeniser.MODELS:
            self.assertEqual(by_id[row["id"]]["pin"], row["pin"])
            self.assertEqual(by_id[row["id"]]["pout"], row["pout"])

    def test_examples_for_conditions(self) -> None:
        exs = persona.SAMPLE_EXAMPLES
        self.assertEqual(persona.examples_for("zero", exs), [])
        self.assertEqual(len(persona.examples_for("one", exs)), 1)
        self.assertEqual(len(persona.examples_for("few", exs)), 3)

    def test_format_labels_intersection(self) -> None:
        labels = persona.format_labels(persona.SAMPLE_EXAMPLES)
        self.assertIn("Governing property", labels)
        self.assertIn("Pick", labels)
        self.assertIn("Why", labels)

    def test_build_turns_includes_examples(self) -> None:
        packed = persona.build_turns(
            "one",
            "Pick a bike frame material.",
            persona.SAMPLE_SYS,
            persona.SAMPLE_EXAMPLES,
        )
        self.assertTrue(packed["system"])
        self.assertEqual(len(packed["turns"]), 3)
        self.assertTrue(packed["turns"][0]["ex"])
        self.assertTrue(packed["turns"][-1].get("fin"))

    def test_off_topic_refuses_with_persona(self) -> None:
        result = persona._simulated_completion(
            persona.SAMPLE_SYS,
            persona.SAMPLE_EXAMPLES,
            "Write a short poem about the monsoon.",
            "few",
            "gemini",
            0.3,
            300,
        )
        self.assertIn("outside", result["text"].lower())

    def test_few_shot_uses_labels_on_task(self) -> None:
        result = persona._simulated_completion(
            persona.SAMPLE_SYS,
            persona.SAMPLE_EXAMPLES,
            "Pick a material for a bicycle frame that must be light and stiff.",
            "few",
            "gemini",
            0.3,
            300,
        )
        self.assertIn("Governing property:", result["text"])
        self.assertIn("Pick:", result["text"])

    def test_generate_once_falls_back_without_vertex(self) -> None:
        with patch.dict("sys.modules", {"google.genai": None, "google.genai.types": None}):
            result = persona.generate_once(
                system=persona.SAMPLE_SYS,
                examples=persona.SAMPLE_EXAMPLES,
                question="Why is titanium used for hip implants?",
                condition="one",
                model="gpt",
                temp=0.3,
                topp=1.0,
                cap=300,
            )
        self.assertTrue(result["simulated"])
        self.assertTrue(result["text"])
        self.assertEqual(result["condition"], "one")
        self.assertEqual(result["examplesSent"], 1)
        self.assertIn("cost", result)

    def test_few_requires_two_examples(self) -> None:
        with self.assertRaises(ValueError):
            persona.generate_once(
                system=persona.SAMPLE_SYS,
                examples=persona.SAMPLE_EXAMPLES[:1],
                question="Test question about steel.",
                condition="few",
                model="gemini",
            )

    def test_claude_temp_max(self) -> None:
        clamped = persona._clamp_params("claude", 1.4, 1.0, 300)
        self.assertEqual(clamped["temp"], 1.0)


if __name__ == "__main__":
    unittest.main()
