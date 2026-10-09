"""
Training Chat API - Conversational Agent Training Endpoints

Provides endpoints for:
- Processing training messages
- Managing training history
- Applying/rejecting changes
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

from ..services.training_chat_service import TrainingChatService
from ..models import (
    CreateChatRequest, CreateChatResponse,
    GetChatsResponse, GetChatResponse,
    ArchiveChatRequest, ArchiveChatResponse,
    DeleteChatResponse,
    Chat
)

router = APIRouter(prefix="/training", tags=["training"])


def get_training_service():
    """Dependency function for TrainingChatService - lazy initialization"""
    # Service is lazy, so __init__ won't fail - GCP clients initialize on first use
    return TrainingChatService()


# Request/Response Models
class TrainingMessageRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    session_id: str = Field(..., description="Session ID")
    message: str = Field(..., description="User message")
    context: Optional[List[Dict[str, Any]]] = Field(None, description="Previous conversation context")
    chat_id: Optional[str] = Field(None, description="Chat ID - if provided, messages will be saved to this chat")


class TrainingMessageResponse(BaseModel):
    success: bool = True
    response: str = Field(..., description="Agent response")
    intent: str = Field(..., description="Detected intent")
    preview: Optional[Dict[str, Any]] = Field(None, description="Before/after preview")
    change_id: Optional[str] = Field(None, description="Pending change ID")
    summary: Optional[str] = Field(None, description="Change summary")
    requires_approval: bool = Field(False, description="Whether user approval is needed")
    suggestions: Optional[List[str]] = Field(None, description="Suggested next actions")
    extracted_config: Optional[Dict[str, Any]] = Field(None, description="Extracted configuration")


class ApplyChangeRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID")
    change_id: str = Field(..., description="Change ID to apply")


class ApplyChangeResponse(BaseModel):
    success: bool
    message: str
    type: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class TrainingHistoryMessage(BaseModel):
    message_id: str
    role: str
    content: str
    created_at: datetime
    metadata: Optional[Dict[str, Any]] = None


class TrainingHistoryResponse(BaseModel):
    success: bool = True
    messages: List[Dict[str, Any]]


class RestartResponse(BaseModel):
    success: bool = True
    message: str
    greeting: str


class GreetingResponse(BaseModel):
    success: bool = True
    greeting: str


@router.post("/message", response_model=TrainingMessageResponse)
async def process_training_message(
    request: TrainingMessageRequest,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Process a training message and return response with intent detection and config extraction.
    
    This endpoint:
    1. Detects the intent (persona update, knowledge add, action create, test, etc.)
    2. Extracts configuration from natural language
    3. Generates before/after preview
    4. Returns response with approval requirement if needed
    """
    try:
        # Save user message to history
        user_message_id = training_service.save_training_message(
            agent_id=request.agent_id,
            session_id=request.session_id,
            role="user",
            content=request.message
        )
        
        # If chat_id is provided, add message to chat
        if request.chat_id:
            training_service.add_message_to_chat(
                chat_id=request.chat_id,
                role="user",
                content=request.message
            )
        
        # Process the message
        result = training_service.process_training_message(
            agent_id=request.agent_id,
            session_id=request.session_id,
            message=request.message,
            context=request.context
        )
        
        # Save agent response to history
        assistant_message_id = training_service.save_training_message(
            agent_id=request.agent_id,
            session_id=request.session_id,
            role="assistant",
            content=result["response"],
            metadata={
                "intent": result.get("intent"),
                "change_id": result.get("change_id"),
                "requires_approval": result.get("requires_approval", False)
            }
        )
        
        # If chat_id is provided, add assistant message to chat
        if request.chat_id:
            training_service.add_message_to_chat(
                chat_id=request.chat_id,
                role="assistant",
                content=result["response"],
                metadata={
                    "intent": result.get("intent"),
                    "change_id": result.get("change_id"),
                    "requires_approval": result.get("requires_approval", False),
                    "preview": result.get("preview"),
                    "extracted_config": result.get("extracted_config")
                }
            )
        
        return TrainingMessageResponse(
            response=result["response"],
            intent=result.get("intent", "unknown"),
            preview=result.get("preview"),
            change_id=result.get("change_id"),
            summary=result.get("summary"),
            requires_approval=result.get("requires_approval", False),
            suggestions=result.get("suggestions"),
            extracted_config=result.get("extracted_config")
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apply", response_model=ApplyChangeResponse)
async def apply_change(
    request: ApplyChangeRequest,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Apply a pending change that was previously proposed.
    """
    try:
        result = training_service.apply_change(
            agent_id=request.agent_id,
            change_id=request.change_id
        )
        
        if result["success"]:
            return ApplyChangeResponse(
                success=True,
                message=result.get("message", "Changes applied successfully"),
                type=result.get("type"),
                details=result
            )
        else:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to apply change"))
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reject/{change_id}")
async def reject_change(
    change_id: str,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Reject a pending change.
    """
    try:
        result = training_service.reject_change(change_id)
        
        if result["success"]:
            return {"success": True, "message": "Change rejected"}
        else:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to reject change"))
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions")
async def get_training_sessions(
    agent_id: str = Query(..., description="Agent ID"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Get all training chat sessions for an agent.
    """
    try:
        sessions = training_service.get_training_sessions(agent_id)
        return {"sessions": sessions, "count": len(sessions)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history", response_model=TrainingHistoryResponse)
async def get_training_history(
    agent_id: str = Query(..., description="Agent ID"),
    session_id: str = Query(..., description="Session ID"),
    limit: int = Query(50, description="Maximum number of messages to return"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Get training conversation history.
    """
    try:
        messages = training_service.get_training_history(
            agent_id=agent_id,
            session_id=session_id,
            limit=limit
        )
        
        return TrainingHistoryResponse(messages=messages)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restart", response_model=RestartResponse)
async def restart_training(
    agent_id: str = Query(..., description="Agent ID"),
    session_id: str = Query(..., description="Session ID"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Restart training conversation (clear history and start fresh).
    """
    try:
        success = training_service.clear_training_history(
            agent_id=agent_id,
            session_id=session_id
        )
        
        if success:
            # Initialize session with greeting (saves to Firestore)
            greeting = training_service.initialize_session(agent_id, session_id)
            return RestartResponse(
                success=True,
                message="Training session restarted",
                greeting=greeting
            )
        else:
            raise HTTPException(status_code=500, detail="Failed to restart training session")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/greeting", response_model=GreetingResponse)
async def get_greeting(
    agent_id: str = Query(..., description="Agent ID"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Get initial greeting for training session.
    """
    try:
        greeting = training_service.get_initial_greeting(agent_id)
        return GreetingResponse(greeting=greeting)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/initialize")
async def initialize_session(
    agent_id: str = Query(..., description="Agent ID"),
    session_id: str = Query(..., description="Session ID"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Initialize a new training session by saving the greeting message.
    This ensures the session exists in Firestore for chat history.
    """
    try:
        greeting = training_service.initialize_session(agent_id, session_id)
        return {"success": True, "greeting": greeting}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pending/{agent_id}")
async def get_pending_changes(
    agent_id: str,
    session_id: str = Query(..., description="Session ID"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Get all pending changes for an agent.
    """
    try:
        pending = training_service.pending_changes_collection \
            .where("agent_id", "==", agent_id) \
            .where("session_id", "==", session_id) \
            .where("status", "==", "pending") \
            .stream()
        
        changes = [change.to_dict() for change in pending]
        
        return {"success": True, "pending_changes": changes}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class EditMessageRequest(BaseModel):
    content: str = Field(..., description="New message content")


@router.put("/message/{message_id}")
async def edit_message(
    message_id: str,
    request: EditMessageRequest,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Edit a training message.
    """
    try:
        success = training_service.edit_training_message(message_id, request.content)
        if success:
            return {"success": True, "message": "Message updated successfully"}
        else:
            raise HTTPException(status_code=404, detail="Message not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/message/{message_id}")
async def delete_message(
    message_id: str,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Delete a training message.
    """
    try:
        success = training_service.delete_training_message(message_id)
        if success:
            return {"success": True, "message": "Message deleted successfully"}
        else:
            raise HTTPException(status_code=404, detail="Message not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/history/clear")
async def clear_history(
    agent_id: str = Query(..., description="Agent ID"),
    session_id: str = Query(..., description="Session ID"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Clear all training history without restarting (keeps no greeting).
    """
    try:
        success = training_service.clear_training_history(agent_id, session_id)
        if success:
            return {"success": True, "message": "Chat history cleared"}
        else:
            raise HTTPException(status_code=500, detail="Failed to clear history")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Chat Management Endpoints (Playground AI-like) ====================

@router.post("/chats", response_model=CreateChatResponse)
async def create_chat(
    request: CreateChatRequest,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Create a new chat session.
    If there's an active chat, it will be archived first.
    """
    try:
        chat_data = training_service.create_chat(
            agent_id=request.agent_id,
            session_id=request.session_id
        )
        
        # Convert to Chat model
        chat = Chat(**chat_data)
        return CreateChatResponse(chat=chat)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chats", response_model=GetChatsResponse)
async def get_chats(
    agent_id: str = Query(..., description="Agent ID"),
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Get all chats for an agent, including the ongoing chat.
    Returns archived chats and the currently active chat.
    """
    try:
        result = training_service.get_chats(agent_id)
        
        # Convert to Chat models
        chats = [Chat(**chat) for chat in result["chats"]]
        ongoing_chat = Chat(**result["ongoing_chat"]) if result["ongoing_chat"] else None
        
        return GetChatsResponse(chats=chats, ongoing_chat=ongoing_chat)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/chats/{chat_id}", response_model=GetChatResponse)
async def get_chat(
    chat_id: str,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Get a specific chat by ID with all its messages.
    """
    try:
        chat_data = training_service.get_chat_by_id(chat_id)
        
        if not chat_data:
            raise HTTPException(status_code=404, detail="Chat not found")
        
        # Convert to Chat model
        chat = Chat(**chat_data)
        return GetChatResponse(chat=chat)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chats/{chat_id}/archive", response_model=ArchiveChatResponse)
async def archive_chat(
    chat_id: str,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Archive a chat (mark as inactive).
    This is typically called when creating a new chat or resetting.
    """
    try:
        success = training_service.archive_chat(chat_id)
        
        if success:
            return ArchiveChatResponse()
        else:
            raise HTTPException(status_code=500, detail="Failed to archive chat")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/chats/{chat_id}", response_model=DeleteChatResponse)
async def delete_chat(
    chat_id: str,
    training_service: TrainingChatService = Depends(get_training_service)
):
    """
    Delete a chat and all its messages.
    """
    try:
        success = training_service.delete_chat(chat_id)
        
        if success:
            return DeleteChatResponse()
        else:
            raise HTTPException(status_code=500, detail="Failed to delete chat")
            
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

