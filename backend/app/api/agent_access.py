"""
Ownership check for the agent routers (/agent, /rules, /chat, /kb, /training).

The guest session id is the only credential, so every request to these routers must say which
session it is acting for, and the agent it touches must belong to that session:

  * session_id comes from the query string, or the JSON / form body          -> 400 if missing
  * the agent comes from the path or query (agent_id), the body (agent_id), or
    the item the route is keyed by (a rule, knowledge item, training message,
    pending change or training chat; each stores its agent_id)               -> 404 if unknown
  * agent.session_id must equal session_id                                    -> 403 otherwise

Used as a router dependency, so new routes on these routers are covered too. Routes that create an
agent (POST /agent/create) check the session themselves and are exempt.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request

from ..services.agent_service import AgentService

# path parameter -> Firestore collection whose documents carry agent_id
ITEM_COLLECTIONS = {
    "rule_id": "rules",
    "knowledge_id": "knowledge",
    "message_id": "training_messages",
    "change_id": "pending_changes",
    "chat_id": "training_chats",
}

# routes that do not touch an existing agent (path suffix after the router prefix)
EXEMPT = {("POST", "/agent/create")}

# fields the client never needs: the session id is the credential, the user id mirrors it
PRIVATE_AGENT_FIELDS = {"session_id", "user_id"}


def public_agent(agent: Any) -> Dict[str, Any]:
    """An agent as the API returns it: without session_id / user_id."""
    data = agent.model_dump(mode="json") if hasattr(agent, "model_dump") else dict(agent)
    for key in PRIVATE_AGENT_FIELDS:
        data.pop(key, None)
    return data


async def _body(request: Request) -> Optional[Any]:
    ctype = request.headers.get("content-type", "")
    try:
        if "application/json" in ctype:
            return await request.json()  # cached by Starlette: the route still reads it
        if "multipart/form-data" in ctype or "application/x-www-form-urlencoded" in ctype:
            return await request.form()  # cached as well
    except Exception:  # an unreadable body is the route's 422 to give, not ours
        return None
    return None


def _item_agent_id(collection: str, item_id: str) -> Optional[str]:
    from ..config import gcp_clients

    db = gcp_clients.get_firestore_client()
    snap = db.collection(collection).document(item_id).get()
    if not snap.exists:
        return None
    return (snap.to_dict() or {}).get("agent_id")


def check_owner(agent_id: str, session_id: str):
    """Load the agent and make sure it belongs to session_id (blocking: call from a thread)."""
    agent = AgentService().get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.session_id != session_id:
        raise HTTPException(status_code=403, detail="That agent belongs to another session.")
    return agent


async def agent_guard(request: Request) -> None:
    path = request.url.path.rstrip("/")
    if (request.method, path) in EXEMPT or request.method == "OPTIONS":
        return

    body = await _body(request)
    get = (lambda k: body.get(k)) if hasattr(body, "get") else (lambda k: None)

    session_id = request.query_params.get("session_id") or get("session_id")
    if not session_id or not str(session_id).strip():
        raise HTTPException(status_code=400, detail="session_id is required.")
    session_id = str(session_id)

    agent_id = request.path_params.get("agent_id") or request.query_params.get("agent_id") or get("agent_id")
    if not agent_id:
        for param, collection in ITEM_COLLECTIONS.items():
            item_id = request.path_params.get(param)
            if item_id:
                agent_id = await asyncio.to_thread(_item_agent_id, collection, item_id)
                if not agent_id:
                    raise HTTPException(status_code=404, detail="Not found")
                break
    if not agent_id:
        # a list scoped to the caller's own session (e.g. GET /agent?session_id=...)
        return

    agent = await asyncio.to_thread(check_owner, str(agent_id), session_id)
    request.state.agent = agent
