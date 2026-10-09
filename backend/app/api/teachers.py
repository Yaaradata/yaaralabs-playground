from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional

from ..models import (
    Teacher, TeacherCreate, ClassroomCreate, TeacherResponse, 
    TeacherListResponse, ClassroomResponse, TeacherDashboardResponse
)
from ..services.teacher_service import TeacherService

router = APIRouter(prefix="/api/teachers", tags=["teachers"])


# Dependency to get teacher service
def get_teacher_service():
    return TeacherService()


@router.post("/register", response_model=TeacherResponse, status_code=201)
async def register_teacher(
    teacher_data: TeacherCreate,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Register a new teacher and create first classroom"""
    try:
        teacher = await teacher_service.create_teacher(teacher_data)
        return TeacherResponse(data=teacher)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{teacher_id}", response_model=TeacherResponse)
async def get_teacher(
    teacher_id: str,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Get teacher by ID with all classrooms"""
    try:
        teacher = await teacher_service.get_teacher(teacher_id)
        if not teacher:
            raise HTTPException(status_code=404, detail="Teacher not found")
        
        return TeacherResponse(data=teacher)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{teacher_id}/classrooms", response_model=ClassroomResponse, status_code=201)
async def add_classroom(
    teacher_id: str,
    classroom_data: ClassroomCreate,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Add a new classroom to an existing teacher"""
    try:
        classroom = await teacher_service.add_classroom(teacher_id, classroom_data)
        return ClassroomResponse(data=classroom)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Teacher not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{teacher_id}/dashboard", response_model=TeacherDashboardResponse)
async def get_teacher_dashboard(
    teacher_id: str,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Get teacher dashboard with student and project statistics"""
    try:
        dashboard_data = await teacher_service.get_teacher_dashboard(teacher_id)
        return TeacherDashboardResponse(data=dashboard_data)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Teacher not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{teacher_id}", response_model=TeacherResponse)
async def update_teacher(
    teacher_id: str,
    update_data: dict,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Update teacher information"""
    try:
        teacher = await teacher_service.update_teacher(teacher_id, update_data)
        return TeacherResponse(data=teacher)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Teacher not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{teacher_id}")
async def delete_teacher(
    teacher_id: str,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Delete teacher and archive all data"""
    try:
        success = await teacher_service.delete_teacher(teacher_id)
        if success:
            return {"success": True, "message": "Teacher deleted successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete teacher")
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Teacher not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=TeacherListResponse)
async def get_all_teachers(
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Get all active teachers"""
    try:
        # This would need to be implemented in TeacherService
        # For now, return empty list
        return TeacherListResponse(data=[])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
