import uuid
import json
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from google.cloud import firestore, storage, pubsub_v1
from google.cloud.exceptions import NotFound

from .models import TrainingJob, TrainingJobStatus, Project, TextExample
from .training_service import trainer
from .config import gcp_clients


class TrainingJobService:
    """Service for managing training jobs and queue"""
    
    def __init__(self):
        self._firestore_client = None
        self._storage_client = None
        self._pubsub_client = None
        self._topic_path = None
        self._jobs_collection = None
        self._projects_collection = None
        self._bucket = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazy initialization - only initialize when first accessed"""
        if self._initialized:
            return
        
        self._firestore_client = gcp_clients.get_firestore_client()
        self._storage_client = gcp_clients.get_storage_client()
        self._pubsub_client = gcp_clients.get_pubsub_client()
        self._topic_path = gcp_clients.get_topic_path()
        
        # Collections
        self._jobs_collection = self._firestore_client.collection('training_jobs')
        self._projects_collection = self._firestore_client.collection('projects')
        self._bucket = gcp_clients.get_bucket()
        
        self._initialized = True
    
    @property
    def firestore_client(self):
        self._ensure_initialized()
        return self._firestore_client
    
    @property
    def storage_client(self):
        self._ensure_initialized()
        return self._storage_client
    
    @property
    def pubsub_client(self):
        self._ensure_initialized()
        return self._pubsub_client
    
    @property
    def topic_path(self):
        self._ensure_initialized()
        return self._topic_path
    
    @property
    def jobs_collection(self):
        self._ensure_initialized()
        return self._jobs_collection
    
    @property
    def projects_collection(self):
        self._ensure_initialized()
        return self._projects_collection
    
    @property
    def bucket(self):
        self._ensure_initialized()
        return self._bucket
    
    async def create_training_job(self, project_id: str, config: Optional[dict] = None) -> TrainingJob:
        """Create a new training job and add to queue"""
        try:
            # Check if project exists and has examples
            project_doc = self.projects_collection.document(project_id).get()
            if not project_doc.exists:
                raise ValueError("Project not found")
            
            project_data = project_doc.to_dict()
            project = Project(**project_data)
            
            # Check if project already has a job
            if project.currentJobId:
                existing_job = self.jobs_collection.document(project.currentJobId).get()
                if existing_job.exists:
                    job_data = existing_job.to_dict()
                    if job_data.get('status') in ['queued', 'training']:
                        raise ValueError("Project already has a training job in progress")
            
            # Create new training job
            job_id = str(uuid.uuid4())
            training_job = TrainingJob(
                id=job_id,
                projectId=project_id,
                status=TrainingJobStatus.QUEUED,
                config=config
            )
            
            # Save job to Firestore
            self.jobs_collection.document(job_id).set(training_job.model_dump())
            
            # Update project with job ID
            self.projects_collection.document(project_id).update({
                'currentJobId': job_id,
                'status': 'queued',
                'updatedAt': datetime.now(timezone.utc).isoformat()
            })
            
            # Publish job to Pub/Sub queue
            job_message = {
                'jobId': job_id,
                'projectId': project_id,
                'action': 'start_training'
            }
            
            self.pubsub_client.publish(
                self.topic_path,
                json.dumps(job_message).encode('utf-8')
            )
            
            return training_job
            
        except Exception as e:
            raise Exception(f"Failed to create training job: {str(e)}")
    
    async def get_job_status(self, job_id: str) -> Optional[TrainingJob]:
        """Get training job status"""
        try:
            job_doc = self.jobs_collection.document(job_id).get()
            if job_doc.exists:
                return TrainingJob(**job_doc.to_dict())
            return None
        except Exception as e:
            raise Exception(f"Failed to get job status: {str(e)}")
    
    async def get_project_jobs(self, project_id: str) -> List[TrainingJob]:
        """Get all training jobs for a project"""
        try:
            jobs_query = self.jobs_collection.where('projectId', '==', project_id)
            jobs_docs = jobs_query.order_by('createdAt', direction=firestore.Query.DESCENDING).get()
            
            jobs = []
            for doc in jobs_docs:
                jobs.append(TrainingJob(**doc.to_dict()))
            
            return jobs
        except Exception as e:
            raise Exception(f"Failed to get project jobs: {str(e)}")
    
    async def process_training_job(self, job_id: str) -> bool:
        """Process a training job (called by worker)"""
        try:
            # Get job details
            job_doc = self.jobs_collection.document(job_id).get()
            if not job_doc.exists:
                return False
            
            job_data = job_doc.to_dict()
            job = TrainingJob(**job_data)
            
            # Update job status to training
            self.jobs_collection.document(job_id).update({
                'status': TrainingJobStatus.TRAINING,
                'startedAt': datetime.now(timezone.utc).isoformat(),
                'progress': 10.0
            })
            
            # Update project status
            self.projects_collection.document(job.projectId).update({
                'status': 'training',
                'updatedAt': datetime.now(timezone.utc).isoformat()
            })
            
            # Get project examples for training
            project_doc = self.projects_collection.document(job.projectId).get()
            if not project_doc.exists:
                raise Exception("Project not found")
            
            project_data = project_doc.to_dict()
            project = Project(**project_data)
            
            if not project.dataset.examples:
                raise Exception("No examples found for training")
            
            # Convert examples to TextExample objects
            examples = []
            for ex_data in project.dataset.examples:
                # Check if it's already a TextExample object
                if isinstance(ex_data, TextExample):
                    examples.append(ex_data)
                else:
                    # Convert dict to TextExample
                    example = TextExample(**ex_data)
                    examples.append(example)
            
            # Update progress
            self.jobs_collection.document(job_id).update({'progress': 30.0})
            
            # Train the model
            training_result = trainer.train_model(examples)
            
            # Update progress
            self.jobs_collection.document(job_id).update({'progress': 70.0})
            
            # Save model directly to GCS
            model_filename = f"model_{job.projectId}.pkl"
            model_path = f"models/{job.projectId}/{model_filename}"
            
            # Save model directly to GCS without local storage
            trainer.save_model_to_gcs(self.bucket, model_path)
            
            # Update progress
            self.jobs_collection.document(job_id).update({'progress': 90.0})
            
            # Update project with model info
            model_update = {
                'model.filename': model_filename,
                'model.gcsPath': model_path,
                'model.accuracy': training_result['accuracy'],
                'model.labels': training_result['labels'],
                'model.modelType': 'logistic_regression',
                'model.trainedAt': datetime.now(timezone.utc).isoformat(),
                'model.endpointUrl': f"/api/projects/{job.projectId}/predict",
                'status': 'trained',
                'updatedAt': datetime.now(timezone.utc).isoformat()
            }
            
            self.projects_collection.document(job.projectId).update(model_update)
            
            # Update job as completed
            self.jobs_collection.document(job_id).update({
                'status': TrainingJobStatus.READY,
                'completedAt': datetime.now(timezone.utc).isoformat(),
                'progress': 100.0,
                'result': training_result
            })
            
            return True
            
        except Exception as e:
            # Mark job as failed
            self.jobs_collection.document(job_id).update({
                'status': TrainingJobStatus.FAILED,
                'error': str(e),
                'completedAt': datetime.now(timezone.utc).isoformat()
            })
            
            # Update project status
            self.projects_collection.document(job.projectId).update({
                'status': 'failed',
                'updatedAt': datetime.now(timezone.utc).isoformat()
            })
            
            raise Exception(f"Training failed: {str(e)}")
    
    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a training job"""
        try:
            job_doc = self.jobs_collection.document(job_id).get()
            if not job_doc.exists:
                return False
            
            job_data = job_doc.to_dict()
            
            # Only allow cancellation of queued jobs
            if job_data.get('status') != TrainingJobStatus.QUEUED:
                raise ValueError("Can only cancel queued jobs")
            
            # Update job status
            self.jobs_collection.document(job_id).update({
                'status': 'cancelled',
                'completedAt': datetime.now(timezone.utc).isoformat()
            })
            
            # Update project status
            self.projects_collection.document(job_data['projectId']).update({
                'status': 'draft',
                'currentJobId': None,
                'updatedAt': datetime.now(timezone.utc).isoformat()
            })
            
            return True
            
        except Exception as e:
            raise Exception(f"Failed to cancel job: {str(e)}")
    
    async def cleanup_completed_jobs(self, days_old: int = 7) -> int:
        """Clean up old completed jobs"""
        try:
            cutoff_date = datetime.now(timezone.utc).replace(tzinfo=timezone.utc) - timedelta(days=days_old)
            
            # Find old completed jobs
            jobs_query = self.jobs_collection.where('status', 'in', ['ready', 'failed', 'cancelled'])
            jobs_query = jobs_query.where('completedAt', '<', cutoff_date)
            
            deleted_count = 0
            for doc in jobs_query.stream():
                doc.reference.delete()
                deleted_count += 1
            
            return deleted_count
            
        except Exception as e:
            raise Exception(f"Failed to cleanup jobs: {str(e)}")


# Global service instance
training_job_service = TrainingJobService()
