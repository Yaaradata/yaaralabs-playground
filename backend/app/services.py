import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from google.cloud import firestore
from google.cloud import storage
from google.cloud import pubsub_v1

from .models import Project, ProjectCreate, ProjectUpdate, Dataset, TrainedModel, ProjectConfig, TextExample, ExampleAdd
from .config import gcp_clients


class ProjectService:
    """Service layer for project management operations"""
    
    def __init__(self):
        self.collection = gcp_clients.get_projects_collection()
        self.bucket = gcp_clients.get_bucket()
        self.topic_path = gcp_clients.get_topic_path()
        self.pubsub_client = gcp_clients.get_pubsub_client()
    
    async def create_project(self, project_data: ProjectCreate) -> Project:
        """Create a new project"""
        try:
            project_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc)
            
            project = Project(
                id=project_id,
                name=project_data.name,
                description=project_data.description,
                type=project_data.type,
                createdBy=project_data.createdBy,
                tags=project_data.tags,
                notes=project_data.notes,
                config=project_data.config or ProjectConfig(),
                createdAt=now,
                updatedAt=now,
                dataset=Dataset(),  # Initialize with empty dataset
                datasets=[],  # Initialize with empty datasets list
                model=TrainedModel()  # Initialize with empty model
            )
            
            # Convert to dict for Firestore
            project_dict = project.model_dump()
            self.collection.document(project_id).set(project_dict)
            
            return project
        except Exception as e:
            raise Exception(f"Failed to create project: {str(e)}")
    
    async def get_project(self, project_id: str) -> Optional[Project]:
        """Get project by ID"""
        try:
            doc = self.collection.document(project_id).get()
            if doc.exists:
                data = doc.to_dict()
                return Project(**data)
            return None
        except Exception as e:
            raise Exception(f"Failed to get project: {str(e)}")
    
    async def get_projects(
        self, 
        limit: int = 50, 
        offset: int = 0,
        status: Optional[str] = None,
        type: Optional[str] = None,
        created_by: Optional[str] = None
    ) -> List[Project]:
        """Get all projects with optional filtering"""
        try:
            # Start with base query
            query = self.collection.order_by('createdAt', direction=firestore.Query.DESCENDING)
            
            # Apply filters
            if status:
                query = query.where('status', '==', status)
            if type:
                query = query.where('type', '==', type)
            if created_by:
                query = query.where('createdBy', '==', created_by)
            
            # Execute query and get documents
            docs = query.limit(limit).offset(offset).get()
            projects = []
            
            for doc in docs:
                data = doc.to_dict()
                projects.append(Project(**data))
            
            return projects
        except Exception as e:
            raise Exception(f"Failed to get projects: {str(e)}")
    
    async def update_project(self, project_id: str, update_data: ProjectUpdate) -> Project:
        """Update project"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            # Update fields
            update_dict = update_data.model_dump(exclude_unset=True)
            update_dict['updatedAt'] = datetime.now(timezone.utc)
            
            self.collection.document(project_id).update(update_dict)
            
            # Return updated project
            return await self.get_project(project_id)
        except Exception as e:
            raise Exception(f"Failed to update project: {str(e)}")
    
    async def delete_project(self, project_id: str) -> bool:
        """Delete project and associated files"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            # Delete associated files from GCS
            if project.dataset.gcsPath:
                await self._delete_file(project.dataset.gcsPath)
            
            if project.model.gcsPath:
                await self._delete_file(project.model.gcsPath)
            
            # Delete from Firestore
            self.collection.document(project_id).delete()
            return True
        except Exception as e:
            raise Exception(f"Failed to delete project: {str(e)}")
    
    async def delete_multiple_projects(self, project_ids: List[str]) -> int:
        """Delete multiple projects and associated files"""
        deleted_count = 0
        errors = []
        
        for project_id in project_ids:
            try:
                await self.delete_project(project_id)
                deleted_count += 1
            except Exception as e:
                errors.append(f"Project {project_id}: {str(e)}")
                # Continue with other projects even if one fails
        
        # If some projects failed to delete, log the errors but don't fail the entire operation
        if errors:
            print(f"Some projects failed to delete: {errors}")
        
        return deleted_count
    
    async def upload_dataset(
        self, 
        project_id: str, 
        file_content: bytes, 
        filename: str, 
        content_type: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Upload dataset file to GCS and update project"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            # Generate GCS path
            gcs_path = f"datasets/{project_id}/{filename}"
            
            # Upload to GCS
            blob = self.bucket.blob(gcs_path)
            blob.upload_from_string(
                file_content,
                content_type=content_type,
                metadata=metadata or {}
            )
            
            # Create dataset object
            new_dataset = Dataset(
                filename=filename,
                size=len(file_content),
                records=metadata.get('records', 0) if metadata else 0,
                uploadedAt=datetime.now(timezone.utc),
                gcsPath=gcs_path
            )
            
            # Update project with new dataset
            update_data = {
                'dataset': new_dataset.model_dump(),
                'datasets': [new_dataset.model_dump()],  # Frontend compatibility
                'updatedAt': datetime.now(timezone.utc)
            }
            
            self.collection.document(project_id).update(update_data)
            
            return {
                'success': True,
                'gcsPath': gcs_path,
                'dataset': new_dataset.model_dump()
            }
        except Exception as e:
            raise Exception(f"Failed to upload dataset: {str(e)}")
    
    async def start_training(self, project_id: str, config: Optional[ProjectConfig] = None) -> Dict[str, Any]:
        """Start training job for a project"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            if not project.dataset.gcsPath:
                raise Exception("No dataset uploaded for this project")
            
            # Update project status
            update_data = {
                'status': 'training',
                'updatedAt': datetime.now(timezone.utc)
            }
            
            if config:
                update_data['config'] = config.model_dump()
            
            self.collection.document(project_id).update(update_data)
            
            # Publish training job to Pub/Sub
            training_job = {
                'projectId': project_id,
                'datasetPath': project.dataset.gcsPath,
                'config': (config or project.config).model_dump(),
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
            
            self.pubsub_client.publish(
                self.topic_path,
                str(training_job).encode('utf-8')
            )
            
            return {
                'success': True,
                'message': 'Training job started successfully'
            }
        except Exception as e:
            raise Exception(f"Failed to start training: {str(e)}")
    
    async def _delete_file(self, gcs_path: str) -> bool:
        """Delete file from GCS"""
        try:
            blob = self.bucket.blob(gcs_path)
            blob.delete()
            return True
        except Exception:
            return False
    
    async def search_projects(self, query: str, filters: Optional[Dict[str, Any]] = None) -> List[Project]:
        """Search projects by text and filters"""
        try:
            # Get all projects (in production, you'd implement proper search)
            projects = await self.get_projects(limit=1000)
            
            # Apply filters
            if filters:
                if filters.get('status'):
                    projects = [p for p in projects if p.status == filters['status']]
                if filters.get('type'):
                    projects = [p for p in projects if p.type == filters['type']]
                if filters.get('createdBy'):
                    projects = [p for p in projects if p.createdBy == filters['createdBy']]
            
            # Apply text search
            if query:
                query_lower = query.lower()
                projects = [
                    p for p in projects
                    if (query_lower in p.name.lower() or
                        query_lower in p.description.lower() or
                        any(query_lower in tag.lower() for tag in p.tags))
                ]
            
            return projects
        except Exception as e:
            raise Exception(f"Failed to search projects: {str(e)}")
    
    async def add_examples(self, project_id: str, examples: List[ExampleAdd]) -> Dict[str, Any]:
        """Add text examples to a project"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            # Convert examples to TextExample objects, handling comma-separated text
            text_examples = []
            for example in examples:
                # Split text by comma and create separate examples for each part
                text_parts = [part.strip() for part in example.text.split(',') if part.strip()]
                
                for text_part in text_parts:
                    text_example = TextExample(
                        text=text_part,
                        label=example.label,
                        addedAt=datetime.now(timezone.utc)
                    )
                    text_examples.append(text_example)
            
            # Update project with new examples
            current_examples = project.dataset.examples if project.dataset.examples else []
            previous_total = len(current_examples)
            updated_examples = current_examples + text_examples
            
            # Get unique labels
            labels = list(set([ex.label for ex in updated_examples]))
            
            # Update project
            update_data = {
                'dataset.examples': [ex.model_dump() for ex in updated_examples],
                'dataset.labels': labels,
                'dataset.records': len(updated_examples),
                'updatedAt': datetime.now(timezone.utc)
            }
            
            self.collection.document(project_id).update(update_data)
            
            return {
                'totalExamples': len(updated_examples),
                'previousTotal': previous_total,
                'labels': labels,
                'examples': [ex.model_dump() for ex in updated_examples]
            }
        except Exception as e:
            raise Exception(f"Failed to add examples: {str(e)}")
    
    async def get_examples(self, project_id: str) -> List[TextExample]:
        """Get all examples for a project"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            if not project.dataset.examples:
                return []
            
            # Convert back to TextExample objects
            examples = []
            for ex_data in project.dataset.examples:
                # Check if it's already a TextExample object
                if isinstance(ex_data, TextExample):
                    examples.append(ex_data)
                else:
                    # Convert dict to TextExample
                    example = TextExample(**ex_data)
                    examples.append(example)
            
            return examples
        except Exception as e:
            raise Exception(f"Failed to get examples: {str(e)}")
