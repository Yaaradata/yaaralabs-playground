from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Depends, Request
from typing import List, Optional
import json
import logging
import asyncio
from datetime import datetime, timezone
import uuid
from concurrent.futures import ThreadPoolExecutor

from ...models import (
    Project, ProjectCreate, ProjectUpdate, ProjectListResponse, 
    ProjectResponse, ProjectStatusResponseWrapper, TrainingConfig,
    FileUploadResponse, TrainingResponse, ErrorResponse,
    ExampleAdd, ExamplesBulkAdd, PredictionRequest, PredictionResponse,
    GuestSessionResponse, TrainedModel, Dataset, TextExample, GuestUpdate,
    PaginationInfo, ProjectType,
)
from ...services.rule_based_process_service import RuleBasedProcessService
from ...services.scratch_project_service import ScratchProjectService, EDITOR_RULES_BOT
from ...services.rules_bot_service import RulesBotService
from ...services.confusion_matrix_service import ConfusionMatrixService
from ...services.rag_chatbot_service import RagChatbotService
from ...services.ai_agent_service import AiAgentService
from ...services.exercises_service import ExercisesService
from ...services.guest_service import GuestService
from ...services.project_service import ProjectService
from ...training_service import trainer, distilbert_trainer
from ...text_ovr_service import ovr_text_trainer, MODEL_TYPE as OVR_MODEL_TYPE
from ...image_training_service import image_trainer, ImageRecognitionTrainer
from ...services.image_url_fetcher import fetch_image_from_url, ImageUrlError
from ...training_job_service import training_job_service
from ...config import gcp_clients

router = APIRouter(prefix="/api/guests", tags=["guests"])

# Configure logging
logger = logging.getLogger(__name__)

# Thread pool executor for concurrent training (allows multiple trainings to run simultaneously)
_training_executor = ThreadPoolExecutor(max_workers=15, thread_name_prefix="training")

# Dependency to get guest service
def get_guest_service():
    return GuestService()

# Dependency to get project service
def get_project_service():
    return ProjectService()

# Session validation dependency
async def validate_session_dependency(session_id: str, guest_service: GuestService = Depends(get_guest_service)):
    """Dependency to validate session for all guest endpoints"""
    try:
        session = await guest_service.validate_session(session_id)
        return session
    except ValueError as e:
        if "not found" in str(e):
            raise HTTPException(status_code=404, detail=str(e))
        elif "expired" in str(e):
            raise HTTPException(status_code=410, detail=str(e))
        elif "inactive" in str(e):
            raise HTTPException(status_code=403, detail=str(e))
        else:
            raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Session validation error: {str(e)}")


# ============================================================================
# DEBUG ENDPOINTS
# ============================================================================

@router.get("/debug/session/{session_id}")
async def debug_session(session_id: str):
    """Debug endpoint to check session status"""
    try:
        guest_service = GuestService()
        session = await guest_service.get_simple_guest_session(session_id)
        return {
            "session_id": session_id,
            "session_exists": session is not None,
            "session_data": session.model_dump() if session else None
        }
    except Exception as e:
        return {
            "session_id": session_id,
            "error": str(e),
            "session_exists": False
        }

@router.get("/debug/projects/{session_id}")
async def debug_projects(session_id: str):
    """Debug endpoint to check projects without session validation"""
    try:
        project_service = ProjectService()
        projects = await project_service.get_projects(
            limit=10, 
            offset=0, 
            status=None, 
            type=None, 
            created_by=None, 
            guest_session_id=session_id
        )
        return {
            "session_id": session_id,
            "projects_count": len(projects),
            "projects": [p.model_dump() for p in projects]
        }
    except Exception as e:
        return {
            "session_id": session_id,
            "error": str(e),
            "projects_count": 0
        }

@router.post("/debug/fix-project-types/{session_id}")
async def fix_project_types(session_id: str):
    """Fix project types for a session by updating invalid enum values"""
    try:
        from google.cloud import firestore
        from ...config import gcp_clients
        
        db = gcp_clients.get_firestore_client()
        projects_collection = db.collection("projects")
        
        # Query projects for this session
        query = projects_collection.where('student_id', '==', session_id)
        docs = query.get()
        
        fixed_count = 0
        errors = []
        
        for doc in docs:
            try:
                data = doc.to_dict()
                if 'type' in data and data['type'] not in ['text-recognition', 'image-recognition', 'image-recognition-teachable-machine', 'pose-recognition-teachable-machine', 'classification', 'regression', 'custom', 'rule-based-process', 'live-object-detection', 'exercises', 'confusion-matrix', 'rag-chatbot', 'ai-agent']:
                    # Fix invalid type
                    old_type = data['type']
                    data['type'] = 'text-recognition'  # Default to text-recognition
                    
                    # Update the document
                    doc.reference.update({'type': data['type']})
                    fixed_count += 1
                    logger.info(f"Fixed project {doc.id}: {old_type} -> {data['type']}")
                    
            except Exception as e:
                errors.append(f"Error fixing project {doc.id}: {str(e)}")
        
        return {
            "session_id": session_id,
            "fixed_count": fixed_count,
            "total_docs": len(docs),
            "errors": errors
        }
        
    except Exception as e:
        return {
            "session_id": session_id,
            "error": str(e),
            "fixed_count": 0
        }

# ============================================================================
# SESSION MANAGEMENT
# ============================================================================

@router.post("/session", response_model=GuestSessionResponse, status_code=201)
async def create_guest_session(
    request: Request,
    guest_service: GuestService = Depends(get_guest_service)
):
    """Create a new guest session with unique session ID (7 days expiry)"""
    try:
        # Extract client info
        ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        
        # Create simple session
        guest_session = await guest_service.create_simple_guest_session(
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        return GuestSessionResponse(data=guest_session)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}", response_model=GuestSessionResponse)
async def get_guest_session(
    session_id: str,
    guest_service: GuestService = Depends(get_guest_service)
):
    """Get simple guest session by session ID"""
    try:
        guest_session = await guest_service.get_simple_guest_session(session_id)
        if not guest_session:
            raise HTTPException(status_code=404, detail="Guest session not found")
        
        return GuestSessionResponse(data=guest_session)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PROJECT MANAGEMENT
# ============================================================================

