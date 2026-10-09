#!/usr/bin/env python3
"""
Test script for the new label deletion APIs in the guest system.
This script tests the new endpoints for deleting labels and empty labels.
"""

import asyncio
import logging
from unittest.mock import Mock, AsyncMock
import sys
import os

# Add the backend directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from app.api.guests.guests import delete_label, delete_empty_label
from app.services.guest_service import GuestService
from app.services.project_service import ProjectService
from app.models import TextExample, Dataset

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_delete_label():
    """Test the delete label API endpoint"""
    logger.info("Testing delete_label API endpoint...")
    
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
    mock_project_service.save_project = AsyncMock(return_value=True)
    
    try:
        # Test the endpoint
        result = await delete_label(
            project_id="test_project_123",
            label="happy",
            session_id="test_session_123",
            guest_service=mock_guest_service,
            project_service=mock_project_service
        )
        
        logger.info(f"✅ delete_label test passed: {result}")
        return True
        
    except Exception as e:
        logger.error(f"❌ delete_label test failed: {str(e)}")
        return False

async def test_delete_empty_label():
    """Test the delete empty label API endpoint"""
    logger.info("Testing delete_empty_label API endpoint...")
    
    # Mock dependencies
    mock_guest_service = Mock(spec=GuestService)
    mock_project_service = Mock(spec=ProjectService)
    
    # Mock session validation
    mock_session = Mock()
    mock_session.id = "test_session_123"
    mock_guest_service.validate_session = AsyncMock(return_value=mock_session)
    
    # Mock project with empty label
    mock_project = Mock()
    mock_project.student_id = "test_session_123"
    mock_project.dataset = Mock()
    mock_project.dataset.examples = [
        Mock(text="Sad example 1", label="sad")
    ]
    mock_project.dataset.labels = ["happy", "sad"]  # "happy" has no examples
    mock_project.dataset.records = 1
    
    mock_project_service.get_project = AsyncMock(return_value=mock_project)
    mock_project_service.save_project = AsyncMock(return_value=True)
    
    try:
        # Test the endpoint
        result = await delete_empty_label(
            project_id="test_project_123",
            label="happy",
            session_id="test_session_123",
            guest_service=mock_guest_service,
            project_service=mock_project_service
        )
        
        logger.info(f"✅ delete_empty_label test passed: {result}")
        return True
        
    except Exception as e:
        logger.error(f"❌ delete_empty_label test failed: {str(e)}")
        return False

async def test_delete_empty_label_with_examples():
    """Test the delete empty label API endpoint when label has examples (should fail)"""
    logger.info("Testing delete_empty_label API endpoint with examples (should fail)...")
    
    # Mock dependencies
    mock_guest_service = Mock(spec=GuestService)
    mock_project_service = Mock(spec=ProjectService)
    
    # Mock session validation
    mock_session = Mock()
    mock_session.id = "test_session_123"
    mock_guest_service.validate_session = AsyncMock(return_value=mock_session)
    
    # Mock project with examples under the label
    mock_project = Mock()
    mock_project.student_id = "test_session_123"
    mock_project.dataset = Mock()
    mock_project.dataset.examples = [
        Mock(text="Happy example 1", label="happy"),
        Mock(text="Happy example 2", label="happy")
    ]
    mock_project.dataset.labels = ["happy"]
    mock_project.dataset.records = 2
    
    mock_project_service.get_project = AsyncMock(return_value=mock_project)
    
    try:
        # Test the endpoint - this should fail with 400
        result = await delete_empty_label(
            project_id="test_project_123",
            label="happy",
            session_id="test_session_123",
            guest_service=mock_guest_service,
            project_service=mock_project_service
        )
        
        logger.error(f"❌ delete_empty_label with examples test should have failed but returned: {result}")
        return False
        
    except Exception as e:
        # Check if it's an HTTPException with 400 status
        if hasattr(e, 'status_code') and e.status_code == 400:
            logger.info(f"✅ delete_empty_label with examples test correctly failed as expected with 400: {str(e)}")
            return True
        elif "400" in str(e) or "examples" in str(e).lower():
            logger.info(f"✅ delete_empty_label with examples test correctly failed as expected: {str(e)}")
            return True
        else:
            logger.error(f"❌ delete_empty_label with examples test failed with unexpected error: {str(e)}")
            return False

async def main():
    """Run all tests"""
    logger.info("🚀 Starting tests for new label deletion APIs...")
    
    tests = [
        test_delete_label,
        test_delete_empty_label,
        test_delete_empty_label_with_examples
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        try:
            if await test():
                passed += 1
            else:
                logger.error(f"❌ Test {test.__name__} failed")
        except Exception as e:
            logger.error(f"❌ Test {test.__name__} crashed: {str(e)}")
    
    logger.info(f"📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        logger.info("🎉 All tests passed! New label deletion APIs are working correctly.")
        return True
    else:
        logger.error("💥 Some tests failed. Please check the implementation.")
        return False

if __name__ == "__main__":
    asyncio.run(main())
