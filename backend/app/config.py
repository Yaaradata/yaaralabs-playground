import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings
from google.cloud import firestore, storage, pubsub_v1
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class Settings(BaseSettings):
    # GCP Configuration
    google_cloud_project: str = Field(default="playgroundai-470111", env="GOOGLE_CLOUD_PROJECT")
    
    # Service Configuration
    port: int = Field(default=8080, env="PORT")
    node_env: str = Field(default="production", env="NODE_ENV")
    
    # GCP Resource Names
    firestore_database_id: str = Field(default="yaaralabs-playground", env="FIRESTORE_DATABASE_ID")
    gcs_bucket_name: str = Field(default="yaaralabs-playground-470111-data", env="GCS_BUCKET_NAME")
    pubsub_topic_name: str = Field(default="yaaralabs-train-jobs", env="PUBSUB_TOPIC_NAME")
    pubsub_subscription_name: str = Field(default="yaaralabs-trainer-sub", env="PUBSUB_SUBSCRIPTION_NAME")
    
    # Performance optimizations
    firestore_batch_size: int = Field(default=500, env="FIRESTORE_BATCH_SIZE")
    gcs_chunk_size: int = Field(default=8 * 1024 * 1024, env="GCS_CHUNK_SIZE")  # 8MB chunks
    
    # CORS Configuration
    cors_origin: str = Field(default="", env="CORS_ORIGIN")
    # Live Object Detection model saves: true = browser uploads straight to GCS with signed URLs
    # (needs the bucket CORS rule); false = files go through the backend
    image_models_signed_urls: bool = Field(default=False, env="IMAGE_MODELS_SIGNED_URLS")
    
    # Scratch Editor Configuration
    scratch_editor_url: str = Field(default="https://scratch-editor-773717965404.us-central1.run.app", env="SCRATCH_EDITOR_URL")
    
    # Security
    jwt_secret: str = Field(default="your-super-secret-jwt-key-here", env="JWT_SECRET")
    
    # Google Custom Search API (for image search)
    google_api_key: Optional[str] = Field(default=None, env="GOOGLE_API_KEY")
    google_cse_id: Optional[str] = Field(default=None, env="GOOGLE_CSE_ID")
    
    # BrightData Web Scraping API
    brightdata_api_token: Optional[str] = Field(default=None, env="BRIGHTDATA_API_TOKEN")
    brightdata_dataset_id: str = Field(default="gd_m6gjtfmeh43we6cqc", env="BRIGHTDATA_DATASET_ID")
    
    # Hugging Face API Token (for DistilBERT model downloads - avoids rate limiting)
    huggingface_token: Optional[str] = Field(default=None, env="HF_TOKEN")

    # OpenRouter: the OpenAI and Anthropic chat models in the model pickers (services/openrouter_service.py).
    # Gemini models keep going to Vertex AI.
    openrouter_api_key: Optional[str] = Field(default=None, env="OPENROUTER_API_KEY")
    
    class Config:
        env_file = ".env"


# Initialize settings
settings = Settings()


class GCPClients:
    """GCP client initialization using Application Default Credentials with lazy loading"""
    
    def __init__(self):
        self.project_id = settings.google_cloud_project
        self._firestore_client = None
        self._storage_client = None
        self._pubsub_client = None
        self._subscriber_client = None
        self._projects_collection = None
        self._bucket = None
        self._topic_path = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazy initialization - only initialize when first accessed"""
        if self._initialized:
            return
        
        try:
            # Initialize Firestore client
            self._firestore_client = firestore.Client(project=self.project_id, database=settings.firestore_database_id)
            self._projects_collection = self._firestore_client.collection('projects')
            
            # Initialize Storage client
            self._storage_client = storage.Client(project=self.project_id)
            self._bucket = self._storage_client.bucket(settings.gcs_bucket_name)
            
            # Initialize Pub/Sub clients
            self._pubsub_client = pubsub_v1.PublisherClient()
            self._subscriber_client = pubsub_v1.SubscriberClient()
            self._topic_path = self._pubsub_client.topic_path(
                self.project_id, 
                settings.pubsub_topic_name
            )
            
            self._initialized = True
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Failed to initialize GCP clients: {e}")
            # Don't raise - allow app to start, clients will be initialized on first use
            # In Cloud Run, credentials should be available when endpoints are called
    
    def get_firestore_client(self):
        self._ensure_initialized()
        return self._firestore_client
    
    def get_storage_client(self):
        self._ensure_initialized()
        return self._storage_client
    
    def get_pubsub_client(self):
        self._ensure_initialized()
        return self._pubsub_client
    
    def get_subscriber_client(self):
        self._ensure_initialized()
        return self._subscriber_client
    
    def get_projects_collection(self):
        self._ensure_initialized()
        return self._projects_collection
    
    def get_bucket(self):
        self._ensure_initialized()
        return self._bucket
    
    def get_topic_path(self):
        self._ensure_initialized()
        return self._topic_path
    
    def get_project_id(self):
        return self.project_id
    
    def get_topic_name(self):
        return settings.pubsub_topic_name
    
    def get_subscription_path(self):
        self._ensure_initialized()
        return self._subscriber_client.subscription_path(
            self.project_id, 
            settings.pubsub_subscription_name
        )


# Global GCP clients instance - lazy initialization
# This will NOT initialize clients at import time, only when first accessed
gcp_clients = GCPClients()
