from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Depends
from typing import List, Optional
import json
from datetime import datetime, timezone

from ..models import (
    Project, ProjectCreate, ProjectUpdate, ProjectListResponse, 
    ProjectResponse, ProjectStatusResponseWrapper, TrainingConfig,
    FileUploadResponse, TrainingResponse, ErrorResponse,
    ExampleAdd, ExamplesBulkAdd, PredictionRequest, PredictionResponse
)
from ..services.project_service import ProjectService
from ..training_service import trainer
from ..training_job_service import training_job_service
from ..config import gcp_clients

router = APIRouter(prefix="/api/projects", tags=["projects"])


# Dependency to get project service
def get_project_service():
    return ProjectService()


@router.get("/", response_model=ProjectListResponse)
async def get_projects(
    limit: int = Query(50, ge=1, le=100, description="Number of projects to return"),
    offset: int = Query(0, ge=0, description="Number of projects to skip"),
    status: Optional[str] = Query(None, description="Filter by project status"),
    type: Optional[str] = Query(None, description="Filter by project type"),
    created_by: Optional[str] = Query(None, description="Filter by creator"),
    search: Optional[str] = Query(None, description="Search query"),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get all projects with optional filtering and search"""
    try:
        if search:
            filters = {}
            if status:
                filters['status'] = status
            if type:
                filters['type'] = type
            if created_by:
                filters['createdBy'] = created_by
            
            projects = await project_service.search_projects(search, filters)
            total = len(projects)
            # Apply pagination
            projects = projects[offset:offset + limit]
        else:
            projects = await project_service.get_projects(limit, offset, status, type, created_by)
            total = len(projects)  # In production, you'd get total count separately
        
        return ProjectListResponse(
            data=projects,
            pagination={
                "limit": limit,
                "offset": offset,
                "total": total
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Get project by ID"""
    try:
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        return ProjectResponse(data=project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=ProjectResponse, status_code=201)
async def create_project(
    project_data: ProjectCreate,
    project_service: ProjectService = Depends(get_project_service)
):
    """Create a new project"""
    try:
        project = await project_service.create_project(project_data)
        return ProjectResponse(data=project)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    project_data: ProjectUpdate,
    project_service: ProjectService = Depends(get_project_service)
):
    """Update project"""
    try:
        project = await project_service.update_project(project_id, project_data)
        return ProjectResponse(data=project)
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Project not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete project(s) - supports single ID or comma-separated IDs"""
    try:
        # Check if project_id contains comma-separated values
        if ',' in project_id:
            # Handle multiple project IDs
            project_ids = [pid.strip() for pid in project_id.split(',') if pid.strip()]
            if not project_ids:
                raise HTTPException(status_code=400, detail="No valid project IDs provided")
            
            # Delete multiple projects
            deleted_count = await project_service.delete_multiple_projects(project_ids)
            return {
                "success": True, 
                "message": f"Successfully deleted {deleted_count} project(s)",
                "deleted_count": deleted_count
            }
        else:
            # Handle single project ID (existing behavior)
            await project_service.delete_project(project_id)
            return {"success": True, "message": "Project deleted successfully"}
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail="Project not found")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}/dataset", response_model=FileUploadResponse)
async def upload_dataset(
    project_id: str,
    file: UploadFile = File(..., description="Dataset file to upload"),
    records: Optional[int] = Form(None, description="Number of records in dataset"),
    description: Optional[str] = Form("", description="Dataset description"),
    project_service: ProjectService = Depends(get_project_service)
):
    """Upload dataset file for a project"""
    try:
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
            'contentType': file.content_type
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


@router.post("/{project_id}/examples", response_model=dict)
async def add_examples(
    project_id: str,
    examples_data: ExamplesBulkAdd,
    project_service: ProjectService = Depends(get_project_service)
):
    """Add text examples to a project"""
    try:
        # Validate number of examples
        if len(examples_data.examples) > 50:
            raise HTTPException(
                status_code=400,
                detail="Maximum 50 examples can be added at once"
            )
        
        # Add examples to project
        result = await project_service.add_examples(project_id, examples_data.examples)
        
        # Calculate how many examples were actually created (after splitting comma-separated text)
        input_examples_count = len(examples_data.examples)
        actual_examples_added = result['totalExamples'] - (result.get('previousTotal', 0) or 0)
        
        return {
            "success": True,
            "message": f"Added {actual_examples_added} examples from {input_examples_count} input(s)",
            "totalExamples": result['totalExamples'],
            "labels": result['labels'],
            "inputExamples": input_examples_count,
            "actualExamplesAdded": actual_examples_added
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}/examples", response_model=dict)
async def get_examples(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Get all examples for a project"""
    try:
        examples = await project_service.get_examples(project_id)
        return {
            "success": True,
            "examples": examples,
            "totalExamples": len(examples)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}/train", response_model=TrainingResponse)
