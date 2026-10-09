#!/usr/bin/env python3
"""
Quick test script to verify the delete examples fix is working
"""

import requests
import json

# Test configuration
BASE_URL = "http://localhost:8080"
PROJECT_ID = "376b4797-b985-4a3b-9c04-aeca001496ec"
SESSION_ID = "session_4202e9788b224c87"
LABEL_TO_DELETE = "Happy"

def test_delete_examples_by_label():
    """Test the delete examples by label endpoint"""
    print(f"Testing DELETE /api/guests/projects/{PROJECT_ID}/examples/{LABEL_TO_DELETE}")
    
    url = f"{BASE_URL}/api/guests/projects/{PROJECT_ID}/examples/{LABEL_TO_DELETE}"
    params = {"session_id": SESSION_ID}
    
    try:
        response = requests.delete(url, params=params)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code == 200:
            print("✅ SUCCESS: Delete operation completed successfully!")
        else:
            print(f"❌ FAILED: Got status code {response.status_code}")
            
    except Exception as e:
        print(f"❌ ERROR: {str(e)}")

if __name__ == "__main__":
    test_delete_examples_by_label()
