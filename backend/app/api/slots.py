"""
How many requests of one kind may run at once, per feature (docs/hardening.md, item 5).

One shared semaphore of 3 used to serve AI-agent turns, RAG index and eval, confusion-matrix and
exercises training, so with 30 people the 4th agent turn waited behind three trainings. Model calls
are I/O-bound and can run many at a time; CPU training can't. A request that can't get a slot within
`wait` seconds gets 503 "Busy, please try again in a moment." instead of a spinner that never ends.

    async with AGENT_TURNS():
        ...
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Dict

from fastapi import HTTPException

BUSY = "Busy, please try again in a moment."


class Slots:
    def __init__(self, name: str, size: int, wait: float = 90.0):
        self.name, self.size, self.wait = name, size, wait
        self._sems: Dict[int, asyncio.Semaphore] = {}  # one per event loop (tests start several)

    def _sem(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        sem = self._sems.get(id(loop))
        if sem is None:
            sem = self._sems[id(loop)] = asyncio.Semaphore(self.size)
        return sem

    @asynccontextmanager
    async def __call__(self):
        sem = self._sem()
        try:
            await asyncio.wait_for(sem.acquire(), timeout=self.wait)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=503, detail=BUSY)
        try:
            yield
        finally:
            sem.release()


AGENT_TURNS = Slots("agent turns", 16)  # AI Agent turns and resumes: model calls (I/O-bound)
RAG_WORK = Slots("rag index and eval", 8)  # embeddings + several model calls per request
CPU_TRAINING = Slots("cpu training", 3)  # confusion matrix, exercises TF-IDF: CPU-bound on 4 vCPUs
