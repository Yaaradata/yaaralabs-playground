"""Production guards for Live Object Detection cloud usage."""

from __future__ import annotations

import base64
import unittest
from types import SimpleNamespace

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


class _Guests:
    def __init__(self):
        self.calls = 0

    async def validate_session(self, session_id):
        self.calls += 1
        if session_id == "gone":
            raise ValueError(f"Guest session {session_id} not found")
        return {"session_id": session_id}


class _Projects:
    def __init__(self):
        self.calls = 0

    async def get_project(self, project_id):
        self.calls += 1
        return SimpleNamespace(student_id="s1", type="live-object-detection")


class _Lod:
    def detect(self, image_base64):
        return [LodVisionObject(name="Bottle", score=0.8, box=[100, 100, 400, 300])]


class LodChecksOncePerMinute(unittest.TestCase):
    """Every frame re-read the session and the project and wrote the session's last_active: about 1 s
    of Firestore per frame before Cloud Vision even started, so the boxes were slow to follow."""

    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from app.api import live_object_detection as lod

        getattr(lod, "_checked", {}).clear()
        lod.lod_limiter._hits.clear()
        self.guests, self.projects = _Guests(), _Projects()
        app = FastAPI()
        app.include_router(lod.router)
        app.dependency_overrides[lod.get_guest_service] = lambda: self.guests
        app.dependency_overrides[lod.get_project_service] = lambda: self.projects
        app.dependency_overrides[lod.get_lod_service] = lambda: _Lod()
        self.client = TestClient(app)
        self.frame = {"image_base64": "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8" + b"0" * 64).decode()}

    def detect(self, session="s1", project="p1"):
        return self.client.post(f"/api/lod/session/{session}/projects/{project}/detect", json=self.frame)

    def test_five_frames_check_once(self):
        for _ in range(5):
            r = self.detect()
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["objects"][0]["name"], "Bottle")
        self.assertEqual((self.guests.calls, self.projects.calls), (1, 1))

    def test_other_session_is_still_refused(self):
        self.assertEqual(self.detect().status_code, 200)
        self.assertEqual(self.detect(session="s2").status_code, 403)
        self.assertEqual(self.detect(session="s2").status_code, 403)  # a failed check is not remembered

    def test_missing_session_is_refused(self):
        self.assertEqual(self.detect(session="gone").status_code, 404)


if __name__ == "__main__":
    unittest.main()
