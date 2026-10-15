"""
Per-session rate limits on the routes that call a model (docs/hardening.md, P1).

About 12 calls a minute per session and per action: plenty for a person (sample questions included),
not for a script or a stuck loop. Over the limit the reply is 429 with a friendly message, never a 500.
Reuses the Live Object Detection SlidingWindowLimiter (per instance).

    @router.post("/chat", dependencies=[Depends(rate_limit("chat"))])
"""

from __future__ import annotations

from fastapi import HTTPException, Request

from ..services.lod_limiter import SlidingWindowLimiter
from .agent_access import _body

PER_MINUTE = 12
WINDOW_S = 60.0
SLOW_DOWN = "You're going a bit fast. Wait a few seconds and try again."

_limiter = SlidingWindowLimiter()


def rate_limit(action: str, per_minute: int = PER_MINUTE):
    async def dependency(request: Request) -> None:
        sid = request.path_params.get("session_id") or request.query_params.get("session_id")
        if not sid:
            body = await _body(request)
            sid = body.get("session_id") if hasattr(body, "get") else None
        if not sid:
            return  # the route itself answers 400 / 422 for a missing session
        if not _limiter.allow(str(sid), action, per_minute, WINDOW_S):
            raise HTTPException(status_code=429, detail=SLOW_DOWN)

    return dependency
