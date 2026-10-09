#!/usr/bin/env python3
"""
Test Demo Projects System
This script demonstrates the complete demo project workflow:
1. Teacher creates demo project
2. Demo project linked to classroom
3. Students can access demo projects
4. Demo project management
"""

import asyncio
import json
from datetime import datetime
from typing import Dict, Any

# Import our services
from app.services.teacher_service import TeacherService
from app.services.student_service import StudentService
from app.services.demo_project_service import DemoProjectService
from app.models import TeacherCreate, ClassroomCreate, StudentJoin, DemoProjectCreate


class DemoProjectTester:
    """Test class for the demo project system"""
    
    def __init__(self):
        self.teacher_service = TeacherService()
        self.student_service = StudentService()
        self.demo_project_service = DemoProjectService()
        self.test_results = {}
    
    async def test_teacher_registration(self) -> Dict[str, Any]:
        """Test teacher registration and first classroom creation"""
        print("Testing Teacher Registration...")
        print("=" * 50)
        
        try:
            # Create teacher data
            teacher_data = TeacherCreate(
                name="Demo Teacher",
                school_name="Demo Academy",
                date_of_training="2025-08-14",
                session="forenoon"
            )
            
            # Register teacher
            teacher = await self.teacher_service.create_teacher(teacher_data)
            
            print(f"Teacher created successfully!")
            print(f"   Teacher ID: {teacher.teacher_id}")
            print(f"   Name: {teacher.name}")
            print(f"   School: {teacher.school_name}")
            print(f"   First Classroom: {teacher.classrooms[0].name}")
            print(f"   Hashcode: {teacher.classrooms[0].hashcode}")
            
            self.test_results['teacher'] = teacher
            return teacher
            
        except Exception as e:
            print(f"Teacher registration failed: {str(e)}")
            raise
    
    async def test_add_classroom(self, teacher_id: str) -> Dict[str, Any]:
        """Test adding a second classroom to the teacher"""
        print("\nTesting Classroom Addition...")
        print("=" * 50)
        
        try:
            # Create classroom data
            classroom_data = ClassroomCreate(
                name="Class 9B"
            )
            
            # Add classroom
            classroom = await self.teacher_service.add_classroom(teacher_id, classroom_data)
            
            print(f"Classroom added successfully!")
            print(f"   Classroom ID: {classroom.classroom_id}")
            print(f"   Name: {classroom.name}")
            print(f"   Hashcode: {classroom.hashcode}")
            
            self.test_results['second_classroom'] = classroom
            return classroom
            
        except Exception as e:
            print(f"Classroom addition failed: {str(e)}")
            raise
    
    async def test_create_demo_project(self, teacher_id: str, classroom_id: str) -> Dict[str, Any]:
        """Test creating a demo project"""
        print(f"\nTesting Demo Project Creation...")
        print("=" * 50)
        
        try:
            # Create demo project data
            demo_data = DemoProjectCreate(
                name="Cat vs Dog Image Classifier",
                description="A simple image classification model to distinguish between cats and dogs. Perfect for beginners to understand machine learning concepts.",
                project_type="image_classification",
                dataset_info={
                    "sample_count": 100,
                    "categories": ["cat", "dog"],
                    "format": "jpg",
                    "size": "small"
                },
                model_info={
                    "accuracy": 0.92,
                    "training_time": "2 hours",
                    "model_size": "15MB",
                    "status": "trained"
                }
            )
            
            # Create demo project
            demo_project = await self.demo_project_service.create_demo_project(
                teacher_id, classroom_id, demo_data
            )
            
            print(f"Demo project created successfully!")
            print(f"   Demo ID: {demo_project.demo_project_id}")
            print(f"   Name: {demo_project.name}")
            print(f"   Type: {demo_project.project_type}")
            print(f"   Teacher ID: {demo_project.teacher_id}")
            print(f"   Classroom ID: {demo_project.classroom_id}")
            
            self.test_results['demo_project'] = demo_project
            return demo_project
            
        except Exception as e:
            print(f"Demo project creation failed: {str(e)}")
            raise
    
    async def test_student_join_with_demos(self, hashcode: str, student_name: str) -> Dict[str, Any]:
        """Test student joining classroom and accessing demo projects"""
        print(f"\nTesting Student Join with Demo Access: {student_name}...")
        print("=" * 50)
        
        try:
            # Join classroom
            student = await self.student_service.join_classroom(hashcode, student_name)
            
            print(f"Student joined successfully!")
            print(f"   Student ID: {student.student_id}")
            print(f"   Name: {student.name}")
            print(f"   Accessible Demos: {len(student.accessible_demos)}")
            
            # Get accessible demo projects
            accessible_demos = await self.student_service.get_student_demos(student.student_id)
            
            print(f"   Demo Projects Available:")
            for demo in accessible_demos:
                print(f"     - {demo['name']} ({demo['project_type']})")
            
            self.test_results[f'student_{student_name.lower().replace(" ", "_")}'] = student
            self.test_results[f'demos_{student_name.lower().replace(" ", "_")}'] = accessible_demos
            
            return student
            
        except Exception as e:
            print(f"Student join failed: {str(e)}")
            raise
    
    async def test_multiple_students(self, hashcode: str):
        """Test multiple students joining the same classroom"""
        print(f"\nTesting Multiple Students Join...")
        print("=" * 50)
        
        student_names = ["Alice Demo", "Bob Demo", "Charlie Demo"]
        
        for name in student_names:
            try:
                await self.test_student_join_with_demos(hashcode, name)
            except Exception as e:
                print(f"Student {name} join failed: {str(e)}")
                continue
    
    async def test_classroom_demos(self, classroom_id: str):
        """Test getting demo projects for a classroom"""
        print(f"\nTesting Classroom Demo Projects...")
        print("=" * 50)
        
        try:
            # Get classroom demos
            demos = await self.demo_project_service.get_classroom_demos(classroom_id)
            
            print(f"Classroom demos retrieved successfully!")
            print(f"   Total Demos: {len(demos)}")
            
            for demo in demos:
                print(f"     - {demo.name} ({demo.project_type})")
                print(f"       Description: {demo.description}")
                print(f"       Created: {demo.created_at}")
            
            return demos
            
        except Exception as e:
            print(f"Classroom demos retrieval failed: {str(e)}")
            raise
    
    async def test_teacher_dashboard_with_demos(self, teacher_id: str):
        """Test teacher dashboard including demo projects"""
        print(f"\nTesting Teacher Dashboard with Demo Projects...")
        print("=" * 50)
        
        try:
            # Get teacher dashboard
            dashboard = await self.teacher_service.get_teacher_dashboard(teacher_id)
            
            print(f"Dashboard retrieved successfully!")
            print(f"   Teacher: {dashboard['teacher']['name']}")
            print(f"   Total Classrooms: {len(dashboard['classrooms'])}")
            print(f"   Total Students: {dashboard['total_students']}")
            print(f"   Total Projects: {dashboard['total_projects']}")
            print(f"   Total Demo Projects: {dashboard['total_demo_projects']}")
            
            print(f"\nDashboard Details:")
            print(json.dumps(dashboard, indent=2, default=str))
            
            return dashboard
            
        except Exception as e:
            print(f"Dashboard retrieval failed: {str(e)}")
            raise
    
    async def test_demo_project_management(self, demo_project_id: str):
        """Test demo project management operations"""
        print(f"\nTesting Demo Project Management...")
        print("=" * 50)
        
        try:
            # Get demo project
            demo = await self.demo_project_service.get_demo_project(demo_project_id)
            print(f"Demo project retrieved: {demo.name}")
            
            # Update demo project
            updates = {
                "description": "Updated description for the Cat vs Dog Image Classifier demo project."
            }
            updated_demo = await self.demo_project_service.update_demo_project(demo_project_id, updates)
            print(f"Demo project updated: {updated_demo.description}")
            
            # Archive demo project
            success = await self.demo_project_service.archive_demo_project(demo_project_id)
            print(f"Demo project archived: {success}")
            
            return updated_demo
            
        except Exception as e:
            print(f"Demo project management failed: {str(e)}")
            raise
    
    async def inspect_database(self, teacher_id: str):
        """Inspect the database to show how data is stored"""
        print("\nInspecting Database Structure...")
        print("=" * 50)
        
        try:
            # Get teacher with all data
            teacher = await self.teacher_service.get_teacher(teacher_id)
            
            # Get teacher dashboard
            dashboard = await self.teacher_service.get_teacher_dashboard(teacher_id)
            
            print("TEACHER DASHBOARD:")
            print(json.dumps(dashboard, indent=2, default=str))
            
            print("\nTEACHER DOCUMENT STRUCTURE:")
            teacher_dict = teacher.model_dump()
            print(json.dumps(teacher_dict, indent=2, default=str))
            
            # Get students for each classroom
            for classroom in teacher.classrooms:
                if classroom.students:
                    print(f"\nSTUDENTS IN {classroom.name}:")
                    for student_id in classroom.students:
                        try:
                            student = await self.student_service.get_student(student_id)
                            if student:
                                student_dict = student.model_dump()
                                print(f"   {student.name} (ID: {student_id}):")
                                print(json.dumps(student_dict, indent=4, default=str))
                        except Exception as e:
                            print(f"   Error getting student {student_id}: {str(e)}")
            
        except Exception as e:
            print(f"Database inspection failed: {str(e)}")
            raise
    
    async def test_project_linking(self, student_id: str):
        """Test linking a project to a student"""
        print(f"\nTesting Project Linking...")
        print("=" * 50)
        
        try:
            # Create a mock project ID (in real scenario, this would be created via project API)
            mock_project_id = "PRJ_TEST_001"
            
            # Link project to student
            success = await self.student_service.link_project_to_student(mock_project_id, student_id)
            
            if success:
                print(f"Project linked successfully!")
                print(f"   Project ID: {mock_project_id}")
                print(f"   Student ID: {student_id}")
            else:
                print(f"Project linking failed")
                
        except Exception as e:
            print(f"Project linking failed: {str(e)}")
    
    async def run_complete_test(self):
        """Run the complete demo project test workflow"""
        print("Starting Complete Demo Project System Test")
        print("=" * 60)
        
        try:
            # 1. Register teacher
            teacher = await self.test_teacher_registration()
            
            # 2. Add second classroom
            second_classroom = await self.test_add_classroom(teacher.teacher_id)
            
            # 3. Create demo project in first classroom
            first_classroom_id = teacher.classrooms[0].classroom_id
            demo_project = await self.test_create_demo_project(teacher.teacher_id, first_classroom_id)
            
            # 4. Test students joining first classroom
            first_hashcode = teacher.classrooms[0].hashcode
            print(f"\nTesting students joining first classroom with hashcode: {first_hashcode}")
            await self.test_multiple_students(first_hashcode)
            
            # 5. Test students joining second classroom
            second_hashcode = second_classroom.hashcode
            print(f"\nTesting students joining second classroom with hashcode: {second_hashcode}")
            await self.test_multiple_students(second_hashcode)
            
            # 6. Test classroom demos
            await self.test_classroom_demos(first_classroom_id)
            
            # 7. Test teacher dashboard with demos
            await self.test_teacher_dashboard_with_demos(teacher.teacher_id)
            
            # 8. Test demo project management
            if demo_project:
                await self.test_demo_project_management(demo_project.demo_project_id)
            
            # 9. Test project linking for one student
            if 'student_alice_demo' in self.test_results:
                await self.test_project_linking(self.test_results['student_alice_demo'].student_id)
            
            # 10. Inspect database
            await self.inspect_database(teacher.teacher_id)
            
            print("\nComplete demo project test workflow finished successfully!")
            print("=" * 60)
            
        except Exception as e:
            print(f"\nTest workflow failed: {str(e)}")
            raise
    
    def print_summary(self):
        """Print a summary of all test results"""
        print("\nDEMO PROJECT TEST SUMMARY")
        print("=" * 50)
        
        if 'teacher' in self.test_results:
            teacher = self.test_results['teacher']
            print(f"Teacher: {teacher.name} ({teacher.teacher_id})")
            print(f"   Classrooms: {len(teacher.classrooms)}")
            for i, classroom in enumerate(teacher.classrooms):
                print(f"     {i+1}. {classroom.name} - Hashcode: {classroom.hashcode}")
        
        if 'demo_project' in self.test_results:
            demo = self.test_results['demo_project']
            print(f"Demo Project: {demo.name} ({demo.demo_project_id})")
            print(f"   Type: {demo.project_type}")
            print(f"   Classroom: {demo.classroom_id}")
        
        student_count = sum(1 for key in self.test_results.keys() if key.startswith('student_'))
        print(f"Students: {student_count} joined with demo access")
        
        demo_count = sum(1 for key in self.test_results.keys() if key.startswith('demos_'))
        print(f"Demo Access: {demo_count} students can access demos")


async def main():
    """Main test function"""
    tester = DemoProjectTester()
    
    try:
        await tester.run_complete_test()
        tester.print_summary()
        
    except Exception as e:
        print(f"Test execution failed: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the test
    asyncio.run(main())
