"""
Retries for model calls (Gemini on Vertex AI, OpenAI / Anthropic through OpenRouter, embeddings).

A room of 20+ people sending messages at the same moment makes the providers answer some calls with 429
(rate limit / quota) or a short 5xx. Those are temporary: the same call a second or two later succeeds. So every
model call goes through here: up to ATTEMPTS tries, exponential backoff with full jitter (people who were limited
together don't all come back together), the provider's Retry-After when it sends one, and a time BUDGET so a reply
never waits forever. Errors that a retry can't fix (400 bad request, 401/403 key, 404 model) fail at once.

Only the start of a call is retried: a streamed answer that has begun is never restarted (the learner would see it
twice). Tunable with LLM_RETRY_ATTEMPTS, LLM_RETRY_BASE, LLM_RETRY_CAP and LLM_RETRY_BUDGET (seconds).
"""

from __future__ import annotations

import logging
import os
import random
import time
from typing import Callable, Optional, TypeVar

import requests

logger = logging.getLogger(__name__)

T = TypeVar("T")

ATTEMPTS = max(1, int(os.getenv("LLM_RETRY_ATTEMPTS", "5")))
BASE = float(os.getenv("LLM_RETRY_BASE", "1.0"))      # first wait is up to BASE seconds, then doubles
CAP = float(os.getenv("LLM_RETRY_CAP", "12"))         # longest single wait
BUDGET = float(os.getenv("LLM_RETRY_BUDGET", "100"))  # no new try starts after this many seconds
# One try may wait at most this long (connect, read): under a 20-person burst Gemini held a call for 118 s before
# answering 429, which used up the whole budget. A shorter read timeout drops a stuck call and retries it.
CALL_TIMEOUT = (10.0, float(os.getenv("LLM_CALL_READ_TIMEOUT", "50")))

# 408 timeout, 425 too early, 429 rate limit, 5xx server trouble, 529 Anthropic "overloaded"
RETRY_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504, 529})


def wait_for(attempt: int, retry_after: Optional[float] = None) -> float:
    """Seconds to wait before try number attempt + 1 (attempt counts from 1)."""
    if retry_after is not None and retry_after > 0:
        return min(CAP, retry_after + random.uniform(0, 0.5))
    return min(CAP, random.uniform(0.25, BASE * (2 ** (attempt - 1)) * 2))


def _retry_after(r: requests.Response) -> Optional[float]:
    try:
        return float(r.headers.get("Retry-After", ""))
    except (TypeError, ValueError):
        return None


def _left(t0: float, pause: float, budget: float) -> bool:
    return time.monotonic() - t0 + pause < budget


def send(do: Callable[[], requests.Response], label: str, attempts: int = ATTEMPTS,
         budget: float = BUDGET) -> requests.Response:
    """do() makes one HTTP request. Returns the first response that isn't a temporary failure (or the last one),
    retrying 429 / 5xx responses and dropped connections. Other exceptions propagate unchanged."""
    t0 = time.monotonic()
    for attempt in range(1, attempts + 1):
        last = attempt == attempts
        try:
            r = do()
        except (requests.ConnectionError, requests.Timeout) as e:
            pause = wait_for(attempt)
            if last or not _left(t0, pause, budget):
                raise
            logger.warning("%s: %s, retry %d/%d in %.1fs", label, type(e).__name__, attempt, attempts - 1, pause)
            time.sleep(pause)
            continue
        if r.status_code not in RETRY_STATUS:
            return r
        pause = wait_for(attempt, _retry_after(r))
        if last or not _left(t0, pause, budget):
            return r
        logger.warning("%s: HTTP %s, retry %d/%d in %.1fs", label, r.status_code, attempt, attempts - 1, pause)
        r.close()
        time.sleep(pause)
    raise AssertionError("unreachable")


def status_of(exc: BaseException) -> Optional[int]:
    """The HTTP status a client library put on its exception (google-genai, google-api-core), if any."""
    for name in ("code", "status_code", "grpc_status_code"):
        v = getattr(exc, name, None)
        if isinstance(v, int):
            return v
    v = getattr(getattr(exc, "response", None), "status_code", None)
    return v if isinstance(v, int) else None


def is_temporary(exc: BaseException) -> bool:
    """A library exception that a retry can fix: a retryable status, or one of google-api-core's transient types."""
    if isinstance(exc, (requests.ConnectionError, requests.Timeout, TimeoutError, ConnectionError)):
        return True
    if status_of(exc) in RETRY_STATUS:
        return True
    name = type(exc).__name__
    return name in {"ResourceExhausted", "ServiceUnavailable", "InternalServerError", "DeadlineExceeded",
                    "TooManyRequests", "BadGateway", "GatewayTimeout", "Aborted", "ServerError"}


def call(fn: Callable[[], T], label: str, temporary: Callable[[BaseException], bool] = is_temporary,
         attempts: int = ATTEMPTS, budget: float = BUDGET) -> T:
    """fn() with retries on temporary exceptions (for SDK calls that raise instead of returning a response)."""
    t0 = time.monotonic()
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - re-raised below unless temporary
            pause = wait_for(attempt)
            if attempt == attempts or not temporary(e) or not _left(t0, pause, budget):
                raise
            logger.warning("%s: %s (%s), retry %d/%d in %.1fs", label, type(e).__name__, status_of(e), attempt,
                           attempts - 1, pause)
            time.sleep(pause)
    raise AssertionError("unreachable")


__all__ = ["send", "call", "is_temporary", "status_of", "wait_for", "RETRY_STATUS", "ATTEMPTS", "BUDGET"]
