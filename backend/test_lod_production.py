"""Production guards for Live Object Detection cloud usage."""

from __future__ import annotations

import base64
import unittest

from app.services.live_object_detection_service import (
    NAME_ALIASES,
    _decode_image,
    _suppress_overlaps,
)
from app.models import LodVisionObject
from app.services.lod_limiter import SlidingWindowLimiter


class LodLimiterTests(unittest.TestCase):
    def test_detect_window_blocks_burst(self):
        limiter = SlidingWindowLimiter()
        self.assertTrue(limiter.allow("s1", "detect", 2, 1.0))
        self.assertTrue(limiter.allow("s1", "detect", 2, 1.0))
        self.assertFalse(limiter.allow("s1", "detect", 2, 1.0))
        self.assertTrue(limiter.allow("s2", "detect", 2, 1.0))

    def test_caption_is_separate_bucket(self):
        limiter = SlidingWindowLimiter()
        self.assertTrue(limiter.allow("s1", "caption", 1, 8.0))
        self.assertFalse(limiter.allow("s1", "caption", 1, 8.0))
        self.assertTrue(limiter.allow("s1", "detect", 2, 1.0))


class LodImageTests(unittest.TestCase):
    def test_rejects_tiny_payload(self):
        with self.assertRaises(ValueError):
            _decode_image("")

    def test_decodes_data_url(self):
        raw = b"\xff\xd8" + b"0" * 64
        encoded = base64.b64encode(raw).decode("ascii")
        decoded = _decode_image(f"data:image/jpeg;base64,{encoded}")
        self.assertEqual(decoded[:2], b"\xff\xd8")

    def test_aliases_normalize_phone(self):
        self.assertEqual(NAME_ALIASES["mobile phone"], "Cell phone")


class LodOverlapTests(unittest.TestCase):
    def test_drops_duplicate_person_boxes(self):
        items = [
            LodVisionObject(name="Person", score=0.9, box=[0, 0, 500, 500]),
            LodVisionObject(name="Person", score=0.4, box=[10, 10, 480, 480]),
            LodVisionObject(name="Laptop", score=0.7, box=[600, 600, 900, 900]),
        ]
        kept = _suppress_overlaps(items)
        names = [item.name for item in kept]
        self.assertEqual(names.count("Person"), 1)
        self.assertIn("Laptop", names)

    def test_drops_nested_person_with_low_iou(self):
        items = [
            LodVisionObject(name="Person", score=0.95, box=[0, 0, 1000, 1000]),
            LodVisionObject(name="Person", score=0.24, box=[200, 200, 500, 800]),
        ]
        kept = _suppress_overlaps(items)
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].score, 0.95)

    def test_keeps_held_object_inside_person(self):
        items = [
            LodVisionObject(name="Person", score=0.9, box=[0, 0, 800, 1000]),
            LodVisionObject(name="Laptop", score=0.8, box=[200, 400, 500, 700]),
        ]
        kept = _suppress_overlaps(items)
        names = [item.name for item in kept]
        self.assertIn("Person", names)
        self.assertIn("Laptop", names)


if __name__ == "__main__":
    unittest.main()
