from fastapi import APIRouter, HTTPException, Depends

from ..models import CleanupRequest, CleanupResponse, ErrorResponse
from ..services.agent_service import AgentService

router = APIRouter(prefix="/internal", tags=["agent"])


def get_agent_service():
    """Dependency function for AgentService - lazy initialization"""
    try:
        return AgentService()
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"AgentService initialization deferred: {e}")
        return AgentService()


@router.post("/cleanup", response_model=CleanupResponse)
async def cleanup_old_agents(
    request: CleanupRequest,
    agent_service: AgentService = Depends(get_agent_service)
):
    """
    Cleanup old agents (called by Cloud Scheduler).
    
    This endpoint:
    1. Deletes agents older than N days
    2. Cascade deletes: persona, knowledge, rules, chat_logs
    """
    try:
        deleted_count = agent_service.cleanup_old_agents(request.days_old)
        return CleanupResponse(
            deleted_count=deleted_count,
            message=f"Cleaned up {deleted_count} old agents"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

