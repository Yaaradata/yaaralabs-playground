#!/usr/bin/env python3
"""
Test script for the new delete APIs in the guest system.
This script tests the deletion of trained models and examples.
"""

import asyncio
import logging
import sys
import os

# Add the app directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from app.api.guests.guests import (
    delete_trained_model,
    delete_examples_by_label,
    delete_specific_example
)
from app.services.guest_service import GuestService
from app.services.project_service import ProjectService
from unittest.mock import Mock, AsyncMock, patch

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def test_delete_trained_model():
    """Test the delete trained model API endpoint"""
    logger.info("Testing delete_trained_model API endpoint...")
    
    # Mock dependencies
    mock_guest_service = Mock(spec=GuestService)
    mock_project_service = Mock(spec=ProjectService)
    
    # Mock session validation
    mock_session = Mock()
    mock_session.id = "test_session_123"
    mock_guest_service.validate_session = AsyncMock(return_value=mock_session)
    
    # Mock project
    mock_project = Mock()
    mock_project.student_id = "test_session_123"
    mock_project.model = Mock()
    mock_project.model.gcsPath = "test-bucket/models/test_model.pkl"
    mock_project_service.get_project = AsyncMock(return_value=mock_project)
    
    # Mock project update
    mock_project_service.update_project = AsyncMock(return_value=True)
    
    # Mock GCS operations
    with patch('google.cloud.storage.Client') as mock_storage_client:
        mock_bucket = Mock()
        mock_blob = Mock()
        mock_blob.exists.return_value = True
        mock_bucket.blob.return_value = mock_blob
        mock_storage_client.return_value.bucket.return_value = mock_bucket
        
        try:
            # Test the endpoint
            result = await delete_trained_model(
                project_id="test_project_123",
                session_id="test_session_123",
                guest_service=mock_guest_service,
                project_service=mock_project_service
            )
            
            logger.info(f"✅ delete_trained_model test passed: {result}")
            return True
            
        except Exception as e:
            logger.error(f"❌ delete_trained_model test failed: {str(e)}")
            return False


async def test_delete_examples_by_label():
    """Test the delete examples by label API endpoint"""
    logger.info("Testing delete_examples_by_label API endpoint...")
    
    # Mock dependencies
    mock_guest_service = Mock(spec=GuestService)
    mock_project_service = Mock(spec=ProjectService)
    
    # Mock session validation
    mock_session = Mock()
    mock_session.id = "test_session_123"
    mock_guest_service.validate_session = AsyncMock(return_value=mock_session)
    
    # Mock project with examples
    mock_project = Mock()
    mock_project.student_id = "test_session_123"
    mock_project.dataset = Mock()
    mock_project.dataset.examples = [
        Mock(text="Happy example 1", label="happy"),
        Mock(text="Happy example 2", label="happy"),
        Mock(text="Sad example 1", label="sad")
    ]
    mock_project.dataset.labels = ["happy", "sad"]
    mock_project.dataset.records = 3
    
    mock_project_service.get_project = AsyncMock(return_value=mock_project)
    mock_project_service.update_project = AsyncMock(return_value=True)
    
    try:
        # Test the endpoint
        result = await delete_examples_by_label(
            project_id="test_project_123",
            label="happy",
            session_id="test_session_123",
            guest_service=mock_guest_service,
            project_service=mock_project_service
        )
        
        logger.info(f"✅ delete_examples_by_label test passed: {result}")
        return True
        
    except Exception as e:
        logger.error(f"❌ delete_examples_by_label test failed: {str(e)}")
        return False


async def test_delete_specific_example():
    """Test the delete specific example API endpoint"""
    logger.info("Testing delete_specific_example API endpoint...")
    
    # Mock dependencies
    mock_guest_service = Mock(spec=GuestService)
    mock_project_service = Mock(spec=ProjectService)
    
    # Mock session validation
    mock_session = Mock()
    mock_session.id = "test_session_123"
    mock_guest_service.validate_session = AsyncMock(return_value=mock_session)
    
    # Mock project with examples
    mock_project = Mock()
    mock_project.student_id = "test_session_123"
    mock_project.dataset = Mock()
    mock_project.dataset.examples = [
        Mock(text="Happy example 1", label="happy"),
        Mock(text="Happy example 2", label="happy"),
        Mock(text="Sad example 1", label="sad")
    ]
    mock_project.dataset.records = 3
    
    mock_project_service.get_project = AsyncMock(return_value=mock_project)
    mock_project_service.update_project = AsyncMock(return_value=True)
    
    try:
        # Test the endpoint
        result = await delete_specific_example(
            project_id="test_project_123",
            label="happy",
            example_index=0,
            session_id="test_session_123",
            guest_service=mock_guest_service,
            project_service=mock_project_service
        )
        
        logger.info(f"✅ delete_specific_example test passed: {result}")
        return True
        
    except Exception as e:
        logger.error(f"❌ delete_specific_example test failed: {str(e)}")
        return False


async def run_all_tests():
    """Run all tests"""
    logger.info("🚀 Starting API deletion tests...")
    
    tests = [
        test_delete_trained_model,
        test_delete_examples_by_label,
        test_delete_specific_example
    ]
    
    results = []
    for test in tests:
        try:
            result = await test()
            results.append(result)
        except Exception as e:
            logger.error(f"Test {test.__name__} crashed: {str(e)}")
            results.append(False)
    
    # Summary
    passed = sum(results)
    total = len(results)
    
    logger.info(f"\n📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        logger.info("🎉 All tests passed!")
        return True
    else:
        logger.error("❌ Some tests failed!")
        return False


if __name__ == "__main__":
    try:
        success = asyncio.run(run_all_tests())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        logger.info("Tests interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Test runner failed: {str(e)}")
        sys.exit(1)
