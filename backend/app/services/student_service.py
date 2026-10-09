import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from google.cloud import firestore

from ..models import Student, StudentJoin
from ..config import gcp_clients


class StudentService:
    """Service layer for student management operations"""
    
    def __init__(self):
        self.collection = gcp_clients.get_firestore_client().collection('students')
        self.teachers_collection = gcp_clients.get_firestore_client().collection('teachers_classrooms')
        self.projects_collection = gcp_clients.get_firestore_client().collection('projects')
    
    async def join_classroom(self, hashcode: str, student_name: str) -> Student:
        """Student joins classroom using hashcode"""
        try:
            # Find classroom by hashcode
            classroom_info = await self._find_classroom_by_hashcode(hashcode)
            if not classroom_info:
                raise Exception("Invalid hashcode or classroom not found")
            
            teacher_id = classroom_info['teacher_id']
            classroom_id = classroom_info['classroom_id']
            
            # Check if student already exists in this classroom
            existing_student = await self._find_student_by_name_and_classroom(student_name, classroom_id)
            if existing_student:
                raise Exception(f"Student with name '{student_name}' already exists in this classroom")
            
            # Create new student
            student_id = f"STU_{uuid.uuid4().hex[:8].upper()}"
            student = Student(
                student_id=student_id,
                name=student_name,
                teacher_id=teacher_id,
                classroom_id=classroom_id,
                hashcode=hashcode,
                accessible_demos=classroom_info.get('demo_projects', [])  # Copy demo projects from classroom
            )
            
            # Save student to database
            self.collection.document(student_id).set(student.model_dump())
            
            # Add student to classroom's students array
            await self._add_student_to_classroom(teacher_id, classroom_id, student_id)
            
            return student
            
        except Exception as e:
            raise Exception(f"Failed to join classroom: {str(e)}")
    
    async def _find_classroom_by_hashcode(self, hashcode: str) -> Optional[Dict[str, Any]]:
        """Find classroom information by hashcode"""
        try:
            # Query all teachers to find the one with this hashcode
            teachers = self.teachers_collection.get()
            
            for teacher_doc in teachers:
                teacher_data = teacher_doc.to_dict()
                for classroom in teacher_data.get('classrooms', []):
                    if classroom.get('hashcode') == hashcode and classroom.get('active'):
                        return {
                            'teacher_id': teacher_data['teacher_id'],
                            'teacher_name': teacher_data['name'],
                            'classroom_id': classroom['classroom_id'],
                            'classroom_name': classroom['name'],
                            'hashcode': hashcode,
                            'demo_projects': classroom.get('demo_projects', [])  # Include demo projects
                        }
            return None
        except Exception as e:
            raise Exception(f"Failed to find classroom by hashcode: {str(e)}")
    
    async def _find_student_by_name_and_classroom(self, student_name: str, classroom_id: str) -> Optional[Student]:
        """Find existing student by name in specific classroom"""
        try:
            query = self.collection.where('name', '==', student_name).where('classroom_id', '==', classroom_id)
            docs = query.limit(1).get()
            
            for doc in docs:
                data = doc.to_dict()
                return Student(**data)
            return None
        except Exception as e:
            raise Exception(f"Failed to find student: {str(e)}")
    
    async def _add_student_to_classroom(self, teacher_id: str, classroom_id: str, student_id: str):
        """Add student ID to classroom's students array"""
        try:
            # Get teacher document
            teacher_doc = self.teachers_collection.document(teacher_id).get()
            if not teacher_doc.exists:
                raise Exception("Teacher not found")
            
            teacher_data = teacher_doc.to_dict()
            
            # Find the classroom and add student ID
            for classroom in teacher_data.get('classrooms', []):
                if classroom['classroom_id'] == classroom_id:
                    if student_id not in classroom['students']:
                        classroom['students'].append(student_id)
                    break
            
            # Update the teacher document
            self.teachers_collection.document(teacher_id).set(teacher_data)
            
        except Exception as e:
            raise Exception(f"Failed to add student to classroom: {str(e)}")
    
    async def get_student(self, student_id: str) -> Optional[Student]:
        """Get student by ID"""
        try:
            doc = self.collection.document(student_id).get()
            if doc.exists:
                data = doc.to_dict()
                return Student(**data)
            return None
        except Exception as e:
            raise Exception(f"Failed to get student: {str(e)}")
    
    async def get_student_projects(self, student_id: str) -> List[Dict[str, Any]]:
        """Get all projects for a specific student"""
        try:
            student = await self.get_student(student_id)
            if not student:
                raise Exception("Student not found")
            
            # Get projects from projects collection
            projects_query = self.projects_collection.where('createdBy', '==', student_id)
            project_docs = projects_query.get()
            
            projects = []
            for doc in project_docs:
                project_data = doc.to_dict()
                projects.append({
                    'project_id': project_data.get('id'),
                    'project_name': project_data.get('name'),
                    'data_uploaded': project_data.get('dataset', {}).get('records', 0),
                    'model_trained': project_data.get('status') == 'trained',
                    'tests_done': 0,  # TODO: Implement test tracking
                    'scratch_linked': False,  # TODO: Implement Scratch linking tracking
                    'created_at': project_data.get('createdAt'),
                    'status': project_data.get('status')
                })
            
            return projects
        except Exception as e:
            raise Exception(f"Failed to get student projects: {str(e)}")
    
    async def get_students_by_classroom(self, classroom_id: str) -> List[Student]:
        """Get all students in a specific classroom"""
        try:
            query = self.collection.where('classroom_id', '==', classroom_id).where('active', '==', True)
            docs = query.get()
            
            students = []
            for doc in docs:
                data = doc.to_dict()
                students.append(Student(**data))
            
            return students
        except Exception as e:
            raise Exception(f"Failed to get students by classroom: {str(e)}")

    async def update_student(self, student_id: str, update_data: Dict[str, Any]) -> Student:
        """Update student information"""
        try:
            student = await self.get_student(student_id)
            if not student:
                raise Exception("Student not found")
            
            # Update fields
            for field, value in update_data.items():
                if hasattr(student, field):
                    setattr(student, field, value)
            
            # Update Firestore
            student_dict = student.model_dump()
            self.collection.document(student_id).set(student_dict)
            
            return student
        except Exception as e:
            raise Exception(f"Failed to update student: {str(e)}")

    async def remove_student_from_classroom(self, student_id: str) -> bool:
        """Remove student from classroom and delete student record"""
        try:
            # Get student to find classroom
            student = await self.get_student(student_id)
            if not student:
                return False
            
            # Remove from classroom's students array
            await self._remove_student_from_classroom(student.teacher_id, student.classroom_id, student_id)
            
            # Delete student document
            self.collection.document(student_id).delete()
            
            return True
        except Exception as e:
            raise Exception(f"Failed to remove student: {str(e)}")

    async def _remove_student_from_classroom(self, teacher_id: str, classroom_id: str, student_id: str):
        """Remove student ID from classroom's students array"""
        try:
            teacher_doc = self.teachers_collection.document(teacher_id).get()
            if not teacher_doc.exists:
                return
            
            teacher_data = teacher_doc.to_dict()
            
            # Find the classroom and remove student ID
            for classroom in teacher_data.get('classrooms', []):
                if classroom['classroom_id'] == classroom_id:
                    if student_id in classroom['students']:
                        classroom['students'].remove(student_id)
                    break
            
            # Update the teacher document
            self.teachers_collection.document(teacher_id).set(teacher_data)
            
        except Exception as e:
            # Log error but don't fail the main operation
            print(f"Warning: Failed to remove student from classroom: {str(e)}")

    async def link_project_to_student(self, project_id: str, student_id: str) -> bool:
        """Link a project to a student"""
        try:
            # Get student document
            student_doc = self.collection.document(student_id).get()
            if not student_doc.exists:
                return False
            
            student_data = student_doc.to_dict()
            
            # Add project info to student's projects array
            if 'projects' not in student_data:
                student_data['projects'] = []
            
            # Check if project is already linked
            project_exists = any(p.get('project_id') == project_id for p in student_data['projects'])
            
            if not project_exists:
                # Add project info as a dictionary
                project_info = {
                    'project_id': project_id,
                    'linked_at': datetime.now(timezone.utc).isoformat(),
                    'status': 'linked'
                }
                student_data['projects'].append(project_info)
                
                # Update student document
                self.collection.document(student_id).set(student_data)
                return True
            
            return True  # Project already linked
            
        except Exception as e:
            print(f"Warning: Failed to link project to student: {str(e)}")
            return False

    async def get_student_demos(self, student_id: str) -> List[dict]:
        """Get all demo projects accessible to a student"""
        try:
            student = await self.get_student(student_id)
            if not student:
                return []
            
            # Get demo projects from demo_projects collection
            demo_projects_collection = gcp_clients.get_firestore_client().collection('demo_projects')
            
            demos = []
            for demo_id in student.accessible_demos:
                try:
                    demo_doc = demo_projects_collection.document(demo_id).get()
                    if demo_doc.exists:
                        demo_data = demo_doc.to_dict()
                        if demo_data.get('active', True):  # Only active demos
                            demos.append(demo_data)
                except Exception as e:
                    print(f"Error fetching demo {demo_id}: {str(e)}")
                    continue
            
            return demos
            
        except Exception as e:
            raise Exception(f"Failed to get student demos: {str(e)}")
