from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional

from ..models import (
    Student, StudentJoin, StudentResponse, StudentListResponse
)
from ..services.student_service import StudentService

router = APIRouter(prefix="/api/students", tags=["students"])


# Dependency to get student service
def get_student_service():
    return StudentService()


@router.post("/join", response_model=StudentResponse, status_code=201)
async def join_classroom(
    join_data: StudentJoin,
    student_service: StudentService = Depends(get_student_service)
):
    """Student joins classroom using hashcode"""
    try:
        student = await student_service.join_classroom(join_data.hashcode, join_data.name)
        return StudentResponse(data=student)
    except Exception as e:
        if "Invalid hashcode" in str(e):
            raise HTTPException(status_code=400, detail="Invalid hashcode or classroom not found")
        elif "already exists" in str(e):
            raise HTTPException(status_code=409, detail="Student with this name already exists in this classroom")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{student_id}", response_model=StudentResponse)
async def get_student(
    student_id: str,
    student_service: StudentService = Depends(get_student_service)
):
    """Get student by ID"""
    try:
        student = await student_service.get_student(student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        
        return StudentResponse(data=student)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{student_id}/projects")
async def get_student_projects(
    student_id: str,
    student_service: StudentService = Depends(get_student_service)
):
    """Get all projects for a specific student"""
    try:
        projects = await student_service.get_student_projects(student_id)
        return {
            "success": True,
            "data": projects,
            "total_projects": len(projects)
        }
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Student not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{student_id}", response_model=StudentResponse)
async def update_student(
    student_id: str,
    update_data: dict,
    student_service: StudentService = Depends(get_student_service)
):
    """Update student information"""
    try:
        student = await student_service.update_student(student_id, update_data)
        return StudentResponse(data=student)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Student not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{student_id}")
async def remove_student(
    student_id: str,
    student_service: StudentService = Depends(get_student_service)
):
    """Remove student from classroom (mark as inactive)"""
    try:
        success = await student_service.remove_student_from_classroom(student_id)
        if success:
            return {"success": True, "message": "Student removed successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to remove student")
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Student not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/classroom/{classroom_id}", response_model=StudentListResponse)
async def get_students_by_classroom(
    classroom_id: str,
    student_service: StudentService = Depends(get_student_service)
):
    """Get all students in a specific classroom"""
    try:
        students = await student_service.get_students_by_classroom(classroom_id)
        return StudentListResponse(data=students)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{student_id}/link-project/{project_id}")
async def link_project_to_student(
    student_id: str,
    project_id: str,
    student_service: StudentService = Depends(get_student_service)
):
    """Link a project to a student"""
    try:
        success = await student_service.link_project_to_student(project_id, student_id)
        if success:
            return {"success": True, "message": "Project linked to student successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to link project to student")
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Student or project not found")
        raise HTTPException(status_code=500, detail=str(e))
