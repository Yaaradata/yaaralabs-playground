from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from typing import Optional, List
from pydantic import BaseModel
import logging

from ..models import (
    KnowledgeTextRequest, KnowledgeFileRequest, KnowledgeLinkRequest, KnowledgeQnARequest,
    KnowledgeResponse, KnowledgeFileResponse, ErrorResponse
)
from ..services.knowledge_service import KnowledgeService
from ..services.file_service import FileService, get_file_service
from ..config import gcp_clients

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kb", tags=["agent"])


def get_knowledge_service():
    """Dependency function for KnowledgeService - lazy initialization"""
    # Service is lazy, so __init__ won't fail - GCP clients initialize on first use
    return KnowledgeService()


class KnowledgeUpdateRequest(BaseModel):
    content: str


# ============ LIST, GET, UPDATE, DELETE ============

@router.get("/list")
async def list_knowledge(
    agent_id: str = Query(..., description="Agent ID"),
    kb_type: Optional[str] = Query(None, description="Filter by knowledge type (TEXT, FILE, LINK, QNA)"),
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    List all knowledge entries for an agent.
    """
    try:
        knowledge_list = knowledge_service.list_knowledge(agent_id, kb_type)
        return {
            "success": True,
            "count": len(knowledge_list),
            "knowledge": knowledge_list
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{knowledge_id}")
async def get_knowledge(
    knowledge_id: str,
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Get a single knowledge entry by ID.
    """
    try:
        knowledge = knowledge_service.get_knowledge(knowledge_id)
        if not knowledge:
            raise HTTPException(status_code=404, detail="Knowledge entry not found")
        return {
            "success": True,
            "knowledge": knowledge
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{knowledge_id}")
async def update_knowledge(
    knowledge_id: str,
    request: KnowledgeUpdateRequest,
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Update a knowledge entry's content.
    This will regenerate the embedding.
    """
    try:
        result = knowledge_service.update_knowledge(knowledge_id, request.content)
        return {
            "success": True,
            "message": "Knowledge updated successfully",
            **result
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{knowledge_id}")
async def delete_knowledge(
    knowledge_id: str,
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Delete a knowledge entry.
    """
    try:
        knowledge_service.delete_knowledge(knowledge_id)
        return {
            "success": True,
            "message": "Knowledge deleted successfully"
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============ ADD KNOWLEDGE ============

@router.post("/text")
async def add_text_knowledge(
    request: KnowledgeTextRequest,
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Add text knowledge to an agent's knowledge base.
    
    This endpoint:
    1. Normalizes and chunks the text if needed
    2. Generates embeddings for each chunk
    3. Stores in Firestore
    """
    try:
        result = knowledge_service.add_text_knowledge(request)
        return {
            "status": "success",
            "knowledge_ids": result["knowledge_ids"],
            "chunks_added": result["chunks_added"],
            "message": f"Text knowledge added successfully ({result['chunks_added']} chunks)"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/file")
async def add_file_knowledge(
    file: UploadFile = File(...),
    agent_id: str = Form(...),
    session_id: Optional[str] = Form(None),
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Add file knowledge to an agent's knowledge base.
    
    Supported file types:
    - PDF: 2MB max
    - Excel (xlsx, xls): 1MB max
    - CSV: 1MB max
    - Text (txt): 1MB max
    
    This endpoint:
    1. Validates file type and size
    2. Uploads file to Cloud Storage
    3. Extracts text from file
    4. Chunks the text
    5. Generates embeddings for each chunk
    6. Stores each chunk as a KB record
    """
    try:
        logger.info(f"📁 File upload request: {file.filename}, agent: {agent_id}")
        
        # Initialize file service
        file_service = get_file_service()
        
        # Read file content
        file_content = await file.read()
        file_size = len(file_content)
        
        # Validate file
        is_valid, error_msg, file_type = file_service.validate_file(
            file.filename, 
            file.content_type, 
            file_size
        )
        
        if not is_valid:
            logger.warning(f"❌ File validation failed: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
        
        logger.info(f"✅ File validated: {file_type}, {file_size} bytes")
        
        # Upload to GCS
        gcs_url = file_service.upload_to_gcs(
            file_content, 
            agent_id, 
            file.filename, 
            file_type
        )
        
        # Extract text from file
        extracted_text, file_metadata = file_service.extract_text(
            file_content, 
            file_type, 
            file.filename
        )
        
        if not extracted_text.strip():
            raise HTTPException(status_code=400, detail="No text could be extracted from the file")
        
        logger.info(f"📝 Extracted {len(extracted_text)} chars from {file.filename}")
        
        # Add to knowledge base
        result = knowledge_service.add_file_knowledge(
            agent_id=agent_id,
            session_id=session_id,
            file_name=file.filename,
            file_type=file_type,
            file_url=gcs_url,
            file_size=file_size,
            extracted_text=extracted_text,
            file_metadata=file_metadata
        )
        
        return {
            "success": True,
            "knowledge_ids": result["knowledge_ids"],
            "chunks_added": result["chunks_added"],
            "file_name": file.filename,
            "file_type": file_type,
            "file_url": gcs_url,
            "extracted_chars": len(extracted_text),
            "message": f"File knowledge added successfully ({result['chunks_added']} chunks)"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ File upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/link")
async def add_link_knowledge(
    request: KnowledgeLinkRequest,
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Add link knowledge to an agent's knowledge base.
    
    This endpoint:
    1. Fetches URL content
    2. Cleans HTML (removes scripts, styles, nav, footer)
    3. Extracts and normalizes text
    4. Chunks text
    5. Generates embeddings
    6. Stores KB entries
    """
    try:
        logger.info(f"🔗 Link KB request: {request.url}, agent: {request.agent_id}")
        result = knowledge_service.add_link_knowledge(request)
        return {
            "success": True,
            "knowledge_ids": result["knowledge_ids"],
            "chunks_added": result["chunks_added"],
            "url": result["url"],
            "page_title": result["page_title"],
            "extracted_chars": result["extracted_chars"],
            "message": f"Link knowledge added successfully ({result['chunks_added']} chunks)"
        }
    except Exception as e:
        logger.error(f"❌ Link KB failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/qna", response_model=KnowledgeResponse)
async def add_qna_knowledge(
    request: KnowledgeQnARequest,
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Add Q&A knowledge to an agent's knowledge base.
    
    This endpoint:
    1. Combines Q + A
    2. Generates embedding
    3. Stores with high priority flag
    """
    try:
        knowledge_id = knowledge_service.add_qna_knowledge(request)
        return KnowledgeResponse(
            knowledge_id=knowledge_id,
            message="Q&A knowledge added successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/file/view/{knowledge_id}")
async def view_file(
    knowledge_id: str,
    knowledge_service: KnowledgeService = Depends(get_knowledge_service)
):
    """
    Download and serve a file from GCS.
    """
    from fastapi.responses import Response
    
    try:
        # Get the knowledge entry
        knowledge = knowledge_service.get_knowledge(knowledge_id)
        if not knowledge:
            raise HTTPException(status_code=404, detail="Knowledge entry not found")
        
        # Check if it's a file type
        if knowledge.get('type') != 'file':
            raise HTTPException(status_code=400, detail="This knowledge entry is not a file")
        
        # Get file URL from metadata
        file_url = knowledge.get('metadata', {}).get('file_url')
        if not file_url:
            raise HTTPException(status_code=404, detail="File URL not found")
        
        # Download file from GCS and serve it
        file_service = get_file_service()
        file_content, content_type = file_service.download_file(file_url)
        
        file_name = knowledge.get('metadata', {}).get('file_name', 'file')
        
        return Response(
            content=file_content,
            media_type=content_type,
            headers={
                "Content-Disposition": f"inline; filename=\"{file_name}\""
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

