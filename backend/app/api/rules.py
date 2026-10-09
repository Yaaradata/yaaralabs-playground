from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List
from pydantic import BaseModel

from ..models import (
    RuleSaveRequest, RuleResponse, RuleListResponse,
    ErrorResponse
)
from ..services.rules_service import RulesService

router = APIRouter(prefix="/rules", tags=["agent"])


class RuleStatusUpdate(BaseModel):
    active: bool


def get_rules_service():
    """Dependency function for RulesService - lazy initialization"""
    # Service is lazy, so __init__ won't fail - GCP clients initialize on first use
    return RulesService()


@router.post("/save", response_model=RuleResponse)
async def save_rule(
    request: RuleSaveRequest,
    rules_service: RulesService = Depends(get_rules_service)
):
    """
    Create or update a rule.
    
    This endpoint:
    1. Validates WHEN condition
    2. Validates DO action
    3. Stores rule as deterministic config
    """
    try:
        rule = rules_service.save_rule(request)
        return RuleResponse(data=rule)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=RuleListResponse)
async def get_rules(
    agent_id: str = Query(..., description="Agent ID"),
    rules_service: RulesService = Depends(get_rules_service)
):
    """
    List all rules for an agent.
    
    Used to reload rule configuration in UI.
    """
    try:
        rules = rules_service.get_rules(agent_id)
        return RuleListResponse(data=rules)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: str,
    rules_service: RulesService = Depends(get_rules_service)
):
    """
    Delete a rule by ID.
    """
    try:
        success = rules_service.delete_rule(rule_id)
        return {"success": success, "message": f"Rule {rule_id} deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{rule_id}/status")
async def update_rule_status(
    rule_id: str,
    status_update: RuleStatusUpdate,
    rules_service: RulesService = Depends(get_rules_service)
):
    """
    Enable or disable a rule.
    """
    try:
        success = rules_service.update_rule_status(rule_id, status_update.active)
        status = "enabled" if status_update.active else "disabled"
        return {"success": success, "message": f"Rule {rule_id} {status}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

