"""Per-session sliding-window limits for Live Object Detection cloud calls."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict, Tuple

Key = Tuple[str, str]


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: Dict[Key, Deque[float]] = {}
        self._last_prune = time.monotonic()

    def allow(self, session_id: str, action: str, max_hits: int, window_s: float) -> bool:
        now = time.monotonic()
        key = (session_id, action)
        with self._lock:
            queue = self._hits.setdefault(key, deque())
            cutoff = now - window_s
            while queue and queue[0] < cutoff:
                queue.popleft()
            if len(queue) >= max_hits:
                return False
            queue.append(now)
            if now - self._last_prune > 60:
                self._prune(now)
            return True

    def _prune(self, now: float) -> None:
        stale = [key for key, queue in self._hits.items() if not queue or now - queue[-1] > 120]
        for key in stale:
            self._hits.pop(key, None)
        self._last_prune = now


lod_limiter = SlidingWindowLimiter()

DETECT_MAX_HITS = 6
DETECT_WINDOW_S = 1.0
CAPTION_MAX_HITS = 3
CAPTION_WINDOW_S = 5.0
