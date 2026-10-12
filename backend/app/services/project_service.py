import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from google.cloud import firestore
from google.cloud import storage
from google.cloud import pubsub_v1

from ..models import Project, ProjectCreate, ProjectUpdate, Dataset, TrainedModel, ProjectConfig, TextExample, ExampleAdd, ImageExampleAdd
from ..config import gcp_clients

logger = logging.getLogger(__name__)


class ProjectService:
    """Service layer for project management operations"""
    
    def __init__(self):
        self.collection = gcp_clients.get_projects_collection()
        self.bucket = gcp_clients.get_bucket()
        self.topic_path = gcp_clients.get_topic_path()
        self.pubsub_client = gcp_clients.get_pubsub_client()
    
    def _deserialize_project_data(self, data: dict) -> dict:
        """Helper method to properly deserialize nested objects from Firestore"""
        # Handle invalid project type enum values
        if 'type' in data and data['type'] not in ['text-recognition', 'image-recognition', 'image-recognition-teachable-machine', 'pose-recognition-teachable-machine', 'classification', 'regression', 'custom', 'rule-based-process', 'live-object-detection', 'exercises', 'confusion-matrix', 'rag-chatbot', 'ai-agent']:
            logger.warning(f"Invalid project type '{data['type']}' found, defaulting to 'text-recognition'")
            data['type'] = 'text-recognition'
        
        # Handle nested object deserialization
        if 'dataset' in data and isinstance(data['dataset'], dict):
            # Convert examples from dicts to TextExample objects
            if 'examples' in data['dataset'] and isinstance(data['dataset']['examples'], list):
                examples = []
                for example_data in data['dataset']['examples']:
                    if isinstance(example_data, dict):
                        examples.append(TextExample(**example_data))
                    else:
                        examples.append(example_data)
                data['dataset']['examples'] = examples
            
            # Convert image_examples from dicts to ImageExampleAdd objects
            if 'image_examples' in data['dataset'] and isinstance(data['dataset']['image_examples'], list):
                image_examples = []
                for example_data in data['dataset']['image_examples']:
                    if isinstance(example_data, dict):
                        image_examples.append(ImageExampleAdd(**example_data))
                    else:
                        image_examples.append(example_data)
                data['dataset']['image_examples'] = image_examples
            else:
                # Ensure image_examples field exists for backward compatibility
                data['dataset']['image_examples'] = []
            
            # Convert dataset dict to Dataset object
            data['dataset'] = Dataset(**data['dataset'])
        
        # Handle model deserialization
        if 'model' in data and isinstance(data['model'], dict):
            data['model'] = TrainedModel(**data['model'])
        
        # Handle config deserialization
        if 'config' in data and data['config'] is not None and isinstance(data['config'], dict):
            data['config'] = ProjectConfig(**data['config'])
        
        # Handle datasets list deserialization
        if 'datasets' in data and isinstance(data['datasets'], list):
            datasets = []
            for dataset_data in data['datasets']:
                if isinstance(dataset_data, dict):
                    # Handle examples in each dataset
                    if 'examples' in dataset_data and isinstance(dataset_data['examples'], list):
                        examples = []
                        for example_data in dataset_data['examples']:
                            if isinstance(example_data, dict):
                                examples.append(TextExample(**example_data))
                            else:
                                examples.append(example_data)
                        dataset_data['examples'] = examples
                    datasets.append(Dataset(**dataset_data))
                else:
                    datasets.append(dataset_data)
            data['datasets'] = datasets
        
        return data
    
    async def create_project(self, project_data: ProjectCreate) -> Project:
        """Create a new project"""
        try:
            project_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc)
            
            # For teachable machine projects, don't use training config since they use Teachable Machine
            # For regular projects, use training config like text recognition
            config = None
            if project_data.type not in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"]:
                config = project_data.config or ProjectConfig()
            
            project = Project(
                id=project_id,
                name=project_data.name,
                description=project_data.description,
                type=project_data.type,
                createdBy=project_data.createdBy,
                teacher_id=project_data.teacher_id,
                classroom_id=project_data.classroom_id,
                student_id=project_data.student_id,
                tags=project_data.tags,
                notes=project_data.notes,
                config=config,
                teachable_machine_link=project_data.teachable_machine_link,
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
                data = self._deserialize_project_data(data)
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
        created_by: Optional[str] = None,
        guest_session_id: Optional[str] = None
    ) -> List[Project]:
        """Get all projects with optional filtering"""
        try:
            # For guest session filtering, use a simpler approach to avoid index requirements
            if guest_session_id:
                # Query only by student_id for guest sessions
                query = self.collection.where('student_id', '==', guest_session_id)
                docs = query.get()
                
                # Convert to projects and apply in-memory filtering and sorting
                all_projects = []
                for doc in docs:
                    data = doc.to_dict()
                    data = self._deserialize_project_data(data)
                    project = Project(**data)
                    
                    # Apply additional filters in memory
                    if status and project.status != status:
                        continue
                    if type and project.type != type:
                        continue
                    if created_by and project.createdBy != created_by:
                        continue
                    
                    all_projects.append(project)
                
                # Sort by creation date (descending)
                all_projects.sort(key=lambda p: p.createdAt, reverse=True)
                
                # Apply pagination
                start_idx = offset
                end_idx = offset + limit
                projects = all_projects[start_idx:end_idx]
                
                return projects
            else:
                # For non-guest queries, use the original approach
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
                    data = self._deserialize_project_data(data)
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
            for field, value in update_data.model_dump(exclude_unset=True).items():
                if hasattr(project, field):
                    # Special handling for config field based on project type
                    if field == 'config':
                        # For teachable machine projects, don't save config
                        # For regular projects, save config like text recognition
                        if update_data.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"] or (update_data.type is None and project.type in ["image-recognition-teachable-machine", "pose-recognition-teachable-machine"]):
                            setattr(project, field, None)
                        else:
                            setattr(project, field, value)
                    else:
                        setattr(project, field, value)
            
            project.updatedAt = datetime.now(timezone.utc)
            
            # Update Firestore
            project_dict = project.model_dump()
            self.collection.document(project_id).set(project_dict)
            
            return project
        except Exception as e:
            raise Exception(f"Failed to update project: {str(e)}")
    
    async def delete_project(self, project_id: str) -> bool:
        """Delete project by ID"""
        try:
            project = await self.get_project(project_id)
            if not project:
                return False  # Project doesn't exist, return False instead of raising exception
            
            # Delete from Firestore
            self.collection.document(project_id).delete()
            
            # TODO: Clean up associated files in GCS
            # TODO: Clean up training jobs
            
            return True
        except Exception as e:
            raise Exception(f"Failed to delete project: {str(e)}")
    
    async def delete_multiple_projects(self, project_ids: List[str]) -> int:
        """Delete multiple projects by IDs"""
        try:
            deleted_count = 0
            for project_id in project_ids:
                try:
                    success = await self.delete_project(project_id)
                    if success:
                        deleted_count += 1
                except Exception as e:
                    print(f"Warning: Failed to delete project {project_id}: {str(e)}")
                    continue
            
            return deleted_count
        except Exception as e:
            raise Exception(f"Failed to delete multiple projects: {str(e)}")
    
    async def search_projects(self, search_query: str, filters: Dict[str, Any]) -> List[Project]:
        """Search projects by query and filters"""
        try:
            # Extract guest session filter if present
            guest_session_id = filters.pop('guest_session_id', None)
            
            # Get all projects first (in production, you'd use a search service)
            # For guest sessions, we get all projects for that session to search through
            all_projects = await self.get_projects(
                limit=1000, 
                guest_session_id=guest_session_id,
                status=None,  # Don't filter in get_projects, we'll filter in memory
                type=None,
                created_by=None
            )
            
            # Apply search filter
            search_lower = search_query.lower()
            filtered_projects = []
            
            for project in all_projects:
                # Check if project matches search query
                if (search_lower in project.name.lower() or 
                    search_lower in project.description.lower() or
                    any(search_lower in tag.lower() for tag in project.tags)):
                    
                    # Apply additional filters
                    matches_filters = True
                    for filter_key, filter_value in filters.items():
                        if hasattr(project, filter_key):
                            project_value = getattr(project, filter_key)
                            if project_value != filter_value:
                                matches_filters = False
                                break
                    
                    if matches_filters:
                        filtered_projects.append(project)
            
            return filtered_projects
        except Exception as e:
            raise Exception(f"Failed to search projects: {str(e)}")
    
    async def upload_dataset(self, project_id: str, file_content: bytes, filename: str, content_type: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Upload dataset file for a project"""
        try:
            # Get project
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            # Generate GCS path
            gcs_path = f"datasets/{project_id}/{filename}"
            
            # Upload to GCS
            blob = self.bucket.blob(gcs_path)
            blob.upload_from_string(file_content, content_type=content_type)
            
            # Update project dataset
            project.dataset.filename = filename
            project.dataset.size = len(file_content)
            project.dataset.uploadedAt = datetime.now(timezone.utc)
            project.dataset.gcsPath = f"gs://{self.bucket.name}/{gcs_path}"
            
            # Update metadata
            if metadata.get('records'):
                project.dataset.records = metadata['records']
            if metadata.get('description'):
                project.dataset.description = metadata['description']
            
            # Update Firestore
            project_dict = project.model_dump()
            self.collection.document(project_id).set(project_dict)
            
            return {
                'success': True,
                'gcsPath': project.dataset.gcsPath
            }
        except Exception as e:
            raise Exception(f"Failed to upload dataset: {str(e)}")
    
    async def add_examples(self, project_id: str, examples: List[ExampleAdd], split: bool = True,
                           skip_existing: bool = False) -> Dict[str, Any]:
        """Add text examples to a project.

        split: split each text on commas (the manual box's "Example 1, Example 2" format).
        skip_existing: skip a text already under the same label (case and spacing ignored).
        """
        try:
            # Get project
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            # Get current examples count
            previous_total = len(project.dataset.examples)
            
            def key(label: str, text: str) -> tuple:
                return label, " ".join(text.lower().split())

            existing = {key(e.label, e.text) for e in project.dataset.examples} if skip_existing else set()
            skipped = 0

            # Add new examples
            for example_data in examples:
                if split:
                    # Split comma-separated text into multiple examples
                    texts = [text.strip() for text in example_data.text.split(',') if text.strip()]
                else:
                    texts = [example_data.text.strip()] if example_data.text.strip() else []

                for text in texts:
                    if skip_existing:
                        k = key(example_data.label, text)
                        if k in existing:
                            skipped += 1
                            continue
                        existing.add(k)
                    example = TextExample(
                        text=text,
                        label=example_data.label
                    )
                    project.dataset.examples.append(example)
            
            # Update labels list with stable ordering (new labels at top, existing order preserved)
            existing_labels = project.dataset.labels or []
            new_labels = [example.label for example in project.dataset.examples]
            
            # Create ordered labels: new labels first (in order of appearance), then existing labels
            ordered_labels = []
            seen_labels = set()
            
            # Add new labels first (in order of appearance in examples)
            for label in new_labels:
                if label not in seen_labels:
                    ordered_labels.append(label)
                    seen_labels.add(label)
            
            # Add existing labels that weren't in new labels (preserving their order)
            for label in existing_labels:
                if label not in seen_labels:
                    ordered_labels.append(label)
                    seen_labels.add(label)
            
            project.dataset.labels = ordered_labels
            project.dataset.records = len(project.dataset.examples)
            
            # Update Firestore
            project_dict = project.model_dump()
            self.collection.document(project_id).set(project_dict)
            
            return {
                'totalExamples': len(project.dataset.examples),
                'previousTotal': previous_total,
                'labels': project.dataset.labels,
                'skipped': skipped,
            }
        except Exception as e:
            raise Exception(f"Failed to add examples: {str(e)}")
    
    async def get_examples(self, project_id: str) -> List[TextExample]:
        """Get all examples for a project"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            return project.dataset.examples
        except Exception as e:
            raise Exception(f"Failed to get examples: {str(e)}")
    
    async def add_image_examples(self, project_id: str, image_examples: List[dict]) -> Dict[str, Any]:
        """Add image examples to a project"""
        try:
            # Get project
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            # Get current image examples count
            previous_total = len(project.dataset.image_examples)
            
            # Add new image examples
            for image_data in image_examples:
                image_example = ImageExampleAdd(
                    image_url=image_data["image_url"],
                    label=image_data["label"],
                    filename=image_data["filename"]
                )
                project.dataset.image_examples.append(image_example)
            
            # Update labels list with stable ordering (new labels at top, existing order preserved)
            # IMPORTANT: Preserve empty labels even if they have no examples
            existing_labels = project.dataset.labels or []
            new_text_labels = [example.label for example in project.dataset.examples]
            new_image_labels = [example.label for example in project.dataset.image_examples]
            
            # Create ordered labels: new labels first (in order of appearance), then existing labels
            ordered_labels = []
            seen_labels = set()
            
            # Add new image labels first (in order of appearance in examples)
            for label in new_image_labels:
                if label not in seen_labels:
                    ordered_labels.append(label)
                    seen_labels.add(label)
            
            # Add new text labels (in order of appearance in examples)
            for label in new_text_labels:
                if label not in seen_labels:
                    ordered_labels.append(label)
                    seen_labels.add(label)
            
            # Add existing labels that weren't in new labels (preserving their order)
            # This preserves empty labels even when they have no examples
            for label in existing_labels:
                if label not in seen_labels:
                    ordered_labels.append(label)
                    seen_labels.add(label)
            
            project.dataset.labels = ordered_labels
            
            # Update records count (total examples)
            project.dataset.records = len(project.dataset.examples) + len(project.dataset.image_examples)
            
            # Update Firestore
            project_dict = project.model_dump()
            self.collection.document(project_id).set(project_dict)
            
            return {
                'totalImages': len(project.dataset.image_examples),
                'totalExamples': project.dataset.records,
                'previousTotal': previous_total,
                'labels': project.dataset.labels
            }
        except Exception as e:
            raise Exception(f"Failed to add image examples: {str(e)}")
    
    async def get_image_examples(self, project_id: str) -> List[ImageExampleAdd]:
        """Get all image examples for a project"""
        try:
            project = await self.get_project(project_id)
            if not project:
                raise Exception("Project not found")
            
            return project.dataset.image_examples
        except Exception as e:
            raise Exception(f"Failed to get image examples: {str(e)}")
    
    async def save_project(self, project: Project) -> Project:
        """Save complete project to Firestore"""
        try:
            project.updatedAt = datetime.now(timezone.utc)
            project_dict = project.model_dump()
            self.collection.document(project.id).set(project_dict)
            return project
        except Exception as e:
            raise Exception(f"Failed to save project: {str(e)}")