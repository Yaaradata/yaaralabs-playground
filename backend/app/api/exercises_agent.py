"""Exercise 13 — agent-with-a-tool HTTP routes."""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..services import exercises_agent_service as agent

logger = logging.getLogger(__name__)


class ToolDef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., min_length=1, max_length=64)
    desc: str = Field(default="", max_length=2000)
    description: Optional[str] = Field(default=None, max_length=2000)
    tool_schema: Dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})

    @model_validator(mode="before")
    @classmethod
    def pull_schema(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        raw = data.get("tool_schema")
        if raw is None:
            raw = data.get("schema")
        if raw is None:
            raw = data.get("input_schema")
        if raw is None:
            raw = {"type": "object", "properties": {}}
        out = dict(data)
        out["tool_schema"] = raw
        return out


class AgentMessage(BaseModel):
    role: str = Field(..., min_length=1, max_length=16)
    text: Optional[str] = Field(default=None, max_length=8000)
    content: Optional[str] = Field(default=None, max_length=8000)
    calls: Optional[List[Dict[str, Any]]] = None
    id: Optional[str] = Field(default=None, max_length=64)
    callId: Optional[str] = Field(default=None, max_length=64)
    name: Optional[str] = Field(default=None, max_length=64)
    output: Optional[str] = Field(default=None, max_length=8000)
    error: Optional[str] = Field(default=None, max_length=4000)


class AgentStepBody(BaseModel):
    system: str = Field(default="", max_length=8000)
    messages: List[AgentMessage] = Field(..., min_length=1, max_length=60)
    tools: List[ToolDef] = Field(default_factory=list, max_length=12)
    model: Optional[str] = Field(default="gemini-38-flash", max_length=64)
    temp: float = Field(default=0.2, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=800, ge=100, le=2000)
    final: bool = False
    nonce: int = Field(default=0, ge=0, le=1_000_000)


def register_agent_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/agent/catalog")
    async def agent_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return agent.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/agent/step")
    async def agent_step(
        session_id: str,
        project_id: str,
        body: AgentStepBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            tools = [
                {
                    "name": t.name,
                    "desc": t.desc or t.description or "",
                    "schema": t.tool_schema or {"type": "object", "properties": {}},
                }
                for t in body.tools
            ]
            return agent.step(
                system=body.system,
                messages=[m.model_dump(exclude_none=True) for m in body.messages],
                tools=tools,
                model=body.model or "gemini-38-flash",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
                final=body.final,
                nonce=body.nonce,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 13 agent step failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
