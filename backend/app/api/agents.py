from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional

from ..models import (
    AgentCreateRequest, AgentCreateResponse, Agent,
    ErrorResponse, PersonaUpdateRequest, PersonaUpdateResponse, Persona,
    SettingsUpdateRequest, SettingsUpdateResponse, AgentSettings
)
from ..services.agent_service import AgentService

router = APIRouter(prefix="/agent", tags=["agent"])


def get_agent_service():
    """Dependency function for AgentService - lazy initialization"""
    # Service is lazy, so __init__ won't fail - GCP clients initialize on first use
    return AgentService()


@router.post("/create", response_model=AgentCreateResponse)
async def create_agent(
    request: AgentCreateRequest,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Create a new agent from a free-text description.
    
    This endpoint:
    1. Accepts a user description
    2. Uses Vertex AI to generate agent specification (name, role, tone, language)
    3. Stores agent and persona in Firestore
    """
    try:
        agent = agent_service.create_agent(request)
        return AgentCreateResponse(data=agent)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def get_agents(
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    List agents, optionally filtered by session_id.
    Returns a list of agents.
    """
    try:
        agents = agent_service.get_agents_by_session(session_id) if session_id else agent_service.get_all_agents()
        return agents
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: str,
    session_id: Optional[str] = Query(None, description="Session ID for verification"),
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Delete an agent and all associated data (persona, knowledge, rules, chat_logs).
    """
    try:
        # Verify agent exists
        agent = agent_service.get_agent(agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Optionally verify session ownership
        if session_id and agent.session_id != session_id:
            raise HTTPException(status_code=403, detail="Agent not accessible for this session")
        
        # Delete agent and cascade delete related data
        success = agent_service.delete_agent(agent_id)
        
        if success:
            return {"success": True, "message": "Agent deleted successfully", "agent_id": agent_id}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete agent")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{agent_id}/persona", response_model=Persona)
async def get_persona(
    agent_id: str,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Get persona for an agent.
    """
    try:
        persona = agent_service.get_persona(agent_id)
        if not persona:
            raise HTTPException(status_code=404, detail="Persona not found")
        return persona
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{agent_id}/persona", response_model=PersonaUpdateResponse)
async def update_persona(
    agent_id: str,
    request: PersonaUpdateRequest,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Update persona for an agent.
    
    This endpoint:
    1. Updates persona fields (name, role, tone, language, response_length, guidelines)
    2. Also updates agent name/role/tone if changed
    3. The updated persona will affect future chat responses
    """
    try:
        # Verify agent exists
        agent = agent_service.get_agent(agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Update persona
        updated_persona = agent_service.update_persona(agent_id, request)
        
        return PersonaUpdateResponse(
            success=True,
            persona=updated_persona,
            message="Persona updated successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{agent_id}/settings", response_model=AgentSettings)
async def get_settings(
    agent_id: str,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Get settings for an agent.
    Returns default settings if not found.
    """
    try:
        settings = agent_service.get_settings(agent_id)
        return settings
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{agent_id}/settings", response_model=SettingsUpdateResponse)
async def update_settings(
    agent_id: str,
    request: SettingsUpdateRequest,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Update settings for an agent.
    
    This endpoint:
    1. Updates model configuration (model, embedding_model, similarity)
    2. Creates settings if they don't exist
    3. The updated settings will affect future chat responses and knowledge base operations
    """
    try:
        # Verify agent exists
        agent = agent_service.get_agent(agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        
        # Update settings
        updated_settings = agent_service.update_settings(agent_id, request)
        
        return SettingsUpdateResponse(
            success=True,
            settings=updated_settings,
            message="Settings updated successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

