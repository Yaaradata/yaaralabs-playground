from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List

from ..models import (
    ChatRequest, ChatResponse, ChatTeachRequest, ChatTeachResponse,
    ErrorResponse
)
from ..services.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["agent"])


def get_chat_service():
    """Dependency function for ChatService - lazy initialization"""
    # Service is lazy, so __init__ won't fail - GCP clients initialize on first use
    return ChatService()


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    chat_service: ChatService = Depends(get_chat_service)
):
    """
    Chat with an agent (CORE endpoint).
    
    This endpoint:
    1. Loads agent + persona + rules
    2. Detects conditions (keyword, intent, sentiment)
    3. Evaluates rules
    4. If rule matched: executes DO action (possibly skips LLM)
    5. Else: embeds message, retrieves KB, builds prompt, calls Vertex AI
    6. Logs full trace
    """
    try:
        result = chat_service.chat(request)
        return ChatResponse(
            response=result["response"],
            trace=result["trace"],
            images=result.get("images", []),
            chat_id=result.get("chat_id")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/teach", response_model=ChatTeachResponse)
async def teach_agent(
    request: ChatTeachRequest,
    chat_service: ChatService = Depends(get_chat_service)
):
    """
    Teach agent from approved chat response.
    
    This endpoint:
    1. Takes approved response
    2. Converts into TEXT KB
    3. Generates embedding
    4. Stores in knowledge base
    """
    try:
        knowledge_id = chat_service.teach_from_chat(
            request.agent_id,
            request.chat_id,
            request.approved_response
        )
        return ChatTeachResponse(
            knowledge_id=knowledge_id,
            message="Agent taught successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_chat_history(
    agent_id: str = Query(..., description="Agent ID"),
    session_id: str = Query(..., description="Session ID"),
    limit: int = Query(50, description="Maximum number of messages to return"),
    chat_service: ChatService = Depends(get_chat_service)
):
    """
    Get chat history for a specific agent and session.
    
    Returns chat messages in chronological order.
    """
    try:
        messages = chat_service.get_chat_history(agent_id, session_id, limit)
        return {
            "messages": messages,
            "count": len(messages)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get chat history: {str(e)}")


@router.delete("/history")
async def clear_chat_history(
    agent_id: str = Query(..., description="Agent ID"),
    session_id: str = Query(..., description="Session ID"),
    chat_service: ChatService = Depends(get_chat_service)
):
    """
    Clear chat history for a specific agent and session.
    
    Deletes all chat logs for the given agent/session combination.
    """
    try:
        deleted_count = chat_service.clear_chat_history(agent_id, session_id)
        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Successfully cleared {deleted_count} chat messages"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear chat history: {str(e)}")

