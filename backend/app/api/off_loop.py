"""
Run a blocking "async" service call off the event loop (docs/hardening.md, item 3 and the load test).

GuestService and ProjectService methods are `async def`, but their bodies call the synchronous
Firestore / Cloud Storage clients, so awaiting them blocks the single event loop for each network
round trip. With 30 people, the session check alone (on almost every request) queued everyone behind
everyone else and /health stopped answering. off_loop runs such a coroutine in a worker thread with
its own short-lived event loop. It is only safe for coroutines that don't use loop-bound objects
(asyncio locks, queues, sleeps): true for GuestService and ProjectService, which only await each other.

    session = await off_loop(guest_service.validate_session, session_id)
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, TypeVar

T = TypeVar("T")


async def off_loop(fn: Callable[..., Awaitable[T]], *args: Any, **kwargs: Any) -> T:
    return await asyncio.to_thread(lambda: asyncio.run(fn(*args, **kwargs)))