async def start_training(
    project_id: str,
    training_config: Optional[TrainingConfig] = None,
    project_service: ProjectService = Depends(get_project_service)
):
    """Start training job for a project using logistic regression"""
    try:
        # Get project and examples
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get examples for training
        examples = await project_service.get_examples(project_id)
        if not examples:
            raise HTTPException(
                status_code=400, 
                detail="No examples found. Add some examples before training."
            )
        
        # Create training job and add to queue
        try:
            config_dict = training_config.model_dump() if training_config else None
            training_job = await training_job_service.create_training_job(project_id, config_dict)
            
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}/train", response_model=dict)
async def get_training_status(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Get training status and job information for a project"""
    try:
        # Get project
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get training jobs
        jobs = await training_job_service.get_project_jobs(project_id)
        
        # Get current job status
        current_job = None
        if project.currentJobId:
            current_job = await training_job_service.get_job_status(project.currentJobId)
        
        return {
            "success": True,
            "projectStatus": project.status,
            "currentJob": current_job.model_dump() if current_job else None,
            "allJobs": [job.model_dump() for job in jobs],
            "totalJobs": len(jobs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{project_id}/train", response_model=dict)
async def cancel_training(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Cancel current training job for a project"""
    try:
        # Get project
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        if not project.currentJobId:
            raise HTTPException(
                status_code=400,
                detail="No training job in progress"
            )
        
        # Cancel the job
        success = await training_job_service.cancel_job(project.currentJobId)
        
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
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}/predict", response_model=PredictionResponse)
async def predict_text(
    project_id: str,
    prediction_request: PredictionRequest,
    project_service: ProjectService = Depends(get_project_service)
):
    """Make prediction using trained model"""
    try:
        # Get project
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        if project.status != 'trained':
            raise HTTPException(
                status_code=400, 
                detail="Project is not trained yet. Train the model first."
            )
        
        # Make prediction using model from GCS
        prediction_result = trainer.predict_from_gcs(
            prediction_request.text, 
            gcp_clients.get_bucket(),
            project.model.gcsPath
        )
        
        return PredictionResponse(
            success=True,
            label=prediction_result['label'],
            confidence=prediction_result['confidence'],
            alternatives=prediction_result['alternatives']
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{project_id}/status", response_model=ProjectStatusResponseWrapper)
async def get_project_status(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Get project status and metadata"""
    try:
        project = await project_service.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        status_response = {
            "id": project.id,
            "status": project.status,
            "dataset": project.dataset,
            "datasets": project.datasets,
            "model": project.model,
            "updatedAt": project.updatedAt
        }
        
        return ProjectStatusResponseWrapper(data=status_response)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Training job management endpoints
@router.get("/training/jobs/{job_id}", response_model=dict)
async def get_job_status(job_id: str):
    """Get training job status by ID"""
    try:
        job = await training_job_service.get_job_status(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Training job not found")
        
        return {
            "success": True,
            "job": job.model_dump()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/training/jobs/{job_id}", response_model=dict)
async def cancel_job(job_id: str):
    """Cancel a training job by ID"""
    try:
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
