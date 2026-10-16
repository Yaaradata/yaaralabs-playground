"""ISIN lookup: NSE's equity list first, then OpenFIGI (app/services/agent_tools.py). Offline: requests is mocked.

  .venv/Scripts/python.exe -m unittest test_openfigi -v
"""

from __future__ import annotations

import unittest
from unittest import mock

import requests

from app.services import agent_tools, llm_retry

APPLE = "US0378331005"
FUND = "INF209K01YN0"


def resp(status: int, body=None) -> mock.Mock:
    r = mock.Mock(spec=requests.Response)
    r.status_code = status
    r.headers = {}
    r.json.return_value = body
    r.text = ""
    return r


APPLE_BODY = [{"data": [
    {"figi": "BBG000B9XS41", "name": "APPLE INC", "ticker": "AAPL", "exchCode": "UN", "compositeFIGI": "BBG000B9XRY4",
     "securityType": "Common Stock", "securityType2": "Common Stock", "marketSector": "Equity"},
    {"figi": "BBG000B9XRY4", "name": "APPLE INC", "ticker": "AAPL", "exchCode": "US", "compositeFIGI": "BBG000B9XRY4",
     "securityType": "Common Stock", "securityType2": "Common Stock", "marketSector": "Equity"},
]}]


class LookupTests(unittest.TestCase):
    def setUp(self):
        agent_tools._figi_cache.clear()
        from app.config import settings
        for p in (mock.patch.object(llm_retry.time, "sleep"),
                  mock.patch.object(settings, "openfigi_api_key", "test-key")):
            p.start()
            self.addCleanup(p.stop)

    def test_nse_equity_never_calls_openfigi(self):
        with mock.patch.object(agent_tools.requests, "post") as post:
            out = agent_tools.lookup_isin("INE002A01018")
        post.assert_not_called()
        self.assertTrue(out["found"])
        self.assertEqual(out["company"], "Reliance Industries Limited")
        self.assertEqual(out["face_value"], "10")
        self.assertIn("NSE", out["source"])

    def test_typo_never_calls_openfigi(self):
        with mock.patch.object(agent_tools.requests, "post") as post:
            out = agent_tools.lookup_isin("INE002A01019")
        post.assert_not_called()
        self.assertFalse(out["found"])
        self.assertIn("check digit", out["note"])

    def test_foreign_share_found_on_openfigi_composite_preferred(self):
        with mock.patch.object(agent_tools.requests, "post", return_value=resp(200, APPLE_BODY)) as post:
            out = agent_tools.lookup_isin(APPLE)
        self.assertTrue(out["found"])
        self.assertEqual(out["company"], "APPLE INC")
        self.assertEqual(out["exchange"], "US")  # the composite listing, not the first row
        self.assertIn("OpenFIGI", out["source"])
        self.assertEqual(post.call_args.kwargs["headers"]["X-OPENFIGI-APIKEY"], "test-key")
        self.assertEqual(post.call_args.kwargs["json"], [{"idType": "ID_ISIN", "idValue": APPLE}])

    def test_no_match_on_openfigi(self):
        with mock.patch.object(agent_tools.requests, "post", return_value=resp(200, [{"warning": "No identifier found."}])):
            out = agent_tools.lookup_isin(FUND)
        self.assertFalse(out["found"])
        self.assertIn("OpenFIGI has no match", out["note"])

    def test_openfigi_down_falls_back_to_nse_answer(self):
        with mock.patch.object(agent_tools.requests, "post", side_effect=requests.ConnectionError("down")):
            out = agent_tools.lookup_isin(FUND)
        self.assertFalse(out["found"])
        self.assertIn("could not be reached", out["note"])

    def test_openfigi_error_status_falls_back(self):
        for code in (401, 500):
            agent_tools._figi_cache.clear()
            with mock.patch.object(agent_tools.requests, "post", return_value=resp(code, {})):
                out = agent_tools.lookup_isin(FUND)
            self.assertFalse(out["found"])
            self.assertIn("could not be reached", out["note"])

    def test_rate_limit_retried_then_found(self):
        with mock.patch.object(agent_tools.requests, "post", side_effect=[resp(429, {}), resp(200, APPLE_BODY)]) as post:
            out = agent_tools.lookup_isin(APPLE)
        self.assertTrue(out["found"])
        self.assertEqual(post.call_count, 2)

    def test_bad_json_falls_back(self):
        r = resp(200)
        r.json.side_effect = ValueError("not json")
        with mock.patch.object(agent_tools.requests, "post", return_value=r):
            self.assertIn("could not be reached", agent_tools.lookup_isin(FUND)["note"])

    def test_answers_are_cached(self):
        with mock.patch.object(agent_tools.requests, "post", return_value=resp(200, APPLE_BODY)) as post:
            agent_tools.lookup_isin(APPLE)
            agent_tools.lookup_isin(APPLE)
            agent_tools.lookup_isin(" us0378331005 ")
        self.assertEqual(post.call_count, 1)

    def test_failures_are_not_cached(self):
        with mock.patch.object(agent_tools.requests, "post",
                               side_effect=[requests.ConnectionError("down")] * 3 + [resp(200, APPLE_BODY)]):
            self.assertFalse(agent_tools.lookup_isin(APPLE)["found"])
            self.assertTrue(agent_tools.lookup_isin(APPLE)["found"])

    def test_mock_ai_mode_never_calls_out(self):
        with mock.patch("app.services.mock_ai.enabled", return_value=True), \
             mock.patch.object(agent_tools.requests, "post") as post:
            out = agent_tools.lookup_isin(APPLE)
        post.assert_not_called()
        self.assertFalse(out["found"])

    def test_tool_result_is_json_safe(self):
        import json
        with mock.patch.object(agent_tools.requests, "post", return_value=resp(200, APPLE_BODY)):
            json.dumps(agent_tools.lookup_isin(APPLE))


if __name__ == "__main__":
    unittest.main()
