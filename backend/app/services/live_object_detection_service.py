"""Live Object Detection via Cloud Vision object localization."""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, List, Tuple

from google.api_core.exceptions import GoogleAPICallError

from ..config import gcp_clients
from ..models import LodCaptionRequest, LodVisionObject

logger = logging.getLogger(__name__)

SCORE_THRESHOLD = 0.14
MAX_OBJECTS = 16
NAME_ALIASES = {
    "human body": "Person",
    "man": "Person",
    "woman": "Person",
    "boy": "Person",
    "girl": "Person",
    "mobile phone": "Cell phone",
    "cellphone": "Cell phone",
    "smartphone": "Cell phone",
    "phone": "Cell phone",
    "iphone": "Cell phone",
    "android": "Cell phone",
    "laptop computer": "Laptop",
    "computer": "Laptop",
    "notebook computer": "Laptop",
    "macbook": "Laptop",
    "coffee cup": "Cup",
    "mug": "Cup",
    "coffee mug": "Cup",
    "tumbler": "Cup",
    "water bottle": "Bottle",
    "plastic bottle": "Bottle",
    "drink bottle": "Bottle",
    "flask": "Bottle",
    "remote control": "Remote",
    "television": "TV",
    "computer monitor": "TV",
    "monitor": "TV",
    "eyeglasses": "Glasses",
    "spectacles": "Glasses",
    "footwear": "Shoe",
    "sneaker": "Shoe",
    "boot": "Shoe",
    "headphones": "Headphones",
    "headphone": "Headphones",
    "earphone": "Headphones",
    "earbuds": "Headphones",
}
CLOTHING_LABELS = {
    "clothing",
    "top",
    "pants",
    "outerwear",
    "jeans",
    "dress",
    "skirt",
    "coat",
    "jacket",
    "shirt",
    "shorts",
    "miniskirt",
    "suit",
    "tie",
}

CAPTION_PROMPT = """Write one present-tense sentence about what is happening in this webcam frame.

Detected objects from the live vision model: {objects}

Return ONLY JSON, no markdown:
{{"caption": "one present-tense sentence"}}

Rules:
- Describe only what is clearly visible.
- Prefer the listed object names when they match the frame.
- Do not invent a cup, phone, bottle, or bag if it is not in the list and not clearly visible.
- An empty hand is not a held object.
- If objects are listed, mention at least one of them.
"""

_vision_client = None


def _get_vision_client():
    global _vision_client
    if _vision_client is None:
        from google.cloud.vision_v1 import ImageAnnotatorClient

        _vision_client = ImageAnnotatorClient()
        logger.info("Cloud Vision client ready for live object detection")
    return _vision_client


def _decode_image(image_base64: str) -> bytes:
    raw = (image_base64 or "").strip()
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(raw, validate=False)
    except Exception as exc:
        raise ValueError("Invalid image data") from exc
    if len(image_bytes) < 32:
        raise ValueError("Image is too small")
    if len(image_bytes) > 2_000_000:
        raise ValueError("Image is too large")
    return image_bytes


def _box_from_vertices(vertices: Any) -> List[float]:
    xs = [float(getattr(point, "x", 0.0) or 0.0) for point in vertices]
    ys = [float(getattr(point, "y", 0.0) or 0.0) for point in vertices]
    if not xs or not ys:
        return []
    # Support both normalized (0-1) and absolute pixel vertices.
    max_x = max(xs)
    max_y = max(ys)
    if max_x > 1.5 or max_y > 1.5:
        # Absolute pixels — normalize later via a synthetic 1000-scale using extents.
        # Caller expects 0-1000 normalized Gemini-style coords; approximate with frame-relative
        # values if we only have absolute coords without frame size (skip bad boxes).
        return []
    ymin = max(0.0, min(ys))
    xmin = max(0.0, min(xs))
    ymax = min(1.0, max(ys))
    xmax = min(1.0, max(xs))
    if xmax - xmin < 0.008 or ymax - ymin < 0.008:
        return []
    # Slight inset keeps boxes visually tighter on the subject.
    pad_y = (ymax - ymin) * 0.02
    pad_x = (xmax - xmin) * 0.02
    ymin = max(0.0, ymin + pad_y)
    xmin = max(0.0, xmin + pad_x)
    ymax = min(1.0, ymax - pad_y)
    xmax = min(1.0, xmax - pad_x)
    if xmax - xmin < 0.008 or ymax - ymin < 0.008:
        return []
    return [ymin * 1000.0, xmin * 1000.0, ymax * 1000.0, xmax * 1000.0]


