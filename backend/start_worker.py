#!/usr/bin/env python3
"""
Training Worker Startup Script
Run this to start the training worker that processes jobs from the queue
"""

import sys
import os

# Add the app directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.training_worker import training_worker

if __name__ == "__main__":
    print("🚀 Starting YaaraLabs Playground Training Worker...")
    print("📊 This worker will process training jobs from the queue")
    print("🔄 Press Ctrl+C to stop the worker")
    print("-" * 50)
    
    try:
        training_worker.start_worker()
    except KeyboardInterrupt:
        print("\n🛑 Worker stopped by user")
    except Exception as e:
        print(f"❌ Worker error: {e}")
        sys.exit(1)
