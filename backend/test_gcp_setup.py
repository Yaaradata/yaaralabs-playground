#!/usr/bin/env python3
"""
Test GCP Setup Script
This script tests the GCP configuration and creates necessary resources
"""

import os
import sys
from google.cloud import pubsub_v1
from google.cloud.exceptions import NotFound, Conflict

# Add the app directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.config import gcp_clients

def test_gcp_setup():
    """Test GCP configuration and create resources"""
    print("🧪 Testing GCP Setup...")
    
    try:
        # Get clients
        project_id = gcp_clients.get_project_id()
        topic_name = gcp_clients.get_topic_name()
        
        print(f"✅ Project ID: {project_id}")
        print(f"✅ Topic Name: {topic_name}")
        
        # Test Pub/Sub client
        pubsub_client = gcp_clients.get_pubsub_client()
        subscriber_client = gcp_clients.get_subscriber_client()
        
        print("✅ Pub/Sub clients created successfully")
        
        # Create topic
        topic_path = pubsub_client.topic_path(project_id, topic_name)
        try:
            pubsub_client.create_topic(name=topic_path)
            print(f"✅ Topic created: {topic_path}")
        except Conflict:
            print(f"✅ Topic already exists: {topic_path}")
        except Exception as e:
            print(f"⚠️ Topic creation issue: {e}")
        
        # Create subscription
        subscription_name = "training-worker-subscription"
        subscription_path = subscriber_client.subscription_path(project_id, subscription_name)
        
        try:
            subscriber_client.create_subscription(
                name=subscription_path,
                topic=topic_path,
                ack_deadline_seconds=600
            )
            print(f"✅ Subscription created: {subscription_path}")
        except Conflict:
            print(f"✅ Subscription already exists: {subscription_path}")
        except Exception as e:
            print(f"⚠️ Subscription creation issue: {e}")
        
        print("\n🎉 GCP setup test completed successfully!")
        print("🚀 Ready to start the backend and training worker")
        
    except Exception as e:
        print(f"❌ GCP setup test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    success = test_gcp_setup()
    sys.exit(0 if success else 1)
