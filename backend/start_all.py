#!/usr/bin/env python3
"""
Start Everything Script
This script starts both the FastAPI backend and training worker
"""

import subprocess
import sys
import os
import time
import signal
import threading

def start_backend():
    """Start the FastAPI backend server"""
    print("🚀 Starting FastAPI Backend...")
    try:
        # Start uvicorn server
        process = subprocess.Popen([
            sys.executable, "-m", "uvicorn", 
            "app.main:app", 
            "--reload", 
            "--host", "0.0.0.0", 
            "--port", "8080"
        ], cwd=os.path.dirname(__file__))
        return process
    except Exception as e:
        print(f"❌ Failed to start backend: {e}")
        return None

def start_worker():
    """Start the training worker"""
    print("🔧 Starting Training Worker...")
    try:
        # Start training worker
        process = subprocess.Popen([
            sys.executable, "start_worker.py"
        ], cwd=os.path.dirname(__file__))
        return process
    except Exception as e:
        print(f"❌ Failed to start worker: {e}")
        return None

def main():
    """Start both services"""
    print("🎯 YaaraLabs Playground Backend - Starting All Services")
    print("=" * 50)
    
    # Start backend
    backend_process = start_backend()
    if not backend_process:
        print("❌ Backend failed to start")
        return
    
    # Wait a moment for backend to start
    time.sleep(3)
    
    # Start worker
    worker_process = start_worker()
    if not worker_process:
        print("❌ Worker failed to start")
        backend_process.terminate()
        return
    
    print("\n✅ All services started successfully!")
    print("🌐 Backend API: http://localhost:8080")
    print("📚 API Docs: http://localhost:8080/docs")
    print("🔧 Training Worker: Running in background")
    print("\n🔄 Press Ctrl+C to stop all services")
    print("=" * 50)
    
    try:
        # Wait for processes
        while True:
            if backend_process.poll() is not None:
                print("❌ Backend process stopped unexpectedly")
                break
            if worker_process.poll() is not None:
                print("❌ Worker process stopped unexpectedly")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Stopping all services...")
        
        # Terminate processes
        if backend_process:
            backend_process.terminate()
            backend_process.wait()
        if worker_process:
            worker_process.terminate()
            worker_process.wait()
        
        print("✅ All services stopped")

if __name__ == "__main__":
    main()
