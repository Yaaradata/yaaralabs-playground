from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional

from ..models import Classroom, ClassroomResponse
from ..services.teacher_service import TeacherService
from ..services.student_service import StudentService

router = APIRouter(prefix="/api/classrooms", tags=["classrooms"])


# Dependency to get services
def get_teacher_service():
    return TeacherService()

def get_student_service():
    return StudentService()


@router.get("/{hashcode}")
async def get_classroom_by_hashcode(
    hashcode: str,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Get classroom information by hashcode (for student join)"""
    try:
        classroom_info = await teacher_service.get_classroom_by_hashcode(hashcode)
        if not classroom_info:
            raise HTTPException(status_code=404, detail="Classroom not found")
        
        return {
            "success": True,
            "data": classroom_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{classroom_id}/students")
async def get_classroom_students(
    classroom_id: str,
    student_service: StudentService = Depends(get_student_service)
):
    """Get all students in a specific classroom"""
    try:
        students = await student_service.get_students_by_classroom(classroom_id)
        return {
            "success": True,
            "data": students,
            "total_students": len(students)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{classroom_id}/projects")
async def get_classroom_projects(
    classroom_id: str,
    student_service: StudentService = Depends(get_student_service)
):
    """Get all projects in a specific classroom"""
    try:
        # Get all students in the classroom
        students = await student_service.get_students_by_classroom(classroom_id)
        
        # Collect all projects from all students
        all_projects = []
        for student in students:
            student_projects = await student_service.get_student_projects(student.student_id)
            for project in student_projects:
                project['student_name'] = student.name
                project['student_id'] = student.student_id
                all_projects.append(project)
        
        return {
            "success": True,
            "data": all_projects,
            "total_projects": len(all_projects),
            "total_students": len(students)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{classroom_id}")
async def update_classroom(
    classroom_id: str,
    update_data: dict,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Update classroom information (name, status)"""
    try:
        # This would need to be implemented in TeacherService
        # For now, return not implemented
        raise HTTPException(status_code=501, detail="Update classroom not implemented yet")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{classroom_id}")
async def delete_classroom(
    classroom_id: str,
    teacher_service: TeacherService = Depends(get_teacher_service)
):
    """Delete classroom and remove all students"""
    try:
        # This would need to be implemented in TeacherService
        # For now, return not implemented
        raise HTTPException(status_code=501, detail="Delete classroom not implemented yet")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
