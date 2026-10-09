from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional

from ..models import (
    DemoProject, DemoProjectCreate, DemoProjectResponse,
    DemoProjectListResponse
)
from ..services.demo_project_service import DemoProjectService

router = APIRouter(prefix="/api/demo-projects", tags=["demo-projects"])

def get_demo_project_service():
    return DemoProjectService()

@router.post("/classrooms/{classroom_id}", response_model=DemoProjectResponse, status_code=201)
async def create_demo_project(
    classroom_id: str,
    demo_data: DemoProjectCreate,
    teacher_id: str,  # This would come from authentication in real app
    demo_project_service: DemoProjectService = Depends(get_demo_project_service)
):
    """Create a new demo project for a specific classroom"""
    try:
        demo_project = await demo_project_service.create_demo_project(
            teacher_id, classroom_id, demo_data
        )
        return DemoProjectResponse(data=demo_project)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{demo_project_id}", response_model=DemoProjectResponse)
async def get_demo_project(
    demo_project_id: str,
    demo_project_service: DemoProjectService = Depends(get_demo_project_service)
):
    """Get a specific demo project by ID"""
    try:
        demo_project = await demo_project_service.get_demo_project(demo_project_id)
        if not demo_project:
            raise HTTPException(status_code=404, detail="Demo project not found")
        return DemoProjectResponse(data=demo_project)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/classrooms/{classroom_id}", response_model=DemoProjectListResponse)
async def get_classroom_demos(
    classroom_id: str,
    demo_project_service: DemoProjectService = Depends(get_demo_project_service)
):
    """Get all demo projects for a specific classroom"""
    try:
        demos = await demo_project_service.get_classroom_demos(classroom_id)
        return DemoProjectListResponse(data=demos)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/students/{student_id}", response_model=DemoProjectListResponse)
async def get_student_accessible_demos(
    student_id: str,
    demo_project_service: DemoProjectService = Depends(get_demo_project_service)
):
    """Get all demo projects accessible to a specific student"""
    try:
        demos = await demo_project_service.get_student_accessible_demos(student_id)
        return DemoProjectListResponse(data=demos)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{demo_project_id}", response_model=DemoProjectResponse)
async def update_demo_project(
    demo_project_id: str,
    updates: dict,
    demo_project_service: DemoProjectService = Depends(get_demo_project_service)
):
    """Update a demo project"""
    try:
        demo_project = await demo_project_service.update_demo_project(demo_project_id, updates)
        if not demo_project:
            raise HTTPException(status_code=404, detail="Demo project not found")
        return DemoProjectResponse(data=demo_project)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{demo_project_id}")
async def delete_demo_project(
    demo_project_id: str,
    demo_project_service: DemoProjectService = Depends(get_demo_project_service)
):
    """Delete a demo project completely"""
    try:
        success = await demo_project_service.delete_demo_project(demo_project_id)
        if not success:
            raise HTTPException(status_code=404, detail="Demo project not found")
        return {"success": True, "message": "Demo project deleted successfully"}
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{demo_project_id}/archive")
async def archive_demo_project(
    demo_project_id: str,
    demo_project_service: DemoProjectService = Depends(get_demo_project_service)
):
    """Archive (deactivate) a demo project"""
    try:
        success = await demo_project_service.archive_demo_project(demo_project_id)
        if not success:
            raise HTTPException(status_code=404, detail="Demo project not found")
        return {"success": True, "message": "Demo project archived successfully"}
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
