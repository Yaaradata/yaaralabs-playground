#!/usr/bin/env python3
"""
Test API Endpoints for Teacher-Classroom-Student-Demo Project System
This script tests the API endpoints directly using HTTP requests.
Run this after starting your FastAPI backend.
"""

import asyncio
import aiohttp
import json
from datetime import datetime


class APITester:
    """Test class for API endpoints"""
    
    def __init__(self, base_url: str = "http://localhost:8080"):
        self.base_url = base_url
        self.test_results = {}
    
    async def test_teacher_registration(self) -> dict:
        """Test teacher registration endpoint"""
        print("Testing Teacher Registration API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/teachers/register"
        
        data = {
            "name": "Sarah Johnson",
            "school_name": "Innovation High School",
            "date_of_training": "2025-08-15",
            "session": "afternoon"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data) as response:
                if response.status == 201:
                    result = await response.json()
                    teacher = result['data']
                    
                    print(f"Teacher registered successfully!")
                    print(f"   Teacher ID: {teacher['teacher_id']}")
                    print(f"   Name: {teacher['name']}")
                    print(f"   School: {teacher['school_name']}")
                    print(f"   First Classroom: {teacher['classrooms'][0]['name']}")
                    print(f"   Hashcode: {teacher['classrooms'][0]['hashcode']}")
                    
                    self.test_results['teacher'] = teacher
                    return teacher
                else:
                    error_text = await response.text()
                    print(f"Teacher registration failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_add_classroom(self, teacher_id: str) -> dict:
        """Test adding classroom endpoint"""
        print(f"\nTesting Add Classroom API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/teachers/{teacher_id}/classrooms"
        
        data = {
            "name": "Class 10A"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data) as response:
                if response.status == 201:
                    result = await response.json()
                    classroom = result['data']
                    
                    print(f"Classroom added successfully!")
                    print(f"   Classroom ID: {classroom['classroom_id']}")
                    print(f"   Name: {classroom['name']}")
                    print(f"   Hashcode: {classroom['hashcode']}")
                    
                    self.test_results['second_classroom'] = classroom
                    return classroom
                else:
                    error_text = await response.text()
                    print(f"Classroom addition failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_create_demo_project(self, classroom_id: str, teacher_id: str) -> dict:
        """Test creating demo project endpoint"""
        print(f"\nTesting Create Demo Project API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/demo-projects/classrooms/{classroom_id}"
        
        data = {
            "name": "Cat vs Dog Image Classifier",
            "description": "A simple image classification model to distinguish between cats and dogs. Perfect for beginners!",
            "project_type": "image_classification",
            "dataset_info": {
                "sample_count": 100,
                "categories": ["cat", "dog"],
                "format": "jpg",
                "size": "small"
            },
            "model_info": {
                "accuracy": 0.92,
                "training_time": "2 hours",
                "model_size": "15MB",
                "status": "trained"
            }
        }
        
        # Note: In real app, teacher_id would come from authentication
        params = {"teacher_id": teacher_id}
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data, params=params) as response:
                if response.status == 201:
                    result = await response.json()
                    demo_project = result['data']
                    
                    print(f"Demo project created successfully!")
                    print(f"   Demo ID: {demo_project['demo_project_id']}")
                    print(f"   Name: {demo_project['name']}")
                    print(f"   Type: {demo_project['project_type']}")
                    print(f"   Teacher ID: {demo_project['teacher_id']}")
                    print(f"   Classroom ID: {demo_project['classroom_id']}")
                    
                    self.test_results['demo_project'] = demo_project
                    return demo_project
                else:
                    error_text = await response.text()
                    print(f"Demo project creation failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_student_join(self, hashcode: str, student_name: str) -> dict:
        """Test student join endpoint"""
        print(f"\nTesting Student Join API: {student_name}...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/students/join"
        
        data = {
            "hashcode": hashcode,
            "name": student_name
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data) as response:
                if response.status == 201:
                    result = await response.json()
                    student = result['data']
                    
                    print(f"Student joined successfully!")
                    print(f"   Student ID: {student['student_id']}")
                    print(f"   Name: {student['name']}")
                    print(f"   Teacher ID: {student['teacher_id']}")
                    print(f"   Classroom ID: {student['classroom_id']}")
                    print(f"   Accessible Demos: {len(student['accessible_demos'])}")
                    
                    self.test_results[f'student_{student_name.lower().replace(" ", "_")}'] = student
                    return student
                else:
                    error_text = await response.text()
                    print(f"Student join failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_get_classroom_demos(self, classroom_id: str):
        """Test getting classroom demo projects"""
        print(f"\nTesting Get Classroom Demo Projects API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/demo-projects/classrooms/{classroom_id}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    demos = result['data']
                    
                    print(f"Classroom demos retrieved successfully!")
                    print(f"   Total Demos: {len(demos)}")
                    
                    for demo in demos:
                        print(f"     - {demo['name']} ({demo['project_type']})")
                        print(f"       Description: {demo['description']}")
                    
                    return demos
                else:
                    error_text = await response.text()
                    print(f"Classroom demos retrieval failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_get_student_accessible_demos(self, student_id: str):
        """Test getting student accessible demo projects"""
        print(f"\nTesting Get Student Accessible Demos API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/demo-projects/students/{student_id}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    demos = result['data']
                    
                    print(f"Student accessible demos retrieved successfully!")
                    print(f"   Total Demos: {len(demos)}")
                    
                    for demo in demos:
                        print(f"     - {demo['name']} ({demo['project_type']})")
                    
                    return demos
                else:
                    error_text = await response.text()
                    print(f"Student demos retrieval failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_get_teacher_dashboard(self, teacher_id: str):
        """Test getting teacher dashboard"""
        print(f"\nTesting Teacher Dashboard API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/teachers/{teacher_id}/dashboard"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    dashboard = result['data']
                    
                    print(f"Dashboard retrieved successfully!")
                    print(f"   Teacher: {dashboard['teacher']['name']}")
                    print(f"   School: {dashboard['teacher']['school_name']}")
                    print(f"   Total Classrooms: {len(dashboard['classrooms'])}")
                    print(f"   Total Students: {dashboard['total_students']}")
                    print(f"   Total Projects: {dashboard['total_projects']}")
                    print(f"   Total Demo Projects: {dashboard['total_demo_projects']}")
                    
                    print(f"\nDashboard Details:")
                    print(json.dumps(dashboard, indent=2, default=str))
                    
                    return dashboard
                else:
                    error_text = await response.text()
                    print(f"Dashboard retrieval failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_get_classroom_by_hashcode(self, hashcode: str):
        """Test getting classroom by hashcode"""
        print(f"\nTesting Get Classroom by Hashcode API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/classrooms/{hashcode}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    classroom_info = result['data']
                    
                    print(f"Classroom found successfully!")
                    print(f"   Teacher: {classroom_info['teacher_name']}")
                    print(f"   Classroom: {classroom_info['classroom_name']}")
                    print(f"   Hashcode: {classroom_info['hashcode']}")
                    
                    return classroom_info
                else:
                    error_text = await response.text()
                    print(f"Classroom lookup failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_get_students_by_classroom(self, classroom_id: str):
        """Test getting students in a classroom"""
        print(f"\nTesting Get Students by Classroom API...")
        print("=" * 50)
        
        url = f"{self.base_url}/api/students/classroom/{classroom_id}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    students = result['data']
                    
                    print(f"Students retrieved successfully!")
                    print(f"   Total Students: {len(students)}")
                    
                    for student in students:
                        print(f"     - {student['name']} (ID: {student['student_id']})")
                        print(f"       Projects: {len(student.get('projects', []))}")
                        print(f"       Accessible Demos: {len(student.get('accessible_demos', []))}")
                    
                    return students
                else:
                    error_text = await response.text()
                    print(f"Students retrieval failed: {response.status}")
                    print(f"   Error: {error_text}")
                    return None
    
    async def test_demo_project_management(self, demo_project_id: str):
        """Test demo project management operations"""
        print(f"\nTesting Demo Project Management APIs...")
        print("=" * 50)
        
        # Test getting demo project
        url = f"{self.base_url}/api/demo-projects/{demo_project_id}"
        
        async with aiohttp.ClientSession() as session:
            # Get demo project
            async with session.get(url) as response:
                if response.status == 200:
                    result = await response.json()
                    demo = result['data']
                    print(f"Demo project retrieved: {demo['name']}")
                else:
                    print(f"Demo project retrieval failed: {response.status}")
                    return None
            
            # Test updating demo project
            update_data = {
                "description": "Updated description for the Cat vs Dog Image Classifier demo project."
            }
            
            async with session.put(url, json=update_data) as response:
                if response.status == 200:
                    result = await response.json()
                    updated_demo = result['data']
                    print(f"Demo project updated: {updated_demo['description']}")
                else:
                    print(f"Demo project update failed: {response.status}")
            
            # Test archiving demo project
            archive_url = f"{url}/archive"
            async with session.patch(archive_url) as response:
                if response.status == 200:
                    result = await response.json()
                    print(f"Demo project archived: {result['message']}")
                else:
                    print(f"Demo project archive failed: {response.status}")
            
            return updated_demo
    
    async def run_complete_api_test(self):
        """Run the complete API test workflow"""
        print("Starting Complete API Test Workflow")
        print("=" * 60)
        
        try:
            # 1. Register teacher
            teacher = await self.test_teacher_registration()
            if not teacher:
                print("Cannot continue without teacher")
                return
            
            # 2. Add second classroom
            second_classroom = await self.test_add_classroom(teacher['teacher_id'])
            
            # 3. Create demo project in first classroom
            first_classroom_id = teacher['classrooms'][0]['classroom_id']
            demo_project = await self.test_create_demo_project(first_classroom_id, teacher['teacher_id'])
            
            # 4. Test students joining first classroom
            first_hashcode = teacher['classrooms'][0]['hashcode']
            print(f"\nTesting students joining first classroom with hashcode: {first_hashcode}")
            
            student_names = ["Emma Wilson", "David Chen", "Lisa Garcia"]
            for name in student_names:
                await self.test_student_join(first_hashcode, name)
            
            # 5. Test students joining second classroom
            if second_classroom:
                second_hashcode = second_classroom['hashcode']
                print(f"\nTesting students joining second classroom with hashcode: {second_hashcode}")
                
                student_names_2 = ["Mike Johnson", "Anna Smith"]
                for name in student_names_2:
                    await self.test_student_join(second_hashcode, name)
            
            # 6. Test demo project APIs
            if demo_project:
                await self.test_get_classroom_demos(first_classroom_id)
                
                # Test student accessible demos
                if 'student_emma_wilson' in self.test_results:
                    student = self.test_results['student_emma_wilson']
                    await self.test_get_student_accessible_demos(student['student_id'])
                
                # Test demo project management
                await self.test_demo_project_management(demo_project['demo_project_id'])
            
            # 7. Test classroom lookup by hashcode
            await self.test_get_classroom_by_hashcode(first_hashcode)
            
            # 8. Test getting students by classroom
            await self.test_get_students_by_classroom(first_classroom_id)
            
            # 9. Test teacher dashboard
            await self.test_get_teacher_dashboard(teacher['teacher_id'])
            
            print("\nComplete API test workflow finished successfully!")
            print("=" * 60)
            
        except Exception as e:
            print(f"\nAPI test workflow failed: {str(e)}")
            import traceback
            traceback.print_exc()
    
    def print_summary(self):
        """Print a summary of all test results"""
        print("\nAPI TEST SUMMARY")
        print("=" * 50)
        
        if 'teacher' in self.test_results:
            teacher = self.test_results['teacher']
            print(f"Teacher: {teacher['name']} ({teacher['teacher_id']})")
            print(f"   Classrooms: {len(teacher['classrooms'])}")
            for i, classroom in enumerate(teacher['classrooms']):
                print(f"     {i+1}. {classroom['name']} - Hashcode: {classroom['hashcode']}")
        
        if 'second_classroom' in self.test_results:
            classroom = self.test_results['second_classroom']
            print(f"Second Classroom: {classroom['name']} - Hashcode: {classroom['hashcode']}")
        
        if 'demo_project' in self.test_results:
            demo = self.test_results['demo_project']
            print(f"Demo Project: {demo['name']} ({demo['demo_project_id']})")
            print(f"   Type: {demo['project_type']}")
            print(f"   Classroom: {demo['classroom_id']}")
        
        student_count = sum(1 for key in self.test_results.keys() if key.startswith('student_'))
        print(f"Students: {student_count} joined successfully")
        
        print(f"\nHashcodes Generated:")
        if 'teacher' in self.test_results:
            for i, classroom in enumerate(teacher['classrooms']):
                print(f"   {classroom['name']}: {classroom['hashcode']}")


async def main():
    """Main test function"""
    print("API Endpoint Tester for Teacher-Classroom-Student-Demo Project System")
    print("Make sure your FastAPI backend is running on http://localhost:8080")
    print("=" * 70)
    
    tester = APITester()
    
    try:
        await tester.run_complete_api_test()
        tester.print_summary()
        
    except Exception as e:
        print(f"API test execution failed: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the API test
    asyncio.run(main())