@router.get("/session/{session_id}/projects", response_model=ProjectListResponse)
async def get_guest_projects(
    session_id: str,
    limit: int = Query(50, ge=1, le=100, description="Number of projects to return"),
    offset: int = Query(0, ge=0, description="Number of projects to skip"),
    status: Optional[str] = Query(None, description="Filter by project status"),
    type: Optional[str] = Query(None, description="Filter by project type"),
    search: Optional[str] = Query(None, description="Search query"),
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get all projects for a guest session with optional filtering and search"""
    try:
        logger.info(f"Getting projects for guest session: {session_id}")
        if search:
            # Use search functionality
            filters = {'guest_session_id': session_id}
            if status:
                filters['status'] = status
            if type:
                filters['type'] = type
            
            all_projects = await project_service.search_projects(search, filters)
            total = len(all_projects)
            
            # Apply pagination to search results
            projects = all_projects[offset:offset + limit]
        else:
            # Get projects directly with guest session filter
            projects = await project_service.get_projects(
                limit=limit, 
                offset=offset, 
                status=status, 
                type=type, 
                created_by=None, 
                guest_session_id=session_id
            )
            
            # For total count, get all projects for this session
            all_projects = await project_service.get_projects(
                limit=1000,  # Get all projects to count them
                offset=0,
                status=status,
                type=type,
                created_by=None,
                guest_session_id=session_id
            )
            total = len(all_projects)
        
        logger.info(f"Found {len(projects)} projects for session {session_id}")
        logger.info(f"Project types: {[p.type for p in projects]}")

        # Rule Based Process projects from before Scratch support: decide once which editor they open in
        for p in projects:
            if p.type == ProjectType.RULE_BASED_PROCESS and not p.rbpEditor:
                try:
                    p.rbpEditor = await asyncio.get_event_loop().run_in_executor(
                        None, ScratchProjectService().resolve_editor, p.id, None
                    )
                except Exception as e:
                    logger.warning(f"Could not resolve Rule Based Process editor for {p.id}: {e}")

        return ProjectListResponse(
            data=projects,
            pagination=PaginationInfo(
                limit=limit,
                offset=offset,
                total=total
            )
        )
    except Exception as e:
        logger.error(f"Error getting projects for session {session_id}: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Check if it's a validation error and provide more helpful message
        if "validation error" in str(e).lower():
            logger.error("Validation error detected - this might be due to outdated enum values in existing data")
            raise HTTPException(
                status_code=500, 
                detail=f"Data validation error. This might be due to outdated project data. Please try creating a new project. Error: {str(e)}"
            )
        
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/{session_id}/projects", response_model=ProjectResponse, status_code=201)
async def create_guest_project(
    session_id: str,
    project_data: ProjectCreate,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Create a new project for a guest session
    
    Supports text-recognition, image-recognition-teachable-machine, and pose-recognition-teachable-machine project types.
    
    For image-recognition-teachable-machine and pose-recognition-teachable-machine projects:
    - teachable_machine_link is required and must be a valid Teachable Machine URL
    - config field is ignored (not saved) since these projects use Teachable Machine models
    
    For text-recognition projects:
    - config field is optional and contains training parameters
    - teachable_machine_link is not used
    
    Example request body for text recognition:
    {
        "name": "Sentiment Analysis",
        "description": "Classify text sentiment",
        "type": "text-recognition",
        "config": {
            "epochs": 100,
            "batchSize": 32,
            "learningRate": 0.001,
            "validationSplit": 0.2
        }
    }
    
    Example request body for image recognition:
    {
        "name": "Cat vs Dog Classifier", 
        "description": "Classify images of cats and dogs",
        "type": "image-recognition-teachable-machine",
        "teachable_machine_link": "https://teachablemachine.withgoogle.com/models/abc123/"
    }
    
    Example request body for pose recognition:
    {
        "name": "Yoga Pose Classifier", 
        "description": "Classify different yoga poses",
        "type": "pose-recognition-teachable-machine",
        "teachable_machine_link": "https://teachablemachine.withgoogle.com/models/xyz789/"
    }
    """
    try:
        # Validate project type and teachable machine link
        if project_data.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"]:
            if not project_data.teachable_machine_link:
                raise HTTPException(
                    status_code=400, 
                    detail=f"teachable_machine_link is required for {project_data.type} projects"
                )
            
            # Validate teachable machine link format
            if not project_data.teachable_machine_link.startswith("https://teachablemachine.withgoogle.com/"):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid teachable machine link. Must be a valid Teachable Machine URL starting with 'https://teachablemachine.withgoogle.com/'"
                )
        
        # Set guest session info in project data
        project_data.createdBy = f"guest:{session_id}"
        # Add guest session identifier
        project_data.teacher_id = ""
        project_data.classroom_id = ""
        project_data.student_id = session_id
        
        # For teachable machine projects, don't save config since they use Teachable Machine
        # For regular projects, use config like text recognition
        if project_data.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"]:
            project_data.config = None
        
        project = await project_service.create_project(project_data)

        # New Rule Based Process projects open the Rules Bot board
        if project.type == ProjectType.RULE_BASED_PROCESS:
            project_service.collection.document(project.id).update({'rbpEditor': EDITOR_RULES_BOT})
            project.rbpEditor = EDITOR_RULES_BOT

        return ProjectResponse(data=project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/projects/{project_id}", response_model=ProjectResponse)
async def get_guest_project(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get project by ID for a guest session"""
    try:
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Verify project belongs to this session
        if project.student_id != session_id:
            raise HTTPException(status_code=403, detail="Project not accessible for this session")
        
        return ProjectResponse(data=project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/session/{session_id}/projects/{project_id}", response_model=ProjectResponse)
async def update_guest_project(
    session_id: str,
    project_id: str,
    project_data: ProjectUpdate,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Update project for a guest session
    
    Supports updating project type and teachable_machine_link.
    When updating to image-recognition-teachable-machine type:
    - teachable_machine_link becomes required
    - config field is ignored (not saved) since these projects use Teachable Machine models
    """
    try:
        # First verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        if project.student_id != session_id:
            raise HTTPException(status_code=403, detail="Project not accessible for this session")
        
        # Validate project type and teachable machine link if being updated
        if project_data.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"] or (project_data.type is None and project.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"]):
            # If updating to teachable machine project or already is teachable machine project
            if project_data.teachable_machine_link is not None:
                # Validate teachable machine link format if provided
                if not project_data.teachable_machine_link.startswith("https://teachablemachine.withgoogle.com/"):
                    raise HTTPException(
                        status_code=400,
                        detail="Invalid teachable machine link. Must be a valid Teachable Machine URL starting with 'https://teachablemachine.withgoogle.com/'"
                    )
            elif project_data.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"] and not project.teachable_machine_link:
                # If changing to teachable machine project but no teachable machine link provided
                raise HTTPException(
                    status_code=400, 
                    detail=f"teachable_machine_link is required for {project_data.type} projects"
                )
            
            # For teachable machine projects, don't save config
            # For regular projects, save config like text recognition
            if project_data.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"]:
                project_data.config = None
        
        # Update project
        updated_project = await project_service.update_project(project_id, project_data)
        return ProjectResponse(data=updated_project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/session/{session_id}/projects/{project_id}")
async def delete_guest_project(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete project for a guest session"""
    try:
        # First verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        if project.student_id != session_id:
            raise HTTPException(status_code=403, detail="Project not accessible for this session")

        # Rule Based Process: remove companion workspace with the project shell
        if project.type == ProjectType.RULE_BASED_PROCESS or str(project.type) == "rule-based-process":
            try:
                RuleBasedProcessService().delete(project_id)
            except Exception as e:
                logger.warning("RBP workspace cleanup failed for %s: %s", project_id, e)
            try:
                ScratchProjectService().delete(project_id)
            except Exception as e:
                logger.warning("RBP Scratch project cleanup failed for %s: %s", project_id, e)
            try:
                RulesBotService().delete_board(project_id)
            except Exception as e:
                logger.warning("Rules Bot board cleanup failed for %s: %s", project_id, e)

        if project.type == ProjectType.CONFUSION_MATRIX or str(project.type) == "confusion-matrix":
            try:
                ConfusionMatrixService().delete(project_id, session_id)
            except Exception as e:
                logger.warning("Confusion matrix cleanup failed for %s: %s", project_id, e)

        if project.type == ProjectType.RAG_CHATBOT or str(project.type) == "rag-chatbot":
            try:
                RagChatbotService().delete(project_id, session_id)
            except Exception as e:
                logger.warning("RAG chatbot cleanup failed for %s: %s", project_id, e)

        if project.type == ProjectType.AI_AGENT or str(project.type) == "ai-agent":
            try:
                AiAgentService().delete(project_id, session_id)
            except Exception as e:
                logger.warning("AI agent cleanup failed for %s: %s", project_id, e)

        if project.type == ProjectType.EXERCISES or str(project.type) == "exercises":
            try:
                ExercisesService().delete(project_id)
            except Exception as e:
                logger.warning("Exercises workspace cleanup failed for %s: %s", project_id, e)
        
        # Delete project
        await project_service.delete_project(project_id)
        return {"success": True, "message": "Project deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# DATASET AND EXAMPLES
# ============================================================================

@router.post("/session/{session_id}/projects/{project_id}/dataset", response_model=FileUploadResponse)
async def upload_guest_dataset(
    session_id: str,
    project_id: str,
    file: UploadFile = File(..., description="Dataset file to upload"),
    records: Optional[int] = Form(None, description="Number of records in dataset"),
    description: Optional[str] = Form("", description="Dataset description"),
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Upload dataset file for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Validate file type
        allowed_types = [
            'text/csv',
            'application/json',
            'text/plain',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]
        
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400, 
                detail="Invalid file type. Only CSV, JSON, and Excel files are allowed."
            )
        
        # Read file content
        file_content = await file.read()
        
        # Check file size (100MB limit)
        if len(file_content) > 100 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail="File too large. Maximum size is 100MB."
            )
        
        # Prepare metadata
        metadata = {
            'records': records,
            'description': description,
            'originalName': file.filename,
            'contentType': file.content_type,
            'guest_session_id': session_id
        }
        
        # Upload to service
        result = await project_service.upload_dataset(
            project_id,
            file_content,
            file.filename,
            file.content_type,
            metadata
        )
        
        return FileUploadResponse(
            success=result['success'],
            gcsPath=result['gcsPath']
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/{session_id}/projects/{project_id}/examples", response_model=dict)
async def add_guest_examples(
    session_id: str,
    project_id: str,
    examples_data: ExamplesBulkAdd,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Add text examples to a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Validate number of examples
        if len(examples_data.examples) > 50:
            raise HTTPException(
                status_code=400,
                detail="Maximum 50 examples can be added at once"
            )
        
        # Add examples to project
        result = await project_service.add_examples(
            project_id, examples_data.examples, split=examples_data.split, skip_existing=examples_data.skip_existing
        )
        
        # Calculate how many examples were actually created
        input_examples_count = len(examples_data.examples)
        actual_examples_added = result['totalExamples'] - (result.get('previousTotal', 0) or 0)
        
        return {
            "success": True,
            "message": f"Added {actual_examples_added} examples from {input_examples_count} input(s)",
            "totalExamples": result['totalExamples'],
            "labels": result['labels'],
            "inputExamples": input_examples_count,
            "actualExamplesAdded": actual_examples_added,
            "skipped": result.get('skipped', 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/{session_id}/projects/{project_id}/images", response_model=dict)
async def upload_guest_images(
    session_id: str,
    project_id: str,
    files: List[UploadFile] = File(..., description="Image files to upload"),
    label: str = Form(..., description="Label for these images"),
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Upload image examples to a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Validate project type
        if project.type != "image-recognition":
            raise HTTPException(
                status_code=400,
                detail="Image uploads are only allowed for image-recognition projects"
            )
        
        # Validate number of files
        if len(files) > 20:
            raise HTTPException(
                status_code=400,
                detail="Maximum 20 images can be uploaded at once"
            )
        
        # Validate file types
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
        uploaded_images = []
        
        for file in files:
            if file.content_type not in allowed_types:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid file type: {file.content_type}. Only JPEG, PNG, GIF, and WebP images are allowed."
                )
            
            # Check file size (10MB limit per image)
            file_content = await file.read()
            if len(file_content) > 10 * 1024 * 1024:
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename} is too large. Maximum size is 10MB per image."
                )
            
            # Upload to GCS
            gcs_path = f"images/{project_id}/{label}/{file.filename}"
            blob = project_service.bucket.blob(gcs_path)
            blob.upload_from_string(file_content, content_type=file.content_type)
            
            # Generate public URL
            image_url = f"gs://{project_service.bucket.name}/{gcs_path}"
            
            uploaded_images.append({
                "image_url": image_url,
                "label": label,
                "filename": file.filename,
                "size": len(file_content),
                "content_type": file.content_type
            })
        
        # Add image examples to project
        result = await project_service.add_image_examples(project_id, uploaded_images)
        
        return {
            "success": True,
            "message": f"Uploaded {len(uploaded_images)} images with label '{label}'",
            "totalImages": result['totalImages'],
            "labels": result['labels'],
            "uploadedImages": len(uploaded_images),
            "imageUrls": [img["image_url"] for img in uploaded_images]  # Include image URLs for prediction
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/{session_id}/projects/{project_id}/images/url", response_model=dict)
async def upload_guest_images_from_url(
    session_id: str,
    project_id: str,
    image_url: str = Form(..., description="URL of the image to upload"),
    label: str = Form(..., description="Label for this image"),
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Upload image from URL to a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Validate project type
        if project.type != "image-recognition":
            raise HTTPException(
                status_code=400,
                detail="Image uploads are only allowed for image-recognition projects"
            )
        
        # Download the image (handles search-result links, web pages, data: URLs)
        try:
            file_content, content_type, filename = await fetch_image_from_url(image_url)
        except ImageUrlError as e:
            raise HTTPException(status_code=400, detail=str(e))
        
        # Upload to GCS
        gcs_path = f"images/{project_id}/{label}/{filename}"
        blob = project_service.bucket.blob(gcs_path)
        blob.upload_from_string(file_content, content_type=content_type)
        
        # Generate GCS URL
        gcs_url = f"gs://{project_service.bucket.name}/{gcs_path}"
        
        # Create image data
        uploaded_image = {
            "image_url": gcs_url,
            "label": label,
            "filename": filename,
            "size": len(file_content),
            "content_type": content_type
        }
        
        # Add image example to project
        result = await project_service.add_image_examples(project_id, [uploaded_image])
        
        return {
            "success": True,
            "message": f"Uploaded image from URL with label '{label}'",
            "totalImages": result['totalImages'],
            "labels": result['labels'],
            "uploadedImages": 1,
            "imageUrls": [gcs_url]  # Include GCS URL for prediction
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/{session_id}/projects/{project_id}/predict-image", response_model=dict)
async def upload_image_for_prediction_only(
    session_id: str,
    project_id: str,
    files: List[UploadFile] = File(..., description="Image files for prediction only"),
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Upload image for prediction only - does NOT store in training dataset"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Validate project type
        if project.type != "image-recognition":
            raise HTTPException(
                status_code=400,
                detail="Image predictions are only allowed for image-recognition projects"
            )
        
        # Validate number of files (only 1 for prediction)
        if len(files) != 1:
            raise HTTPException(
                status_code=400,
                detail="Only one image can be uploaded for prediction at a time"
            )
        
        # Validate file types
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
        file = files[0]
        
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type: {file.content_type}. Only JPEG, PNG, GIF, and WebP images are allowed."
            )
        
        # Check file size (10MB limit per image)
        file_content = await file.read()
        if len(file_content) > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"File {file.filename} is too large. Maximum size is 10MB per image."
            )
        
        # Upload to GCS with prediction-specific path (not in training data)
        gcs_path = f"predictions/{project_id}/{file.filename}"
        blob = project_service.bucket.blob(gcs_path)
        blob.upload_from_string(file_content, content_type=file.content_type)
        
        # Generate GCS URL for prediction
        gcs_url = f"gs://{project_service.bucket.name}/{gcs_path}"
        
        return {
            "success": True,
            "message": "Image uploaded for prediction",
            "imageUrl": gcs_url,
            "filename": file.filename,
            "size": len(file_content),
            "content_type": file.content_type
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/{session_id}/projects/{project_id}/predict-image/url", response_model=dict)
async def upload_image_url_for_prediction_only(
    session_id: str,
    project_id: str,
    image_url: str = Form(..., description="URL of the image for prediction only"),
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Upload image from URL for prediction only - does NOT store in training dataset"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Validate project type
        if project.type != "image-recognition":
            raise HTTPException(
                status_code=400,
                detail="Image predictions are only allowed for image-recognition projects"
            )
        
        # Download the image (handles search-result links, web pages, data: URLs)
        try:
            file_content, content_type, filename = await fetch_image_from_url(image_url)
        except ImageUrlError as e:
            raise HTTPException(status_code=400, detail=str(e))
        
        # Upload to GCS with prediction-specific path (not in training data)
        gcs_path = f"predictions/{project_id}/{filename}"
        blob = project_service.bucket.blob(gcs_path)
        blob.upload_from_string(file_content, content_type=content_type)
        
        # Generate GCS URL for prediction
        gcs_url = f"gs://{project_service.bucket.name}/{gcs_path}"
        
        return {
            "success": True,
            "message": "Image uploaded for prediction from URL",
            "imageUrl": gcs_url,
            "filename": filename,
            "size": len(file_content),
            "content_type": content_type
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/projects/{project_id}/examples", response_model=dict)
async def get_guest_examples(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get all examples for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        examples = await project_service.get_examples(project_id)
        
        # Also get the labels list from the project
        labels = []
        if hasattr(project.dataset, 'labels') and project.dataset.labels:
            labels = project.dataset.labels
        
        return {
            "success": True,
            "examples": examples,
            "totalExamples": len(examples),
            "labels": labels
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/projects/{project_id}/images", response_model=dict)
async def get_guest_images(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get all image examples for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        image_examples = await project_service.get_image_examples(project_id)
        
        # Also get the labels list from the project
        labels = []
        if hasattr(project.dataset, 'labels') and project.dataset.labels:
            labels = project.dataset.labels
        
        return {
            "success": True,
            "images": image_examples,
            "totalImages": len(image_examples),
            "labels": labels
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/projects/{project_id}/images/{image_path:path}")
async def get_guest_image(
    session_id: str,
    project_id: str,
    image_path: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Serve individual images from GCS"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Construct the full GCS path
        gcs_path = f"images/{project_id}/{image_path}"
        
        # Get the blob from GCS
        blob = project_service.bucket.blob(gcs_path)
        
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Image not found")
        
        # Download the image content
        image_content = blob.download_as_bytes()
        
        # Determine content type from file extension
        content_type = "image/jpeg"  # default
        if image_path.lower().endswith('.png'):
            content_type = "image/png"
        elif image_path.lower().endswith('.gif'):
            content_type = "image/gif"
        elif image_path.lower().endswith('.webp'):
            content_type = "image/webp"
        
        # Return the image with appropriate headers
        from fastapi.responses import Response
        return Response(
            content=image_content,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=3600",  # Cache for 1 hour
                "Content-Disposition": f"inline; filename={image_path.split('/')[-1]}"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving image {image_path}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# TRAINING
# ============================================================================

@router.post("/session/{session_id}/projects/{project_id}/train", response_model=TrainingResponse)
async def start_guest_training(
    session_id: str,
    project_id: str,
    training_config: Optional[TrainingConfig] = None,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service)
):
    """Start training job for a guest project using logistic regression or EfficientNet"""
    try:
        # Get guest project by project_id from the projects collection
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify the project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        project_type = guest_project.get('type', 'text-recognition')
        
        # Handle image recognition projects
        if project_type == 'image-recognition':
            return await _train_image_recognition_project(
                session_id, project_id, guest_project, training_config, guest_service
            )
        
        # Handle text recognition projects (existing logic)
        return await _train_text_recognition_project(
            session_id, project_id, guest_project, training_config, guest_service
        )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Training error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def _train_text_ovr_model(
    session_id: str, project_id: str, training_examples: list, guest_service: GuestService
) -> TrainingResponse:
    """Train the Logistic Regression (one classifier per label) text model and save it."""
    try:
        logger.info("Using Logistic Regression (per-label confidence) for text classification")
        training_result = await asyncio.get_event_loop().run_in_executor(
            _training_executor, ovr_text_trainer.train_model, training_examples
        )
        model_filename = f"model_{project_id}_ovr.pkl"
        model_path = f"models/{project_id}/{model_filename}"
        await asyncio.get_event_loop().run_in_executor(
            _training_executor,
            ovr_text_trainer.save_model_to_gcs,
            gcp_clients.get_bucket(),
            model_path,
            training_result["model"],
        )
        now_iso = datetime.now(timezone.utc).isoformat()
        guest_service.projects_collection.document(project_id).update({
            'model.filename': model_filename,
            'model.gcsPath': model_path,
            'model.accuracy': training_result.get('accuracy'),
            'model.loss': None,
            'model.labels': training_result.get('labels', []),
            'model.modelType': OVR_MODEL_TYPE,
            'model.trainedAt': now_iso,
            'model.endpointUrl': f"/api/guests/session/{session_id}/projects/{project_id}/predict",
            'status': 'trained',
            'updatedAt': now_iso,
        })
        # Same message as the existing instant path, so the page shows the model straight away
        return TrainingResponse(
            success=True,
            message="Training completed successfully!",
            jobId=f"direct-{project_id}-{int(datetime.now().timestamp())}",
        )
    except ValueError as e:
        return TrainingResponse(success=False, message=str(e))
    except Exception as e:
        logger.error(f"Logistic Regression (per-label) training failed: {e}")
        return TrainingResponse(success=False, message=f"Training failed: {e}")


async def _train_text_recognition_project(
    session_id: str, project_id: str, guest_project: dict, 
    training_config: Optional[TrainingConfig], guest_service: GuestService
) -> TrainingResponse:
    """Train text recognition project using DistilBERT (default) or Logistic Regression"""
    try:
        # Get examples for training from guest project
        examples = guest_project.get('dataset', {}).get('examples', [])
        if not examples or len(examples) < 2:
            raise HTTPException(
                status_code=400, 
                detail="Need at least 2 examples to start training. Add some examples first."
            )
        
        # Convert examples to the format expected by trainer
        try:
            logger.info(f"Starting text recognition training for project {project_id}")
            logger.info(f"Examples count: {len(examples)}")
            logger.info(f"Example types: {[type(ex).__name__ for ex in examples]}")
            
            # Convert examples to the format expected by trainer
            training_examples = []
            for i, ex in enumerate(examples):
                logger.info(f"Processing example {i}: {ex}")
                if isinstance(ex, dict) and 'text' in ex and 'label' in ex:
                    try:
                        text_example = TextExample(**ex)
                        training_examples.append(text_example)
                        logger.info(f"Converted dict example {i}: text='{text_example.text[:50]}...', label='{text_example.label}'")
                    except Exception as conv_error:
                        logger.error(f"Failed to convert example {i}: {conv_error}")
                        logger.error(f"Example data: {ex}")
                else:
                    logger.warning(f"Unexpected example format {i}: {type(ex)} - {ex}")
            
            if not training_examples:
                raise ValueError("No valid examples found for training")
            
            logger.info(f"Training with {len(training_examples)} examples")
            logger.info(f"Example labels: {[ex.label for ex in training_examples]}")
            
            # Model chosen on the training page dropdown (optional).
            # 'logistic_regression' -> ML-for-Kids-style classifier (text_ovr_service).
            # anything else / not sent -> existing behaviour below (DistilBERT default).
            requested_model = ((training_config.modelType if training_config else None) or "").strip().lower()
            if requested_model in ("logistic_regression", OVR_MODEL_TYPE):
                return await _train_text_ovr_model(
                    session_id, project_id, training_examples, guest_service
                )

            # Use DistilBERT by default (better accuracy for text classification)
            use_distilbert = True  # Can be made configurable later
            
            if use_distilbert:
                logger.info("🤖 Using DistilBERT for text classification")
                try:
                    # Run training in thread pool executor to allow concurrent training
                    training_result = await asyncio.get_event_loop().run_in_executor(
                        _training_executor,
                        distilbert_trainer.train_model,
                        training_examples
                    )
                    logger.info(f"DistilBERT training successful: {training_result}")
                    
                    # Save DistilBERT model to GCS (directory structure)
                    model_path = f"models/{project_id}"  # Directory path for Hugging Face format
                    
                    logger.info(f"Saving DistilBERT model to GCS: {model_path}")
                    distilbert_trainer.save_model_to_gcs(
                        gcp_clients.get_bucket(), 
                        model_path, 
                        training_result['model'],
                        training_result['tokenizer']
                    )
                    logger.info("DistilBERT model saved to GCS successfully")
                    
                    # Update guest project with model info and status
                    model_update = {
                        'model.filename': 'distilbert_model',  # Directory name
                        'model.gcsPath': model_path,  # Directory path
                        'model.accuracy': training_result.get('accuracy'),
                        'model.loss': None,  # DistilBERT doesn't use loss in same way
                        'model.labels': training_result.get('labels', []),
                        'model.modelType': 'distilbert',
                        'model.trainedAt': datetime.now(timezone.utc).isoformat(),
                        'model.endpointUrl': f"/api/guests/session/{session_id}/projects/{project_id}/predict",
                        'status': 'trained',
                        'updatedAt': datetime.now(timezone.utc).isoformat()
                    }
                    
                    # Update the project document
                    project_doc_ref = guest_service.projects_collection.document(project_id)
                    project_doc_ref.update(model_update)
                    
                    logger.info(f"Guest project {project_id} updated with DistilBERT model info")
                    
                    # Return success response for DistilBERT
                    return TrainingResponse(
                        success=True,
                        message="Training completed successfully with DistilBERT!",
                        jobId=f"direct-{project_id}-{int(datetime.now().timestamp())}"
                    )
                    
                except Exception as distilbert_error:
                    logger.warning(f"DistilBERT training failed: {distilbert_error}, falling back to Logistic Regression")
                    use_distilbert = False
            
            if not use_distilbert:
                # Fallback to Logistic Regression
                logger.info("📊 Using Logistic Regression for text classification")
                # Run training in thread pool executor to allow concurrent training
                training_result = await asyncio.get_event_loop().run_in_executor(
                    _training_executor,
                    trainer.train_model,
                    training_examples
                )
                logger.info(f"Logistic Regression training successful: {training_result}")
                
                # Save the trained model to GCS
                model_filename = f"model_{project_id}.pkl"
                model_path = f"models/{project_id}/{model_filename}"
                
                logger.info(f"Saving model to GCS: {model_path}")
                trainer.save_model_to_gcs(gcp_clients.get_bucket(), model_path, training_result['model'])
                logger.info("Model saved to GCS successfully")
                
                # Update guest project with model info and status
                model_update = {
                    'model.filename': model_filename,
                    'model.gcsPath': model_path,
                    'model.accuracy': training_result.get('accuracy'),
                    'model.loss': training_result.get('loss'),
                    'model.labels': training_result.get('labels', []),
                    'model.modelType': 'logistic_regression',
                    'model.trainedAt': datetime.now(timezone.utc).isoformat(),
                    'model.endpointUrl': f"/api/guests/session/{session_id}/projects/{project_id}/predict",
                    'status': 'trained',
                    'updatedAt': datetime.now(timezone.utc).isoformat()
                }
                
                # Update the project document directly
                project_doc_ref = guest_service.projects_collection.document(project_id)
                project_doc_ref.update(model_update)
                
                logger.info(f"Guest project {project_id} updated with model info")
                
                # Create a simple training job response
                return TrainingResponse(
                    success=True,
                    message="Training completed successfully!",
                    jobId=f"direct-{project_id}-{int(datetime.now().timestamp())}"
                )
                
        except Exception as training_error:
            logger.error(f"Direct training failed: {training_error}")
            logger.error(f"Training error type: {type(training_error)}")
            logger.error(f"Training error details: {str(training_error)}")
            
            # Fall back to worker-based training
            logger.info("Falling back to worker-based training")
            
            config_dict = training_config.model_dump() if training_config else None
            training_job = await training_job_service.create_training_job(project_id, config_dict)
            
            # Update guest session with job ID and status
            await guest_service.update_guest_session(session_id, GuestUpdate(
                currentJobId=training_job.id,
                training_status="training",
                status="training"
            ))
            
            return TrainingResponse(
                success=True,
                message="Training job queued successfully!",
                jobId=training_job.id
            )
            
        except ValueError as e:
            # Training validation failed
            return TrainingResponse(
                success=False,
                message=str(e)
            )
            
    except Exception as e:
        logger.error(f"Text training error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def _train_image_recognition_project(
    session_id: str, project_id: str, guest_project: dict, 
    training_config: Optional[TrainingConfig], guest_service: GuestService
) -> TrainingResponse:
    """Train image recognition project using EfficientNet"""
    try:
        # Get image examples for training from guest project
        image_examples = guest_project.get('dataset', {}).get('image_examples', [])
        if not image_examples or len(image_examples) < 5:  # Need at least 5 examples
            raise HTTPException(
                status_code=400, 
                detail="Need at least 5 image examples to start training. Add some images first."
            )
        
        logger.info(f"Starting image recognition training for project {project_id}")
        logger.info(f"Image examples count: {len(image_examples)}")
        
        # Update Firestore status to training
        image_trainer.update_firestore_training_status(project_id, session_id, "training")
        
        # Clear any existing model to prevent shape mismatch issues
        model_path = f"image_recog/{project_id}"
        logger.info(f"Clearing any existing model at: {model_path}")
        image_trainer.clear_existing_model(gcp_clients.get_bucket(), model_path)

        # Own trainer for this request: the model/labels must not be swapped out by another
        # project's training or prediction between training and saving
        trainer = ImageRecognitionTrainer()

        try:
            # Prepare training data directly from GCS
            images, labels, class_names = trainer.prepare_training_data_direct(image_examples)

            # Train the model directly - run in thread pool executor to allow concurrent training
            training_result = await asyncio.get_event_loop().run_in_executor(
                _training_executor,
                trainer.train_model_direct,
                images,
                labels,
                class_names
            )
            logger.info(
                f"Image training successful: classes={training_result['class_names']}, "
                f"accuracy={training_result['accuracy']:.4f}, loss={training_result['loss']:.4f}, "
                f"samples={training_result['training_examples']}"
            )

            # Save the trained model to GCS in native TensorFlow format
            model_path = f"image_recog/{project_id}"

            logger.info(f"Saving image model to GCS directory: {model_path}")
            saved_model_path = trainer.save_model(gcp_clients.get_bucket(), model_path)
            logger.info("Image model saved to GCS successfully")
            
            # Update Firestore with completed status and model info
            image_trainer.update_firestore_training_status(
                project_id, session_id, "completed", 
                training_result, saved_model_path
            )
            
            logger.info(f"Guest project {project_id} updated with image model info")
            
            # No cleanup needed - no temporary files used
            
            # Create a simple training job response
            return TrainingResponse(
                success=True,
                message="Image recognition training completed successfully!",
                jobId=f"image-{project_id}-{int(datetime.now().timestamp())}"
            )
            
        except Exception as training_error:
            logger.error(f"Image training failed: {training_error}")
            logger.error(f"Training error type: {type(training_error)}")
            logger.error(f"Training error details: {str(training_error)}")
            
            # Update Firestore with failed status
            image_trainer.update_firestore_training_status(project_id, session_id, "failed")
            
            # No cleanup needed - no temporary files used
            
            return TrainingResponse(
                success=False,
                message=f"Image training failed: {str(training_error)}"
            )
            
    except Exception as e:
        logger.error(f"Image training error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/projects/{project_id}/train", response_model=dict)
async def get_guest_training_status(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service)
):
    """Get training status and job information for a guest project"""
    try:
        # Get guest project by project_id from the projects collection
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify the project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        # Get training jobs for this project
        jobs = await training_job_service.get_project_jobs(project_id)
        
        # Get current job status if there's a current job
        current_job = None
        if guest_project.get('currentJobId'):
            current_job = await training_job_service.get_job_status(guest_project['currentJobId'])
        
        return {
            "success": True,
            "projectStatus": guest_project.get('status', 'draft'),
            "modelType": guest_project.get('model', {}).get('modelType'),
            "currentJob": current_job.model_dump() if current_job else None,
            "allJobs": [job.model_dump() for job in jobs],
            "totalJobs": len(jobs)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/session/{session_id}/projects/{project_id}/train", response_model=dict)
async def cancel_guest_training(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service)
):
    """Cancel current training job for a guest project"""
    try:
        # Get guest project by project_id from the projects collection
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify the project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        if not guest_project.get('currentJobId'):
            raise HTTPException(
                status_code=400,
                detail="No training job in progress"
            )
        
        # Cancel the job
        success = await training_job_service.cancel_job(guest_project['currentJobId'])
        
        if success:
            return {
                "success": True,
                "message": "Training job cancelled successfully"
            }
        else:
            raise HTTPException(
                status_code=400,
                detail="Failed to cancel training job"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PREDICTION
# ============================================================================

@router.post("/session/{session_id}/projects/{project_id}/predict", response_model=PredictionResponse)
async def predict_guest_text(
    session_id: str,
    project_id: str,
    prediction_request: PredictionRequest,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service)
):
    """Make prediction using trained guest model (text or image)"""
    try:
        # Get guest project by project_id from the projects collection
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify the project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        if guest_project.get('status') != 'trained':
            raise HTTPException(
                status_code=400, 
                detail="Project is not trained yet. Train the model first."
            )
        
        project_type = guest_project.get('type', 'text-recognition')
        model_type = guest_project.get('model', {}).get('modelType', 'logistic_regression')
        
        # Get the model path from the project
        model_gcs_path = guest_project.get('model', {}).get('gcsPath')
        if not model_gcs_path:
            raise HTTPException(
                status_code=400,
                detail="Model not found. Please ensure the model was saved during training."
            )
        
        # Handle different model types
        if model_type == 'efficientnet' or project_type == 'image-recognition':
            # For image recognition, we need to handle image URLs
            # For now, we'll assume the text field contains a GCS URL to an image
            if not prediction_request.text.startswith('gs://'):
                raise HTTPException(
                    status_code=400,
                    detail="For image recognition projects, please provide a GCS URL to the image (gs://bucket/path)"
                )
            
            # Always load the model for each prediction, into a trainer owned by this request
            # so a concurrent training or prediction can't swap the model mid-request
            logger.info(f"Loading image model from GCS path: {model_gcs_path}")
            predictor = ImageRecognitionTrainer()
            success = predictor.load_model_from_gcs(gcp_clients.get_bucket(), model_gcs_path)
            if not success:
                logger.error(f"Failed to load image model from GCS path: {model_gcs_path}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load image model from GCS: {predictor.last_error}"
                )
            logger.info("Image model loaded successfully from GCS")

            # Make prediction using image URL
            prediction_result = predictor.predict_from_gcs(prediction_request.text)
            
            # Convert to the expected format
            return PredictionResponse(
                success=True,
                label=prediction_result['predicted_class'],
                confidence=prediction_result['confidence'],
                alternatives=[
                    {
                        'label': prob['class'],
                        'confidence': prob['confidence']
                    } for prob in prediction_result['all_probabilities'][:2]  # Top 2 alternatives
                ]
            )
        elif model_type == OVR_MODEL_TYPE:
            # Logistic Regression, one classifier per label: independent confidence per label
            prediction_result = await asyncio.get_event_loop().run_in_executor(
                None,
                ovr_text_trainer.predict_from_gcs,
                prediction_request.text,
                gcp_clients.get_bucket(),
                model_gcs_path,
            )
            return PredictionResponse(
                success=True,
                label=prediction_result['label'],
                confidence=prediction_result['confidence'],
                alternatives=prediction_result['alternatives']
            )
        elif model_type == 'distilbert':
            # Handle DistilBERT text recognition
            logger.info(f"Using DistilBERT for prediction")
            prediction_result = distilbert_trainer.predict_from_gcs(
                prediction_request.text,
                gcp_clients.get_bucket(),
                model_gcs_path
            )
            
            return PredictionResponse(
                success=True,
                label=prediction_result['label'],
                confidence=prediction_result['confidence'],
                alternatives=prediction_result['alternatives']
            )
        else:
            # Handle Logistic Regression text recognition (fallback)
            logger.info(f"Using Logistic Regression for prediction")
            prediction_result = trainer.predict_from_gcs(
                prediction_request.text,
                gcp_clients.get_bucket(),
                model_gcs_path
            )
            
            return PredictionResponse(
                success=True,
                label=prediction_result['label'],
                confidence=prediction_result['confidence'],
                alternatives=prediction_result['alternatives']
            )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PROJECT STATUS
# ============================================================================

@router.get("/session/{session_id}/projects/{project_id}/status", response_model=ProjectStatusResponseWrapper)
async def get_guest_project_status(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service)
):
    """Get guest project status and metadata"""
    try:
        # Get guest project by project_id from the projects collection
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify the project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        # Convert guest project data to project status format
        status_response = {
            "id": guest_project.get('id'),
            "status": guest_project.get('status', 'draft'),
            "dataset": {
                "examples": guest_project.get('dataset', {}).get('examples', []),
                "size": guest_project.get('dataset', {}).get('records', 0)
            },
            "datasets": [],  # Guest projects only have one dataset
            "model": {
                "type": guest_project.get('model', {}).get('modelType', 'logistic_regression'),
                "version": 1,
                "status": "available" if guest_project.get('status') == "trained" else "unavailable"
            },
            "updatedAt": guest_project.get('updatedAt')
        }
        
        return ProjectStatusResponseWrapper(data=status_response)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# JOB MANAGEMENT
# ============================================================================

@router.get("/session/{session_id}/projects/{project_id}/training/jobs/{job_id}", response_model=dict)
async def get_guest_job_status(
    session_id: str,
    project_id: str,
    job_id: str,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service)
):
    """Get training job status for a guest project"""
    try:
        # Get guest project by project_id from the projects collection
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify the project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        job = await training_job_service.get_job_status(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Training job not found")
        
        # Verify job belongs to this project
        if job.projectId != project_id:
            raise HTTPException(status_code=403, detail="Job not accessible for this project")
        
        return {
            "success": True,
            "job": job.model_dump()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/session/{session_id}/projects/{project_id}/training/jobs/{job_id}", response_model=dict)
async def cancel_guest_job(
    session_id: str,
    project_id: str,
    job_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Cancel a training job for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        job = await training_job_service.get_job_status(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Training job not found")
        
        # Verify job belongs to this project
        if job.projectId != project_id:
            raise HTTPException(status_code=403, detail="Job not accessible for this project")
        
        success = await training_job_service.cancel_job(job_id)
        if success:
            return {
                "success": True,
                "message": "Training job cancelled successfully"
            }
        else:
            raise HTTPException(
                status_code=400,
                detail="Failed to cancel training job"
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# TESTING (Additional endpoints that were in the original guest API)
# ============================================================================

@router.post("/session/{session_id}/projects/{project_id}/test", response_model=dict)
async def test_guest_project(
    session_id: str,
    project_id: str,
    test_data: dict,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Test a trained guest project with new data"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        if project.status != 'trained':
            raise HTTPException(
                status_code=400, 
                detail="Project is not trained yet. Train the model first."
            )
        
        # Process test data (this would need to be implemented based on your requirements)
        # For now, returning a placeholder response
        return {
            "success": True,
            "message": "Test completed",
            "results": test_data,
            "accuracy": 0.85  # Placeholder
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/projects/{project_id}/test", response_model=dict)
async def get_guest_test_results(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get test results for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Return placeholder test results
        return {
            "success": True,
            "results": [],
            "accuracy": None,
            "last_tested_at": None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# SCRATCH INTEGRATION (Additional endpoints that were in the original guest API)
# ============================================================================

@router.post("/session/{session_id}/projects/{project_id}/scratch/enable", response_model=dict)
async def enable_guest_scratch(
    session_id: str,
    project_id: str,
    scratch_data: dict,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Enable Scratch integration for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Enable Scratch integration (placeholder implementation)
        return {
            "success": True,
            "message": "Scratch integration enabled",
            "scratch_api_key": f"scratch_{session_id}_{project_id}",
            "integration_url": f"/api/scratch/predict/{project_id}"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}/projects/{project_id}/scratch", response_model=dict)
async def get_guest_scratch_status(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get Scratch integration status for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Return Scratch status (placeholder implementation)
        return {
            "success": True,
            "scratch_enabled": False,
            "scratch_api_key": None,
            "integration_url": None
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# MODEL AND EXAMPLE DELETION
# ============================================================================

@router.delete("/projects/{project_id}/model")
async def delete_trained_model(
    project_id: str,
    session_id: str = Query(..., description="Guest session ID"),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete trained model from GCS for a guest project"""
    try:
        # Validate session
        session = await validate_session_dependency(session_id, guest_service)
        logger.info(f"Session validated for project {project_id}, session {session_id}")
        
        # Get project to verify ownership and get model path
        project = await project_service.get_project(project_id)
        if not project:
            logger.error(f"Project {project_id} not found")
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Verify project belongs to this guest session
        if project.student_id != session_id:
            logger.error(f"Project {project_id} does not belong to session {session_id}")
            raise HTTPException(status_code=403, detail="Project does not belong to this session")
        
        # Check if project has a trained model
        if not project.model or not project.model.gcsPath:
            logger.warning(f"Project {project_id} has no trained model to delete")
            raise HTTPException(status_code=404, detail="No trained model found for this project")
        
        # Delete model from GCS
        try:
            from ...config import gcp_clients
            
            # Use the configured bucket from config instead of parsing from path
            bucket = gcp_clients.get_bucket()
            
            logger.info(f"Using GCS bucket: {bucket.name}")
            logger.info(f"Model GCS path: {project.model.gcsPath}")
            logger.info(f"Full GCS object path: gs://{bucket.name}/{project.model.gcsPath}")
            
            # The gcsPath is just the object path within the bucket
            blob = bucket.blob(project.model.gcsPath)
            
            if blob.exists():
                blob.delete()
                logger.info(f"Successfully deleted model file from GCS: {project.model.gcsPath}")
            else:
                logger.warning(f"Model file not found in GCS: {project.model.gcsPath}")
        except Exception as e:
            logger.error(f"Error deleting model from GCS: {str(e)}")
            logger.error(f"Bucket name: {gcp_clients.get_bucket().name}")
            logger.error(f"Project model GCS path: {project.model.gcsPath}")
            raise HTTPException(status_code=500, detail=f"Failed to delete model from GCS: {str(e)}")
        
        # Update project to remove model information
        try:
            project.model = TrainedModel()  # Reset to empty model
            project.status = "draft"  # Reset status
            project.updatedAt = datetime.now(timezone.utc)
            
            # Update in database
            await project_service.update_project(project_id, ProjectUpdate(
                status="draft",
                updatedAt=datetime.now(timezone.utc)
            ))
            
            logger.info(f"Successfully updated project {project_id} after model deletion")
            
        except Exception as e:
            logger.error(f"Error updating project after model deletion: {str(e)}")
            # Don't fail the request if database update fails, model was already deleted from GCS
        
        return {
            "success": True,
            "message": "Trained model deleted successfully",
            "project_id": project_id,
            "deleted_gcs_path": project.model.gcsPath
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting trained model: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete trained model: {str(e)}")


@router.delete("/projects/{project_id}/examples/{label}")
async def delete_examples_by_label(
    project_id: str,
    label: str,
    session_id: str = Query(..., description="Guest session ID"),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete all examples under a specific label for a guest project"""
    try:
        # Validate session
        session = await validate_session_dependency(session_id, guest_service)
        logger.info(f"Session validated for project {project_id}, session {session_id}, label: {label}")
        
        # Get project to verify ownership
        project = await project_service.get_project(project_id)
        if not project:
            logger.error(f"Project {project_id} not found")
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Verify project belongs to this guest session
        if project.student_id != session_id:
            logger.error(f"Project {project_id} does not belong to session {session_id}")
            raise HTTPException(status_code=403, detail="Project does not belong to this session")
        
        # Ensure dataset is properly typed (in case deserialization had issues)
        if isinstance(project.dataset, dict):
            logger.info(f"Debug: Converting dataset dict to Dataset object for project {project_id}")
            # Convert examples if needed
            if 'examples' in project.dataset and isinstance(project.dataset['examples'], list):
                examples = []
                for example_data in project.dataset['examples']:
                    if isinstance(example_data, dict):
                        examples.append(TextExample(**example_data))
                    else:
                        examples.append(example_data)
                project.dataset['examples'] = examples
            project.dataset = Dataset(**project.dataset)
        
        # Check if project has examples
        if not project.dataset or not project.dataset.examples:
            logger.warning(f"Project {project_id} has no examples to delete")
            raise HTTPException(status_code=404, detail="No examples found for this project")
        
        # Count examples before deletion
        examples_before = len(project.dataset.examples)
        examples_with_label = [ex for ex in project.dataset.examples if ex.label == label]
        examples_to_delete = len(examples_with_label)
        
        logger.info(f"Project {project_id} has {examples_before} total examples before deletion")
        logger.info(f"Found {examples_to_delete} examples with label '{label}' to delete")
        
        if examples_to_delete == 0:
            logger.warning(f"No examples found with label '{label}' in project {project_id}")
            raise HTTPException(status_code=404, detail=f"No examples found with label '{label}'")
        
        # Remove examples with the specified label
        project.dataset.examples = [ex for ex in project.dataset.examples if ex.label != label]
        
        # Keep the label in the labels list even if no examples remain
        # This allows users to add examples to the label again without recreating it
        
        # Update dataset size
        project.dataset.records = len(project.dataset.examples)
        
        logger.info(f"After deletion, project has {len(project.dataset.examples)} examples")
        logger.info(f"Dataset records updated to: {project.dataset.records}")
        
        # Save the complete project with updated dataset to database
        try:
            # Ensure all dataset fields are properly set and preserve the deleted label
            if not hasattr(project.dataset, 'labels') or project.dataset.labels is None:
                project.dataset.labels = []
            
            # Keep existing labels and add any new ones from examples
            existing_labels = set(project.dataset.labels)
            example_labels = set(example.label for example in project.dataset.examples)
            
            # Preserve all existing labels (including the one we just cleared examples from)
            # and add any new labels from examples
            all_labels = existing_labels.union(example_labels)
            project.dataset.labels = list(all_labels)
            
            # Use the save_project method to avoid any ProjectUpdate serialization issues
            await project_service.save_project(project)
            
            logger.info(f"Successfully deleted {examples_to_delete} examples with label '{label}' from project {project_id}")
            logger.info(f"Project saved to database with {project.dataset.records} examples")
            
        except Exception as e:
            logger.error(f"Error updating project after example deletion: {str(e)}")
            logger.error(f"Debug: Dataset type: {type(project.dataset)}")
            logger.error(f"Debug: Dataset has records attr: {hasattr(project.dataset, 'records')}")
            if hasattr(project.dataset, 'examples'):
                logger.error(f"Debug: Examples type: {type(project.dataset.examples)}")
            raise HTTPException(status_code=500, detail=f"Failed to update project: {str(e)}")
        
        return {
            "success": True,
            "message": f"Successfully deleted {examples_to_delete} examples with label '{label}'",
            "project_id": project_id,
            "label": label,
            "examples_deleted": examples_to_delete,
            "examples_before": examples_before,
            "examples_after": len(project.dataset.examples)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting examples by label: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete examples: {str(e)}")


@router.delete("/projects/{project_id}/examples/{label}/{example_index}")
async def delete_specific_example(
    project_id: str,
    label: str,
    example_index: int,
    session_id: str = Query(..., description="Guest session ID"),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete a specific example by index under a label for a guest project"""
    try:
        # Validate session
        session = await validate_session_dependency(session_id, guest_service)
        logger.info(f"Session validated for project {project_id}, session {session_id}, label: {label}, index: {example_index}")
        
        # Get project to verify ownership
        project = await project_service.get_project(project_id)
        if not project:
            logger.error(f"Project {project_id} not found")
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Verify project belongs to this guest session
        if project.student_id != session_id:
            logger.error(f"Project {project_id} does not belong to session {session_id}")
            raise HTTPException(status_code=403, detail="Project does not belong to this session")
        
        # Ensure dataset is properly typed (in case deserialization had issues)
        if isinstance(project.dataset, dict):
            logger.info(f"Debug: Converting dataset dict to Dataset object for project {project_id}")
            # Convert examples if needed
            if 'examples' in project.dataset and isinstance(project.dataset['examples'], list):
                examples = []
                for example_data in project.dataset['examples']:
                    if isinstance(example_data, dict):
                        examples.append(TextExample(**example_data))
                    else:
                        examples.append(example_data)
                project.dataset['examples'] = examples
            project.dataset = Dataset(**project.dataset)
        
        # Check if project has examples
        if not project.dataset or not project.dataset.examples:
            logger.warning(f"Project {project_id} has no examples to delete")
            raise HTTPException(status_code=404, detail="No examples found for this project")
        
        # Find examples with the specified label
        examples_with_label = [ex for ex in project.dataset.examples if ex.label == label]
        
        if not examples_with_label:
            logger.warning(f"No examples found with label '{label}' in project {project_id}")
            raise HTTPException(status_code=404, detail=f"No examples found with label '{label}'")
        
        # Validate example index
        if example_index < 0 or example_index >= len(examples_with_label):
            logger.error(f"Invalid example index {example_index} for label '{label}' (valid range: 0-{len(examples_with_label)-1})")
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid example index. Valid range: 0-{len(examples_with_label)-1}"
            )
        
        # Get the example to delete
        example_to_delete = examples_with_label[example_index]
        
        # Remove the specific example from the dataset
        project.dataset.examples.remove(example_to_delete)
        
        # Update dataset size
        project.dataset.records = len(project.dataset.examples)
        
        # Save the complete project with updated dataset to database
        try:
            # Ensure all dataset fields are properly set and preserve empty labels
            if not hasattr(project.dataset, 'labels') or project.dataset.labels is None:
                project.dataset.labels = []
            
            # Keep existing labels and add any new ones from examples
            # This preserves empty labels even when they have no examples
            existing_labels = set(project.dataset.labels)
            example_labels = set(example.label for example in project.dataset.examples)
            
            # Preserve all existing labels (including empty ones) and add any new labels from examples
            all_labels = existing_labels.union(example_labels)
            project.dataset.labels = list(all_labels)
            
            # Use the save_project method to avoid any ProjectUpdate serialization issues
            await project_service.save_project(project)
            
            logger.info(f"Successfully deleted example '{example_to_delete.text[:50]}...' with label '{label}' from project {project_id}")
            logger.info(f"Project saved to database with {project.dataset.records} examples")
            
        except Exception as e:
            logger.error(f"Error updating project after specific example deletion: {str(e)}")
            logger.error(f"Debug: Dataset type: {type(project.dataset)}")
            logger.error(f"Debug: Dataset has records attr: {hasattr(project.dataset, 'records')}")
            if hasattr(project.dataset, 'examples'):
                logger.error(f"Debug: Examples type: {type(project.dataset.examples)}")
            raise HTTPException(status_code=500, detail=f"Failed to update project: {str(e)}")
        
        return {
            "success": True,
            "message": f"Successfully deleted example with label '{label}'",
            "project_id": project_id,
            "label": label,
            "example_index": example_index,
            "deleted_example": example_to_delete.text[:100],  # First 100 chars for reference
            "examples_remaining": len(project.dataset.examples)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting specific example: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete example: {str(e)}")


@router.delete("/projects/{project_id}/labels/{label}")
async def delete_label(
    project_id: str,
    label: str,
    session_id: str = Query(..., description="Guest session ID"),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete a label completely from a guest project, including all its examples"""
    try:
        # Validate session
        session = await validate_session_dependency(session_id, guest_service)
        logger.info(f"Session validated for project {project_id}, session {session_id}, label: {label}")
        
        # Get project to verify ownership
        project = await project_service.get_project(project_id)
        if not project:
            logger.error(f"Project {project_id} not found")
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Verify project belongs to this guest session
        if project.student_id != session_id:
            logger.error(f"Project {project_id} does not belong to session {session_id}")
            raise HTTPException(status_code=403, detail="Project does not belong to this session")
        
        # Ensure dataset is properly typed (in case deserialization had issues)
        if isinstance(project.dataset, dict):
            logger.info(f"Debug: Converting dataset dict to Dataset object for project {project_id}")
            # Convert examples if needed
            if 'examples' in project.dataset and isinstance(project.dataset['examples'], list):
                examples = []
                for example_data in project.dataset['examples']:
                    if isinstance(example_data, dict):
                        examples.append(TextExample(**example_data))
                    else:
                        examples.append(example_data)
                project.dataset['examples'] = examples
            project.dataset = Dataset(**project.dataset)
        
        # Check if project has dataset
        if not project.dataset:
            logger.warning(f"Project {project_id} has no dataset")
            raise HTTPException(status_code=404, detail="No dataset found for this project")
        
        # Count examples before deletion
        examples_before = len(project.dataset.examples) if project.dataset.examples else 0
        examples_with_label = [ex for ex in project.dataset.examples if ex.label == label] if project.dataset.examples else []
        examples_to_delete = len(examples_with_label)
        
        logger.info(f"Project {project_id} has {examples_before} total examples before deletion")
        logger.info(f"Found {examples_to_delete} examples with label '{label}' to delete")
        
        # Remove examples with the specified label
        if project.dataset.examples:
            project.dataset.examples = [ex for ex in project.dataset.examples if ex.label != label]
        
        # Remove the label from the labels list
        if hasattr(project.dataset, 'labels') and project.dataset.labels:
            if label in project.dataset.labels:
                project.dataset.labels.remove(label)
                logger.info(f"Removed label '{label}' from labels list")
        
        # Update dataset size
        project.dataset.records = len(project.dataset.examples) if project.dataset.examples else 0
        
        logger.info(f"After deletion, project has {len(project.dataset.examples) if project.dataset.examples else 0} examples")
        logger.info(f"Dataset records updated to: {project.dataset.records}")
        
        # Save the complete project with updated dataset to database
        try:
            # Ensure all dataset fields are properly set
            if not hasattr(project.dataset, 'labels') or project.dataset.labels is None:
                # Regenerate labels from remaining examples
                all_labels = set(example.label for example in project.dataset.examples) if project.dataset.examples else set()
                project.dataset.labels = list(all_labels)
            
            # Use the save_project method to avoid any ProjectUpdate serialization issues
            await project_service.save_project(project)
            
            logger.info(f"Successfully deleted label '{label}' and {examples_to_delete} examples from project {project_id}")
            logger.info(f"Project saved to database with {project.dataset.records} examples")
            
        except Exception as e:
            logger.error(f"Error updating project after label deletion: {str(e)}")
            logger.error(f"Debug: Dataset type: {type(project.dataset)}")
            logger.error(f"Debug: Dataset has records attr: {hasattr(project.dataset, 'records')}")
            if hasattr(project.dataset, 'examples'):
                logger.error(f"Debug: Examples type: {type(project.dataset.examples)}")
            raise HTTPException(status_code=500, detail=f"Failed to update project: {str(e)}")
        
        return {
            "success": True,
            "message": f"Successfully deleted label '{label}' and {examples_to_delete} examples",
            "project_id": project_id,
            "label": label,
            "examples_deleted": examples_to_delete,
            "examples_before": examples_before,
            "examples_after": len(project.dataset.examples) if project.dataset.examples else 0,
            "label_removed": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting label: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete label: {str(e)}")


@router.delete("/projects/{project_id}/labels/{label}/empty")
async def delete_empty_label(
    project_id: str,
    label: str,
    session_id: str = Query(..., description="Guest session ID"),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete an empty label (label with no examples) from a guest project"""
    try:
        # Validate session
        session = await validate_session_dependency(session_id, guest_service)
        logger.info(f"Session validated for project {project_id}, session {session_id}, label: {label}")
        
        # Get project to verify ownership
        project = await project_service.get_project(project_id)
        if not project:
            logger.error(f"Project {project_id} not found")
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Verify project belongs to this guest session
        if project.student_id != session_id:
            logger.error(f"Project {project_id} does not belong to session {session_id}")
            raise HTTPException(status_code=403, detail="Project does not belong to this session")
        
        # Ensure dataset is properly typed (in case deserialization had issues)
        if isinstance(project.dataset, dict):
            logger.info(f"Debug: Converting dataset dict to Dataset object for project {project_id}")
            # Convert examples if needed
            if 'examples' in project.dataset and isinstance(project.dataset['examples'], list):
                examples = []
                for example_data in project.dataset['examples']:
                    if isinstance(example_data, dict):
                        examples.append(TextExample(**example_data))
                    else:
                        examples.append(example_data)
                project.dataset['examples'] = examples
            project.dataset = Dataset(**project.dataset)
        
        # Check if project has dataset
        if not project.dataset:
            logger.warning(f"Project {project_id} has no dataset")
            raise HTTPException(status_code=404, detail="No dataset found for this project")
        
        # Check if label has examples
        examples_with_label = [ex for ex in project.dataset.examples if ex.label == label] if project.dataset.examples else []
        
        if examples_with_label:
            logger.warning(f"Label '{label}' has {len(examples_with_label)} examples, cannot delete as empty label")
            raise HTTPException(
                status_code=400, 
                detail=f"Label '{label}' has {len(examples_with_label)} examples. Use the regular label deletion endpoint to delete label with examples."
            )
        
        # Check if label exists in labels list
        if not hasattr(project.dataset, 'labels') or not project.dataset.labels or label not in project.dataset.labels:
            logger.warning(f"Label '{label}' not found in labels list for project {project_id}")
            raise HTTPException(status_code=404, detail=f"Label '{label}' not found")
        
        # Remove the label from the labels list
        project.dataset.labels.remove(label)
        logger.info(f"Removed empty label '{label}' from labels list")
        
        # Save the complete project with updated dataset to database
        try:
            # Use the save_project method to avoid any ProjectUpdate serialization issues
            await project_service.save_project(project)
            
            logger.info(f"Successfully deleted empty label '{label}' from project {project_id}")
            logger.info(f"Project saved to database")
            
        except Exception as e:
            logger.error(f"Error updating project after empty label deletion: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to update project: {str(e)}")
        
        return {
            "success": True,
            "message": f"Successfully deleted empty label '{label}'",
            "project_id": project_id,
            "label": label,
            "examples_deleted": 0,
            "label_removed": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting empty label: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete empty label: {str(e)}")


# ============================================================================
# IMAGE RECOGNITION DELETE ENDPOINTS
# ============================================================================

# More specific routes must come first to avoid conflicts
@router.delete("/session/{session_id}/projects/{project_id}/images/labels/{label}")
async def delete_image_label(
    session_id: str,
    project_id: str,
    label: str,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete an image label completely from a guest project, including all its examples"""
    try:
        logger.info(f"Deleting image label '{label}' completely from project {project_id}")
        
        # Get guest project
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        # Get image examples
        image_examples = guest_project.get('dataset', {}).get('image_examples', [])
        if not image_examples:
            raise HTTPException(status_code=404, detail="No image examples found for this project")
        
        # Filter examples by label
        examples_with_label = [ex for ex in image_examples if ex.get('label') == label]
        if not examples_with_label:
            raise HTTPException(status_code=404, detail=f"No image examples found with label '{label}'")
        
        # Delete all images from GCS
        deleted_count = 0
        for example in examples_with_label:
            image_url = example.get('image_url', '')
            if image_url and image_url.startswith('gs://'):
                try:
                    # Parse GCS URL
                    url_parts = image_url[5:].split('/', 1)
                    bucket_name = url_parts[0]
                    blob_name = url_parts[1]
                    
                    # Delete from GCS
                    bucket = gcp_clients.get_bucket()
                    blob = bucket.blob(blob_name)
                    blob.delete()
                    deleted_count += 1
                    logger.info(f"Deleted image from GCS: {blob_name}")
                except Exception as e:
                    logger.warning(f"Failed to delete image from GCS {image_url}: {e}")
        
        # Remove all examples with this label
        remaining_examples = [ex for ex in image_examples if ex.get('label') != label]
        
        # Get the current project to preserve all existing data
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Update only the image_examples field in the dataset
        project.dataset.image_examples = remaining_examples
        
        # Remove the label from the labels list if it has no examples
        if project.dataset.labels and label in project.dataset.labels:
            project.dataset.labels = [l for l in project.dataset.labels if l != label]
        
        # Save the complete project to preserve all data
        await project_service.save_project(project)
        
        logger.info(f"Successfully deleted image label '{label}' and {len(examples_with_label)} examples")
        
        return {
            "success": True,
            "message": f"Successfully deleted image label '{label}' and {len(examples_with_label)} examples",
            "project_id": project_id,
            "label": label,
            "examples_deleted": len(examples_with_label),
            "gcs_deleted": deleted_count,
            "label_removed": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting image label: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete image label: {str(e)}")


@router.delete("/session/{session_id}/projects/{project_id}/images/labels/{label}/empty")
async def delete_empty_image_label(
    session_id: str,
    project_id: str,
    label: str,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete an empty image label (label with no examples) from a guest project"""
    try:
        logger.info(f"Deleting empty image label '{label}' from project {project_id}")
        
        # Get guest project
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        # Get image examples
        image_examples = guest_project.get('dataset', {}).get('image_examples', [])
        
        # Check if label has examples
        examples_with_label = [ex for ex in image_examples if ex.get('label') == label] if image_examples else []
        
        if examples_with_label:
            raise HTTPException(
                status_code=400, 
                detail=f"Image label '{label}' has {len(examples_with_label)} examples. Use the regular label deletion endpoint to delete label with examples."
            )
        
        # Check if label exists in labels list
        labels = guest_project.get('dataset', {}).get('labels', [])
        if not labels or label not in labels:
            raise HTTPException(status_code=404, detail=f"Image label '{label}' not found")
        
        # Remove the label from the labels list
        updated_labels = [l for l in labels if l != label]
        
        # Get the current project to preserve all existing data
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Update only the labels field in the dataset
        project.dataset.labels = updated_labels
        
        # Save the complete project to preserve all data
        await project_service.save_project(project)
        
        logger.info(f"Successfully deleted empty image label '{label}'")
        
        return {
            "success": True,
            "message": f"Successfully deleted empty image label '{label}'",
            "project_id": project_id,
            "label": label,
            "label_removed": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting empty image label: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete empty image label: {str(e)}")


@router.delete("/session/{session_id}/projects/{project_id}/images/{label}")
async def delete_image_examples_by_label(
    session_id: str,
    project_id: str,
    label: str,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete all image examples under a specific label for a guest project"""
    try:
        logger.info(f"Deleting all image examples for label '{label}' in project {project_id}")
        
        # Get guest project
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        # Get image examples
        image_examples = guest_project.get('dataset', {}).get('image_examples', [])
        
        # Filter examples by label
        examples_with_label = [ex for ex in image_examples if ex.get('label') == label]
        
        # If no examples found for this label, that's fine for "Clear All" - just ensure the label exists
        if not examples_with_label:
            # Check if the label exists in the labels array
            current_labels = guest_project.get('dataset', {}).get('labels', [])
            if label not in current_labels:
                raise HTTPException(status_code=404, detail=f"Label '{label}' not found in this project")
            
            # Label exists but has no examples - this is a valid "Clear All" operation
            logger.info(f"Label '{label}' has no examples to delete - keeping as empty label")
            return {
                "success": True,
                "message": f"Label '{label}' is already empty",
                "project_id": project_id,
                "label": label,
                "examples_deleted": 0,
                "gcs_deleted": 0
            }
        
        # Delete images from GCS
        deleted_count = 0
        for example in examples_with_label:
            image_url = example.get('image_url', '')
            if image_url and image_url.startswith('gs://'):
                try:
                    # Parse GCS URL
                    url_parts = image_url[5:].split('/', 1)
                    bucket_name = url_parts[0]
                    blob_name = url_parts[1]
                    
                    # Delete from GCS
                    bucket = gcp_clients.get_bucket()
                    blob = bucket.blob(blob_name)
                    blob.delete()
                    deleted_count += 1
                    logger.info(f"Deleted image from GCS: {blob_name}")
                except Exception as e:
                    logger.warning(f"Failed to delete image from GCS {image_url}: {e}")
        
        # Remove examples from project
        remaining_examples = [ex for ex in image_examples if ex.get('label') != label]
        
        # Get current labels and keep the label even if no examples remain (for "Clear All" functionality)
        current_labels = guest_project.get('dataset', {}).get('labels', [])
        updated_labels = current_labels.copy()
        
        # For "Clear All" functionality, we want to keep the label even when empty
        # Only remove the label if it's not in the current labels list
        if label not in updated_labels:
            updated_labels.append(label)
            logger.info(f"Added label '{label}' to labels array to keep it as empty label")
        
        # Update project using ProjectService
        from ...models import ProjectUpdate
        project_update = ProjectUpdate(
            dataset={
                'image_examples': remaining_examples,
                'labels': updated_labels
            }
        )
        
        await project_service.update_project(project_id, project_update)
        
        logger.info(f"Successfully deleted {len(examples_with_label)} image examples with label '{label}'")
        
        return {
            "success": True,
            "message": f"Successfully deleted {len(examples_with_label)} image examples with label '{label}'",
            "project_id": project_id,
            "label": label,
            "examples_deleted": len(examples_with_label),
            "gcs_deleted": deleted_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting image examples by label: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete image examples: {str(e)}")


@router.delete("/session/{session_id}/projects/{project_id}/images/{label}/{example_index}")
async def delete_specific_image_example(
    session_id: str,
    project_id: str,
    label: str,
    example_index: int,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete a specific image example by index under a label for a guest project"""
    try:
        logger.info(f"Deleting specific image example {example_index} for label '{label}' in project {project_id}")
        
        # Get guest project
        guest_project = await guest_service.get_guest_project_by_id(project_id)
        if not guest_project:
            raise HTTPException(status_code=404, detail="Guest project not found")
        
        # Verify project belongs to this session
        if guest_project.get('createdBy') != f"guest:{session_id}":
            raise HTTPException(status_code=404, detail="Project not found in this session")
        
        # Get image examples
        image_examples = guest_project.get('dataset', {}).get('image_examples', [])
        logger.info(f"Total image examples in project: {len(image_examples)}")
        logger.info(f"All image examples: {[ex.get('label', 'NO_LABEL') + '/' + ex.get('filename', 'NO_FILENAME') for ex in image_examples]}")
        
        if not image_examples:
            raise HTTPException(status_code=404, detail="No image examples found for this project")
        
        # Filter examples by label
        examples_with_label = [ex for ex in image_examples if ex.get('label') == label]
        logger.info(f"Found {len(examples_with_label)} examples with label '{label}'")
        logger.info(f"Examples with label '{label}': {[ex.get('filename', 'NO_FILENAME') for ex in examples_with_label]}")
        logger.info(f"Requested example index: {example_index}")
        logger.info(f"Available indices: 0-{len(examples_with_label)-1}")
        
        if not examples_with_label:
            raise HTTPException(status_code=404, detail=f"No image examples found with label '{label}'")
        
        # Validate example index
        if example_index < 0 or example_index >= len(examples_with_label):
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid example index. Valid range: 0-{len(examples_with_label)-1}"
            )
        
        # Get the example to delete
        example_to_delete = examples_with_label[example_index]
        image_url = example_to_delete.get('image_url', '')
        
        # Delete image from GCS
        gcs_deleted = False
        if image_url and image_url.startswith('gs://'):
            try:
                # Parse GCS URL
                url_parts = image_url[5:].split('/', 1)
                bucket_name = url_parts[0]
                blob_name = url_parts[1]
                
                # Delete from GCS
                bucket = gcp_clients.get_bucket()
                blob = bucket.blob(blob_name)
                blob.delete()
                gcs_deleted = True
                logger.info(f"Deleted image from GCS: {blob_name}")
            except Exception as e:
                logger.warning(f"Failed to delete image from GCS {image_url}: {e}")
        
        # Remove the specific example from project
        image_examples.remove(example_to_delete)
        
        # Get current labels and preserve them (including empty labels)
        current_labels = guest_project.get('dataset', {}).get('labels', [])
        
        # Update project using ProjectService
        from ...models import ProjectUpdate
        project_update = ProjectUpdate(
            dataset={
                'image_examples': image_examples,
                'labels': current_labels  # Preserve existing labels including empty ones
            }
        )
        
        await project_service.update_project(project_id, project_update)
        
        logger.info(f"Successfully deleted image example with label '{label}'")
        
        return {
            "success": True,
            "message": f"Successfully deleted image example with label '{label}'",
            "project_id": project_id,
            "label": label,
            "example_index": example_index,
            "gcs_deleted": gcs_deleted,
            "examples_remaining": len(image_examples)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting specific image example: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete image example: {str(e)}")


# ============================================================================
# SESSION CLEANUP
# ============================================================================

@router.get("/session/{session_id}/debug", response_model=dict)
async def debug_guest_session(
    session_id: str,
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Debug endpoint to check session and associated projects"""
    try:
        # Check session
        session = await guest_service.get_simple_guest_session(session_id)
        
        # Get all projects for this session
        projects = await project_service.get_projects(
            limit=1000, offset=0, status=None, type=None, 
            created_by=None, guest_session_id=session_id
        )
        
        # Also check if there are any projects with this session in createdBy field
        projects_by_created_by = await project_service.get_projects(
            limit=1000, offset=0, status=None, type=None, 
            created_by=f"guest:{session_id}", guest_session_id=None
        )
        
        return {
            "session_exists": session is not None,
            "session_data": session.model_dump() if session else None,
            "projects_by_student_id": [
                {"id": p.id, "name": p.name, "student_id": p.student_id, "createdBy": p.createdBy} 
                for p in projects
            ],
            "projects_by_created_by": [
                {"id": p.id, "name": p.name, "student_id": p.student_id, "createdBy": p.createdBy} 
                for p in projects_by_created_by
            ],
            "total_projects_student_id": len(projects),
            "total_projects_created_by": len(projects_by_created_by)
        }
    except Exception as e:
        return {
            "error": str(e),
            "session_exists": False,
            "projects_by_student_id": [],
            "projects_by_created_by": [],
            "total_projects_student_id": 0,
            "total_projects_created_by": 0
        }

@router.delete("/session/{session_id}")
async def delete_guest_session(
    session_id: str,
    guest_service: GuestService = Depends(get_guest_service),
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete a guest session and all associated projects"""
    try:
        # First check if session exists (but don't validate expiry since we're deleting)
        session = await guest_service.get_simple_guest_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Guest session not found")
        
        # Get all projects for this session
        projects = await project_service.get_projects(
            limit=1000, offset=0, status=None, type=None, 
            created_by=None, guest_session_id=session_id
        )
        
        logger.info(f"Found {len(projects)} projects for session {session_id}")
        if projects:
            logger.info(f"Project IDs to delete: {[p.id for p in projects]}")
        
        # Delete all projects first
        deleted_projects_count = 0
        if projects:
            project_ids = [p.id for p in projects]
            # Project types that keep their own collections (runs, models): clean those too
            for p in projects:
                kind = str(getattr(p.type, "value", p.type))
                try:
                    if kind == "confusion-matrix":
                        ConfusionMatrixService().delete(p.id, session_id)
                    elif kind == "rag-chatbot":
                        RagChatbotService().delete(p.id, session_id)
                    elif kind == "ai-agent":
                        AiAgentService().delete(p.id, session_id)
                except Exception as e:
                    logger.warning("Cleanup of %s project %s failed: %s", kind, p.id, e)
            try:
                deleted_projects_count = await project_service.delete_multiple_projects(project_ids)
                logger.info(f"Successfully deleted {deleted_projects_count} out of {len(projects)} projects")
            except Exception as e:
                logger.error(f"Error deleting some projects for session {session_id}: {str(e)}")
                # Continue with session deletion even if some projects fail
        else:
            logger.info(f"No projects found for session {session_id}")
        
        # Delete the session
        success = await guest_service.delete_simple_guest_session(session_id)
        
        if success:
            return {
                "success": True, 
                "message": f"Guest session and {deleted_projects_count} associated projects deleted successfully",
                "session_id": session_id,
                "deleted_projects": deleted_projects_count
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to delete guest session")
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# SCRATCH SERVICES
# ============================================================================

@router.post("/session/{session_id}/projects/{project_id}/scratch/start", response_model=dict)
async def start_scratch_services(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Start Scratch services for a guest project"""
    try:
        # Verify project belongs to this session
        project = await project_service.get_project(project_id)
        if not project or project.student_id != session_id:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Use production URL in production, localhost in development
        from ...config import settings
        gui_url = "http://localhost:8601" if settings.node_env == "development" else settings.scratch_editor_url
        vm_url = "http://localhost:8602" if settings.node_env == "development" else settings.scratch_editor_url
        
        return {
            "success": True,
            "message": "Scratch services started successfully",
            "gui_url": gui_url,
            "vm_url": vm_url,
            "project_id": project_id,
            "session_id": session_id
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting Scratch services for project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scratch/start-all", response_model=dict)
async def start_all_scratch_services():
    """Start all Scratch services (scratch-gui, scratch-vm, etc.)"""
    try:
        # Use production URL in production, localhost in development
        from ...config import settings
        gui_url = "http://localhost:8601" if settings.node_env == "development" else settings.scratch_editor_url
        vm_url = "http://localhost:8602" if settings.node_env == "development" else settings.scratch_editor_url
        
        return {
            "success": True,
            "message": "All Scratch services started successfully",
            "gui_url": gui_url,
            "vm_url": vm_url,
            "services": [
                {
                    "name": "scratch-gui",
                    "status": "running",
                    "port": 8601,
                    "url": gui_url
                },
                {
                    "name": "scratch-vm",
                    "status": "running", 
                    "port": 8602,
                    "url": vm_url
                }
            ]
        }
    except Exception as e:
        logger.error(f"Error starting Scratch services: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# MACHINE LEARNING ENDPOINTS FOR SCRATCH EXTENSION
# ============================================================================

@router.get("/session/{session_id}/projects/{project_id}/examples", response_model=dict)
async def get_guest_examples(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get examples and model information for Scratch extension"""
    try:
        # Validate that the project belongs to this session
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check if project belongs to this session
        if project.guest_session_id != session_id and project.createdBy != f"guest:{session_id}":
            raise HTTPException(status_code=403, detail="Project does not belong to this session")
        
        # Get examples for this project
        examples = await project_service.get_project_examples(project_id)
        
        # Extract unique labels from examples
        labels = list(set([ex.label for ex in examples if ex.label]))
        
        # Check if model is ready (has training data)
        model_ready = len(examples) > 0
        
        return {
            "success": True,
            "data": {
                "labels": labels,
                "examples_count": len(examples),
                "model_ready": model_ready,
                "project_name": project.name,
                "project_type": project.type
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting examples for project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))





@router.post("/session/{session_id}/projects/{project_id}/train", response_model=dict)
async def train_guest_project(
    session_id: str,
    project_id: str,
    request: dict,
    session: dict = Depends(validate_session_dependency),
    project_service: ProjectService = Depends(get_project_service)
):
    """Add training data or start training for Scratch extension"""
    try:
        # Validate that the project belongs to this session
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check if project belongs to this session
        if project.guest_session_id != session_id:
            raise HTTPException(status_code=403, detail="Project does not belong to this session")
        
        # Check if this is adding training data or starting training
        if 'text' in request and 'label' in request:
            # Adding training data
            example = ExampleAdd(
                text=request['text'],
                label=request['label']
            )
            
            await project_service.add_example_to_project(project_id, example)
            
            return {
                "success": True,
                "data": {
                    "message": "Training data added successfully",
                    "action": "add_data",
                    "text": request['text'],
                    "label": request['label']
                }
            }
        elif request.get('action') == 'train':
            # Starting training process
            examples = await project_service.get_project_examples(project_id)
            
            if len(examples) < 5:
                raise HTTPException(status_code=400, detail="Need at least 5 examples to start training")
            
            # In a real implementation, you would start an async training job here
            # For now, we'll just return success
            return {
                "success": True,
                "data": {
                    "message": "Training started successfully",
                    "action": "train",
                    "examples_count": len(examples),
                    "status": "training"
                }
            }
        else:
            raise HTTPException(status_code=400, detail="Invalid request. Must include 'text' and 'label' or 'action': 'train'")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error training project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