def _coverage(inner: List[float], outer: List[float]) -> float:
    iy1, ix1, iy2, ix2 = inner
    oy1, ox1, oy2, ox2 = outer
    ix = max(0.0, min(ix2, ox2) - max(ix1, ox1))
    iy = max(0.0, min(iy2, oy2) - max(iy1, oy1))
    area = max(1.0, (ix2 - ix1) * (iy2 - iy1))
    return (ix * iy) / area


def _iou(a: List[float], b: List[float]) -> float:
    ay1, ax1, ay2, ax2 = a
    by1, bx1, by2, bx2 = b
    ix = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def _suppress_overlaps(items: List[LodVisionObject]) -> List[LodVisionObject]:
    ranked = sorted(items, key=lambda item: item.score, reverse=True)
    kept: List[LodVisionObject] = []
    people = [item for item in ranked if item.name.lower() == "person"]
    for item in ranked:
        if len(item.box) < 4:
            continue
        name = item.name.lower()
        if name in CLOTHING_LABELS and people:
            if any(_coverage(item.box, person.box) > 0.55 for person in people):
                continue
        overlapping = any(_is_duplicate_box(item, other) for other in kept)
        if overlapping:
            continue
        kept.append(item)
        if len(kept) >= MAX_OBJECTS:
            break
    return kept


def _is_duplicate_box(item: LodVisionObject, other: LodVisionObject) -> bool:
    name = item.name.lower()
    other_name = other.name.lower()
    overlap = _iou(item.box, other.box)
    if name != other_name:
        return overlap >= 0.84
    nested = _coverage(item.box, other.box) > 0.5 or _coverage(other.box, item.box) > 0.5
    if nested:
        return True
    return overlap > (0.28 if name == "person" else 0.42)


def _parse_caption_payload(text: str) -> str:
    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
    raw = re.sub(r"\s*```$", "", raw)
    match = re.search(r"\{.*\}", raw, flags=re.S)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                caption = str(parsed.get("caption") or "").strip().strip('"')
                if caption:
                    return caption
        except json.JSONDecodeError:
            logger.warning("LOD caption JSON parse failed")
    return re.sub(r"\s+", " ", raw).strip().strip('"')


class LiveObjectDetectionService:
    def detect(self, image_base64: str) -> List[LodVisionObject]:
        from google.cloud.vision_v1.types import Image

        from . import mock_ai

        image_bytes = _decode_image(image_base64)
        if mock_ai.enabled():  # load tests: no Cloud Vision call (mock_ai.py)
            mock_ai.delay(0.3, 1.2)
            return []
        image = Image(content=image_bytes)
        try:
            response = _get_vision_client().object_localization(image=image)
        except GoogleAPICallError as exc:
            logger.error("Cloud Vision object localization failed: %s", exc)
            raise RuntimeError("Cloud Vision could not analyze this frame") from exc

        if response.error.message:
            raise RuntimeError(response.error.message)

        detected: List[LodVisionObject] = []
        for obj in response.localized_object_annotations:
            score = float(obj.score or 0.0)
            if score < SCORE_THRESHOLD:
                continue
            name = (obj.name or "").strip()
            if not name:
                continue
            name = NAME_ALIASES.get(name.lower(), name)
            box = _box_from_vertices(obj.bounding_poly.normalized_vertices)
            if not box:
                continue
            detected.append(LodVisionObject(name=name[:60], score=score, box=box))
        return _suppress_overlaps(detected)

    def caption(self, body: LodCaptionRequest) -> Tuple[str, List[LodVisionObject]]:
        from . import mock_ai

        image_bytes = _decode_image(body.image_base64)
        if mock_ai.enabled():  # load tests (mock_ai.py)
            mock_ai.delay()
            return "A person is at the desk.", []
        # Prefer client detections; if the live UI still has none, localize this frame.
        localized: List[LodVisionObject] = []
        if body.detections:
            localized = [
                LodVisionObject(name=item.class_name[:60], score=float(item.score or 0.7), box=[])
                for item in body.detections
                if item.class_name
            ]
        else:
            try:
                localized = self.detect(body.image_base64)
            except Exception:
                logger.exception("LOD caption fallback detect failed")
                localized = []

        names = ", ".join(item.name for item in localized if item.name) or "none"
        from .vertex_ai_service import VertexAIService

        vertex = VertexAIService(gcp_clients.project_id)
        prompt = CAPTION_PROMPT.format(objects=names)
        reply = vertex.generate_from_image(image_bytes, prompt, max_tokens=120)
        caption = re.sub(r"\s+", " ", _parse_caption_payload(reply))
        if len(caption) > 180:
            caption = caption[:177].rstrip() + "..."
        if (not caption or "no prominent" in caption.lower()) and localized:
            lead = localized[0].name
            caption = f"{lead} is in the camera frame."
        return caption or "The scene is in view.", localized
