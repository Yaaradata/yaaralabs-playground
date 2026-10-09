#!/usr/bin/env python3
"""
Test Runner for YaaraLabs Playground Backend
This script runs all the different types of tests available.
"""

import asyncio
import subprocess
import sys
import os


def run_command(command, description):
    """Run a command and handle errors"""
    print(f"\n{description}")
    print("=" * 60)
    
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print("Command completed successfully!")
        if result.stdout:
            print("Output:")
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Command failed with exit code {e.returncode}")
        if e.stdout:
            print("Stdout:")
            print(e.stdout)
        if e.stderr:
            print("Stderr:")
            print(e.stderr)
        return False


def main():
    """Main test runner"""
    print("YaaraLabs Playground - Complete Test Suite")
    print("=" * 60)
    
    # Check if we're in the backend directory
    if not os.path.exists("app"):
        print("Please run this script from the backend directory")
        print("   cd backend")
        print("   python run_all_tests.py")
        sys.exit(1)
    
    print("Available Tests:")
    print("1. Service Layer Tests (Direct function calls)")
    print("2. API Endpoint Tests (HTTP requests)")
    print("3. Demo Project System Tests")
    print("4. All Tests")
    
    choice = input("\nSelect test type (1-4): ").strip()
    
    if choice == "1":
        print("\nRunning Service Layer Tests...")
        success = run_command("python test_teacher_system.py", "Service Layer Tests")
        
    elif choice == "2":
        print("\nRunning API Endpoint Tests...")
        print("Make sure your FastAPI backend is running first!")
        print("   python start_all.py")
        input("Press Enter when backend is running...")
        success = run_command("python test_api_endpoints.py", "API Endpoint Tests")
        
    elif choice == "3":
        print("\nRunning Demo Project System Tests...")
        success = run_command("python test_demo_projects.py", "Demo Project System Tests")
        
    elif choice == "4":
        print("\nRunning All Tests...")
        
        # Run service tests first
        print("\n1. Service Layer Tests...")
        success1 = run_command("python test_teacher_system.py", "Service Layer Tests")
        
        # Run demo project tests
        print("\n2. Demo Project System Tests...")
        success2 = run_command("python test_demo_projects.py", "Demo Project System Tests")
        
        # Check if backend is running for API tests
        print("\n3. API Endpoint Tests...")
        print("Make sure your FastAPI backend is running first!")
        print("   python start_all.py")
        input("Press Enter when backend is running...")
        success3 = run_command("python test_api_endpoints.py", "API Endpoint Tests")
        
        success = success1 and success2 and success3
        
    else:
        print("Invalid choice. Please select 1-4.")
        return
    
    # Final summary
    print("\n" + "=" * 60)
    if success:
        print("All selected tests completed successfully!")
    else:
        print("Some tests failed. Check the output above for details.")
    
    print("\nTest Summary:")
    print("• Service Tests: Direct function calls to test business logic")
    print("• API Tests: HTTP requests to test endpoints (requires running backend)")
    print("• Demo Project Tests: Complete demo project workflow")
    
    print("\nTo start the backend for API testing:")
    print("   python start_all.py")
    
    print("\nTo run individual tests:")
    print("   python test_teacher_system.py      # Service tests")
    print("   python test_demo_projects.py       # Demo project tests")
    print("   python test_api_endpoints.py       # API tests (requires backend)")


if __name__ == "__main__":
    main()
