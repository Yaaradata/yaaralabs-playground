from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional

from .agent_access import agent_guard, public_agent
from ..models import (
    AgentCreateRequest, AgentCreateResponse, Agent,
    ErrorResponse, PersonaUpdateRequest, PersonaUpdateResponse, Persona,
    SettingsUpdateRequest, SettingsUpdateResponse, AgentSettings,
    AgentGuardrails, GuardrailsUpdateRequest, GuardrailsUpdateResponse,
)
from ..services.agent_service import AgentService, AgentAccessError, AgentRequestError

# every route checks that the agent belongs to the caller's session (agent_access.py)
router = APIRouter(prefix="/agent", tags=["agent"], dependencies=[Depends(agent_guard)])


def get_agent_service():
    """Dependency function for AgentService - lazy initialization"""
    # Service is lazy, so __init__ won't fail - GCP clients initialize on first use
    return AgentService()


@router.post("/create")
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
        return {"success": True, "data": public_agent(agent)}
    except AgentAccessError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except AgentRequestError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def get_agents(
    session_id: str = Query(..., min_length=1, description="The caller's session"),
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    List the agents of one session (session_id is required: listing every session's agents leaked
    their session ids, the only credential). Agents are returned without session_id / user_id.
    """
    try:
        return [public_agent(a) for a in agent_service.get_agents_by_session(session_id)]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: str,
    session_id: str = Query(..., min_length=1, description="Session ID (ownership is checked by agent_guard)"),
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


@router.get("/{agent_id}/guardrails", response_model=AgentGuardrails)
async def get_guardrails(
    agent_id: str,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Get guardrails (what the agent must never do) for an agent.
    Returns all-off defaults if nothing is saved.
    """
    try:
        agent = agent_service.get_agent(agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        return agent_service.get_guardrails(agent_id) or AgentGuardrails(agent_id=agent_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{agent_id}/guardrails", response_model=GuardrailsUpdateResponse)
async def update_guardrails(
    agent_id: str,
    request: GuardrailsUpdateRequest,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Update guardrails for an agent: four switches, "Also never" lines and the hand-off message.
    Used by chat on the next message.
    """
    try:
        agent = agent_service.get_agent(agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        updated = agent_service.update_guardrails(agent_id, request)
        return GuardrailsUpdateResponse(success=True, guardrails=updated)
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

