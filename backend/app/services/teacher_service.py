import uuid
import random
import string
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from google.cloud import firestore

from ..models import Teacher, TeacherCreate, ClassroomCreate, Classroom
from ..config import gcp_clients


class TeacherService:
    """Service layer for teacher and classroom management operations"""
    
    def __init__(self):
        self.collection = gcp_clients.get_firestore_client().collection('teachers_classrooms')
        self.students_collection = gcp_clients.get_firestore_client().collection('students')
    
    def _generate_hashcode(self) -> str:
        """Generate a unique 5-digit hashcode"""
        while True:
            # Generate random 5-digit number
            hashcode = ''.join(random.choices(string.digits, k=5))
            
            # Check if this hashcode already exists across all teachers
            # We need to query all teachers and check their classrooms manually
            teachers = self.collection.get()
            hashcode_exists = False
            
            for teacher_doc in teachers:
                teacher_data = teacher_doc.to_dict()
                for classroom in teacher_data.get('classrooms', []):
                    if classroom.get('hashcode') == hashcode:
                        hashcode_exists = True
                        break
                if hashcode_exists:
                    break
            
            if not hashcode_exists:
                return hashcode
    
    async def create_teacher(self, teacher_data: TeacherCreate) -> Teacher:
        """Create a new teacher with first classroom"""
        try:
            teacher_id = f"TCH_{str(uuid.uuid4())[:8].upper()}"
            classroom_id = f"CLS_{str(uuid.uuid4())[:8].upper()}"
            hashcode = self._generate_hashcode()
            now = datetime.now(timezone.utc)
            
            # Create first classroom
            classroom = Classroom(
                classroom_id=classroom_id,
                name=teacher_data.name + "'s Class",  # Default classroom name
                hashcode=hashcode,
                students=[],
                created_at=now,
                active=True
            )
            
            # Create teacher
            teacher = Teacher(
                teacher_id=teacher_id,
                name=teacher_data.name,
                school_name=teacher_data.school_name,
                date_of_training=teacher_data.date_of_training,
                session=teacher_data.session,
                classrooms=[classroom],
                created_at=now,
                active=True
            )
            
            # Convert to dict for Firestore
            teacher_dict = teacher.model_dump()
            self.collection.document(teacher_id).set(teacher_dict)
            
            return teacher
        except Exception as e:
            raise Exception(f"Failed to create teacher: {str(e)}")
    
    async def get_teacher(self, teacher_id: str) -> Optional[Teacher]:
        """Get teacher by ID"""
        try:
            doc = self.collection.document(teacher_id).get()
            if doc.exists:
                data = doc.to_dict()
                return Teacher(**data)
            return None
        except Exception as e:
            raise Exception(f"Failed to get teacher: {str(e)}")
    
    async def add_classroom(self, teacher_id: str, classroom_data: ClassroomCreate) -> Classroom:
        """Add a new classroom to an existing teacher"""
        try:
            teacher = await self.get_teacher(teacher_id)
            if not teacher:
                raise Exception("Teacher not found")
            
            classroom_id = f"CLS_{str(uuid.uuid4())[:8].upper()}"
            hashcode = self._generate_hashcode()
            now = datetime.now(timezone.utc)
            
            # Create new classroom
            new_classroom = Classroom(
                classroom_id=classroom_id,
                name=classroom_data.name,
                hashcode=hashcode,
                students=[],
                created_at=now,
                active=True
            )
            
            # Add to teacher's classrooms
            teacher.classrooms.append(new_classroom)
            
            # Update Firestore
            teacher_dict = teacher.model_dump()
            self.collection.document(teacher_id).set(teacher_dict)
            
            return new_classroom
        except Exception as e:
            raise Exception(f"Failed to add classroom: {str(e)}")
    
    async def get_classroom_by_hashcode(self, hashcode: str) -> Optional[Dict[str, Any]]:
        """Get classroom and teacher info by hashcode"""
        try:
            # Query all teachers to find the one with this hashcode
            teachers = self.collection.get()
            
            for teacher_doc in teachers:
                teacher_data = teacher_doc.to_dict()
                for classroom in teacher_data.get('classrooms', []):
                    if classroom.get('hashcode') == hashcode and classroom.get('active'):
                        return {
                            'teacher_id': teacher_data['teacher_id'],
                            'teacher_name': teacher_data['name'],
                            'classroom_id': classroom['classroom_id'],
                            'classroom_name': classroom['name'],
                            'hashcode': hashcode
                        }
            return None
        except Exception as e:
            raise Exception(f"Failed to find classroom by hashcode: {str(e)}")
    
    async def get_teacher_dashboard(self, teacher_id: str) -> dict:
        """Get comprehensive teacher dashboard with students, projects, and demo projects"""
        try:
            teacher = await self.get_teacher(teacher_id)
            if not teacher:
                raise Exception("Teacher not found")
            
            # Get demo projects for each classroom
            demo_projects_collection = gcp_clients.get_firestore_client().collection('demo_projects')
            
            dashboard_data = {
                "teacher": {
                    "teacher_id": teacher.teacher_id,
                    "name": teacher.name,
                    "school_name": teacher.school_name,
                    "date_of_training": teacher.date_of_training,
                    "session": teacher.session
                },
                "classrooms": [],
                "total_students": 0,
                "total_projects": 0,
                "total_demo_projects": 0
            }
            
            total_students = 0
            total_projects = 0
            total_demo_projects = 0
            
            for classroom in teacher.classrooms:
                # Get students in this classroom
                students_query = self.students_collection.where('classroom_id', '==', classroom.classroom_id)
                students = students_query.get()
                
                classroom_students = []
                classroom_projects = 0
                
                for student_doc in students:
                    student_data = student_doc.to_dict()
                    classroom_students.append({
                        "student_id": student_data.get('student_id'),
                        "name": student_data.get('name'),
                        "projects_count": len(student_data.get('projects', [])),
                        "accessible_demos_count": len(student_data.get('accessible_demos', []))
                    })
                    classroom_projects += len(student_data.get('projects', []))
                
                # Get demo projects for this classroom
                classroom_demos = []
                if classroom.demo_projects:
                    for demo_id in classroom.demo_projects:
                        try:
                            demo_doc = demo_projects_collection.document(demo_id).get()
                            if demo_doc.exists:
                                demo_data = demo_doc.to_dict()
                                if demo_data.get('active', True):
                                    classroom_demos.append({
                                        "demo_project_id": demo_data.get('demo_project_id'),
                                        "name": demo_data.get('name'),
                                        "description": demo_data.get('description'),
                                        "project_type": demo_data.get('project_type'),
                                        "created_at": demo_data.get('created_at')
                                    })
                        except Exception as e:
                            print(f"Error fetching demo {demo_id}: {str(e)}")
                            continue
                
                classroom_info = {
                    "classroom_id": classroom.classroom_id,
                    "name": classroom.name,
                    "hashcode": classroom.hashcode,
                    "students": classroom_students,
                    "demo_projects": classroom_demos,
                    "students_count": len(classroom_students),
                    "demo_projects_count": len(classroom_demos)
                }
                
                dashboard_data["classrooms"].append(classroom_info)
                total_students += len(classroom_students)
                total_projects += classroom_projects
                total_demo_projects += len(classroom_demos)
            
            dashboard_data["total_students"] = total_students
            dashboard_data["total_projects"] = total_projects
            dashboard_data["total_demo_projects"] = total_demo_projects
            
            return dashboard_data
            
        except Exception as e:
            raise Exception(f"Failed to get teacher dashboard: {str(e)}")
    
    async def update_teacher(self, teacher_id: str, update_data: Dict[str, Any]) -> Teacher:
        """Update teacher information"""
        try:
            teacher = await self.get_teacher(teacher_id)
            if not teacher:
                raise Exception("Teacher not found")
            
            # Update fields
            for field, value in update_data.items():
                if hasattr(teacher, field):
                    setattr(teacher, field, value)
            
            # Update Firestore
            teacher_dict = teacher.model_dump()
            self.collection.document(teacher_id).set(teacher_dict)
            
            return teacher
        except Exception as e:
            raise Exception(f"Failed to update teacher: {str(e)}")
    
    async def delete_teacher(self, teacher_id: str) -> bool:
        """Delete teacher and archive all data"""
        try:
            teacher = await self.get_teacher(teacher_id)
            if not teacher:
                raise Exception("Teacher not found")
            
            # Mark teacher as inactive instead of deleting
            teacher.active = False
            for classroom in teacher.classrooms:
                classroom.active = False
            
            # Update Firestore
            teacher_dict = teacher.model_dump()
            self.collection.document(teacher_id).set(teacher_dict)
            
            return True
        except Exception as e:
            raise Exception(f"Failed to delete teacher: {str(e)}")
