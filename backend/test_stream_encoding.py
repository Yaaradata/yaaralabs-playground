"""Streamed replies keep non-ASCII text ("—", "₹", "é"): the streams carry no charset, so they must be read as UTF-8.
Offline: the HTTP response is built from raw bytes.

  .venv/Scripts/python.exe -m unittest test_stream_encoding -v
"""

from __future__ import annotations

import io
import json
import unittest
from unittest import mock

import requests

from app.services import ai_agent_service, openrouter_service

TEXT = "Settlement is T+1 — fees ₹1,200, café"


def raw_response(lines) -> requests.Response:
    r = requests.Response()
    r.status_code = 200
    r.headers["Content-Type"] = "text/event-stream"  # no charset, like the providers
    r.raw = io.BytesIO("".join(f"{line}\n\n" for line in lines).encode("utf-8"))
    return r


class StreamEncodingTests(unittest.TestCase):
    def test_gemini_stream_keeps_unicode(self):
        event = "data: " + json.dumps({"candidates": [{"content": {"parts": [{"text": TEXT}]}}]}, ensure_ascii=False)
        session = mock.Mock()
        session.post.return_value = raw_response([event])
        with mock.patch.object(ai_agent_service, "_session", return_value=session), \
             mock.patch("app.services.mock_ai.enabled", return_value=False):
            out = "".join(ai_agent_service.stream_text("gemini-3.8-flash", "sys", [{"role": "user", "text": "hi"}], 0.2, 100))
        self.assertEqual(out, TEXT)

    def test_openrouter_stream_keeps_unicode(self):
        event = "data: " + json.dumps({"choices": [{"delta": {"content": TEXT}}]}, ensure_ascii=False)
        with mock.patch.object(openrouter_service, "_api_key", return_value="k"), \
             mock.patch.object(openrouter_service.requests, "post", return_value=raw_response([event, "data: [DONE]"])):
            chunks = list(openrouter_service.generate_content_stream("anthropic/claude-haiku-5.5", "hi"))
        self.assertEqual("".join(c.text for c in chunks), TEXT)


if __name__ == "__main__":
    unittest.main()
