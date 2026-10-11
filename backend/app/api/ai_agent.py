"""AI Agent projects: instructions + tools + the agent loop with a full trace.

  GET    /catalog                              tools (with source, why, example), starter tool, models, limits,
                                               NSE holidays, test prompts
  GET    /session/{sid}/projects/{pid}         state, own tool, active tools, chats, current chat, baseline, test runs
  PUT    …/state                               step, agent settings, enabled tools, guardrail
  POST   …/own-tool                            save the learner's Python (source + the schema their browser derived)
  DELETE …/own-tool                            remove it
  POST   …/chats                               start a new conversation
  POST   …/chats/{chatId}/open                 switch to a conversation
  POST   …/turns                               send a message: runs the agent loop; returns 'done', or 'waiting' with
                                               the calls the browser must run (the learner's own tool)
  POST   …/turns/{turnId}/tool-results         the browser's results; the loop continues
  GET    …/turns/{turnId}                      one message with its full trace
  POST   …/evals                               start a test run; the browser then sends each prompt as a turn
  POST   …/evals/{evalId}/finish               score the run
  GET    …/evals/{evalId}                      a run with its turns
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from ..models import (
    AgentEvalRequest,
    AgentOwnToolRequest,
    AgentResumeRequest,
    AgentStateRequest,
    AgentTurnRequest,
    ProjectType,
)
from ..services import ai_agent_service as agent
from ..services.project_service import ProjectService
from .exercises import _TRAIN_SLOTS, get_project_service, validate_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-agent", tags=["ai-agent"])
P = "/session/{session_id}/projects/{project_id}"


def get_agent_service() -> agent.AiAgentService:
    return agent.AiAgentService()


def _http(e: Exception) -> HTTPException:
    if isinstance(e, HTTPException):
        return e
    if isinstance(e, agent.AgentNotFound):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, agent.AgentModelError):
        return HTTPException(status_code=502, detail=str(e))
    if isinstance(e, (agent.AgentError, ValueError)):
        return HTTPException(status_code=400, detail=str(e))
    logger.error("AI agent request failed: %s", e, exc_info=True)
    return HTTPException(status_code=500, detail="Something went wrong. Please try again.")


async def _run(fn, *args, **kwargs):
    try:
        return {"success": True, "data": await asyncio.to_thread(fn, *args, **kwargs)}
    except Exception as e:
        raise _http(e)


class _Ctx:
    """Session check + project check, shared by every project route."""

    def __init__(self, session_id: str, project_id: str, session: dict = Depends(validate_session),
                 project_service: ProjectService = Depends(get_project_service),
                 service: agent.AiAgentService = Depends(get_agent_service)):
        self.sid, self.pid, self.project_service, self.service = session_id, project_id, project_service, service

    async def check(self):
        project = await self.project_service.get_project(self.pid)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.student_id != self.sid:
            raise HTTPException(status_code=403, detail="Project not accessible for this session")
        if project.type != ProjectType.AI_AGENT and str(project.type) != "ai-agent":
            raise HTTPException(status_code=400, detail="This endpoint is only for AI agent projects")
        return self


@router.get("/catalog")
async def catalog():
    return await _run(agent.catalog)


@router.get(P)
async def get_project(ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.view, ctx.pid, ctx.sid)


@router.put(P + "/state")
async def save_state(body: AgentStateRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.save_state, ctx.pid, ctx.sid, body.model_dump(exclude_none=True))


@router.post(P + "/own-tool")
async def save_own_tool(body: AgentOwnToolRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    fns = [{"name": f.name, "desc": f.desc, "schema": f.schema_} for f in body.functions]
    return await _run(ctx.service.save_own_tool, ctx.pid, ctx.sid, body.source, fns, body.notes)


@router.delete(P + "/own-tool")
async def remove_own_tool(ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.remove_own_tool, ctx.pid, ctx.sid)


@router.post(P + "/chats")
async def new_chat(ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.new_chat, ctx.pid, ctx.sid)


@router.post(P + "/chats/{chat_id}/open")
async def open_chat(chat_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.open_chat, ctx.pid, ctx.sid, chat_id)


@router.post(P + "/turns")
async def start_turn(body: AgentTurnRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    async with _TRAIN_SLOTS:
        return await _run(ctx.service.start_turn, ctx.pid, ctx.sid, body.message, use_tools=body.useTools, chat=body.chat,
                          eval_id=body.evalId, prompt_id=body.testPromptId)


@router.post(P + "/turns/{turn_id}/tool-results")
async def resume_turn(turn_id: str, body: AgentResumeRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    async with _TRAIN_SLOTS:
        return await _run(ctx.service.resume_turn, ctx.pid, turn_id, [r.model_dump() for r in body.results])


@router.get(P + "/turns/{turn_id}")
async def get_turn(turn_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.get_turn, ctx.pid, turn_id)


@router.post(P + "/evals")
async def start_eval(body: AgentEvalRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.start_eval, ctx.pid, ctx.sid, body.promptIds, body.useTools)


@router.post(P + "/evals/{eval_id}/finish")
async def finish_eval(eval_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.finish_eval, ctx.pid, ctx.sid, eval_id)


@router.get(P + "/evals/{eval_id}")
async def eval_detail(eval_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.eval_detail, ctx.pid, eval_id)
