import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from google.cloud import firestore

from ..models import DemoProject, DemoProjectCreate
from ..config import gcp_clients


class DemoProjectService:
    """Service layer for demo project management operations"""
    
    def __init__(self):
        self.collection = gcp_clients.get_firestore_client().collection('demo_projects')
        self.teachers_collection = gcp_clients.get_firestore_client().collection('teachers_classrooms')
        self.students_collection = gcp_clients.get_firestore_client().collection('students')
    
    async def create_demo_project(self, teacher_id: str, classroom_id: str, demo_data: DemoProjectCreate) -> DemoProject:
        """Create a new demo project and link it to a classroom"""
        try:
            # Generate unique demo project ID
            demo_project_id = f"DEMO_{uuid.uuid4().hex[:8].upper()}"
            
            # Create demo project document
            demo_project = DemoProject(
                demo_project_id=demo_project_id,
                name=demo_data.name,
                description=demo_data.description,
                teacher_id=teacher_id,
                classroom_id=classroom_id,
                project_type=demo_data.project_type,
                dataset_info=demo_data.dataset_info,
                model_info=demo_data.model_info
            )
            
            # Save to demo_projects collection
            self.collection.document(demo_project_id).set(demo_project.model_dump())
            
            # Add demo project ID to classroom's demo_projects array
            await self._add_demo_to_classroom(teacher_id, classroom_id, demo_project_id)
            
            # Update all students in the classroom to have access to this demo
            await self._update_students_access(classroom_id, demo_project_id)
            
            return demo_project
            
        except Exception as e:
            raise Exception(f"Failed to create demo project: {str(e)}")
    
    async def _add_demo_to_classroom(self, teacher_id: str, classroom_id: str, demo_project_id: str):
        """Add demo project ID to classroom's demo_projects array"""
        try:
            # Find the teacher document and update the specific classroom
            teacher_doc = self.teachers_collection.document(teacher_id).get()
            if not teacher_doc.exists:
                raise Exception("Teacher not found")
            
            teacher_data = teacher_doc.to_dict()
            
            # Find the classroom and add demo project ID
            for classroom in teacher_data.get('classrooms', []):
                if classroom['classroom_id'] == classroom_id:
                    if 'demo_projects' not in classroom:
                        classroom['demo_projects'] = []
                    if demo_project_id not in classroom['demo_projects']:
                        classroom['demo_projects'].append(demo_project_id)
                    break
            
            # Update the teacher document
            self.teachers_collection.document(teacher_id).set(teacher_data)
            
        except Exception as e:
            raise Exception(f"Failed to add demo to classroom: {str(e)}")
    
    async def _update_students_access(self, classroom_id: str, demo_project_id: str):
        """Update all students in the classroom to have access to the new demo"""
        try:
            # Find all students in this classroom
            students_query = self.students_collection.where('classroom_id', '==', classroom_id)
            students = students_query.get()
            
            # Update each student's accessible_demos array
            for student_doc in students:
                student_data = student_doc.to_dict()
                if 'accessible_demos' not in student_data:
                    student_data['accessible_demos'] = []
                
                if demo_project_id not in student_data['accessible_demos']:
                    student_data['accessible_demos'].append(demo_project_id)
                
                self.students_collection.document(student_doc.id).set(student_data)
                
        except Exception as e:
            raise Exception(f"Failed to update students access: {str(e)}")
    
    async def get_demo_project(self, demo_project_id: str) -> Optional[DemoProject]:
        """Get a demo project by ID"""
        try:
            doc = self.collection.document(demo_project_id).get()
            if doc.exists:
                return DemoProject(**doc.to_dict())
            return None
        except Exception as e:
            raise Exception(f"Failed to get demo project: {str(e)}")
    
    async def get_classroom_demos(self, classroom_id: str) -> List[DemoProject]:
        """Get all demo projects for a specific classroom"""
        try:
            query = self.collection.where('classroom_id', '==', classroom_id).where('active', '==', True)
            docs = query.get()
            
            demos = []
            for doc in docs:
                demos.append(DemoProject(**doc.to_dict()))
            
            return demos
        except Exception as e:
            raise Exception(f"Failed to get classroom demos: {str(e)}")
    
    async def get_student_accessible_demos(self, student_id: str) -> List[DemoProject]:
        """Get all demo projects a student can access"""
        try:
            # Get student document to find accessible_demos
            student_doc = self.students_collection.document(student_id).get()
            if not student_doc.exists:
                return []
            
            student_data = student_doc.to_dict()
            accessible_demo_ids = student_data.get('accessible_demos', [])
            
            if not accessible_demo_ids:
                return []
            
            # Fetch all accessible demo projects
            demos = []
            for demo_id in accessible_demo_ids:
                demo = await self.get_demo_project(demo_id)
                if demo and demo.active:
                    demos.append(demo)
            
            return demos
        except Exception as e:
            raise Exception(f"Failed to get student accessible demos: {str(e)}")
    
    async def update_demo_project(self, demo_project_id: str, updates: Dict[str, Any]) -> Optional[DemoProject]:
        """Update a demo project"""
        try:
            # Get current demo project
            current_demo = await self.get_demo_project(demo_project_id)
            if not current_demo:
                return None
            
            # Update fields
            for field, value in updates.items():
                if hasattr(current_demo, field):
                    setattr(current_demo, field, value)
            
            # Save updated demo project
            self.collection.document(demo_project_id).set(current_demo.model_dump())
            
            return current_demo
        except Exception as e:
            raise Exception(f"Failed to update demo project: {str(e)}")
    
    async def archive_demo_project(self, demo_project_id: str) -> bool:
        """Archive (deactivate) a demo project"""
        try:
            self.collection.document(demo_project_id).update({'active': False})
            return True
        except Exception as e:
            raise Exception(f"Failed to archive demo project: {str(e)}")
    
    async def delete_demo_project(self, demo_project_id: str) -> bool:
        """Delete a demo project completely"""
        try:
            # Get demo project to find classroom
            demo = await self.get_demo_project(demo_project_id)
            if not demo:
                return False
            
            # Remove from classroom's demo_projects array
            await self._remove_demo_from_classroom(demo.teacher_id, demo.classroom_id, demo_project_id)
            
            # Remove from all students' accessible_demos arrays
            await self._remove_demo_from_students(demo.classroom_id, demo_project_id)
            
            # Delete the demo project document
            self.collection.document(demo_project_id).delete()
            
            return True
        except Exception as e:
            raise Exception(f"Failed to delete demo project: {str(e)}")
    
    async def _remove_demo_from_classroom(self, teacher_id: str, classroom_id: str, demo_project_id: str):
        """Remove demo project ID from classroom's demo_projects array"""
        try:
            teacher_doc = self.teachers_collection.document(teacher_id).get()
            if not teacher_doc.exists:
                return
            
            teacher_data = teacher_doc.to_dict()
            
            # Find the classroom and remove demo project ID
            for classroom in teacher_data.get('classrooms', []):
                if classroom['classroom_id'] == classroom_id:
                    if 'demo_projects' in classroom:
                        classroom['demo_projects'] = [d for d in classroom['demo_projects'] if d != demo_project_id]
                    break
            
            # Update the teacher document
            self.teachers_collection.document(teacher_id).set(teacher_data)
            
        except Exception as e:
            raise Exception(f"Failed to remove demo from classroom: {str(e)}")
    
    async def _remove_demo_from_students(self, classroom_id: str, demo_project_id: str):
        """Remove demo project ID from all students' accessible_demos arrays"""
        try:
            students_query = self.students_collection.where('classroom_id', '==', classroom_id)
            students = students_query.get()
            
            for student_doc in students:
                student_data = student_doc.to_dict()
                if 'accessible_demos' in student_data:
                    student_data['accessible_demos'] = [d for d in student_data['accessible_demos'] if d != demo_project_id]
                    self.students_collection.document(student_doc.id).set(student_data)
                    
        except Exception as e:
            raise Exception(f"Failed to remove demo from students: {str(e)}")
