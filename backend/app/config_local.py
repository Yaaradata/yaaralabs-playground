import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings
from google.cloud import firestore, storage, pubsub_v1
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class LocalSettings(BaseSettings):
    # GCP Configuration
    google_cloud_project: str = Field(default="playgroundai-470111", env="GOOGLE_CLOUD_PROJECT")
    
    # Service Configuration
    port: int = Field(default=8000, env="PORT")
    node_env: str = Field(default="development", env="NODE_ENV")
    
    # GCP Resource Names
    firestore_database_id: str = Field(default="yaaralabs-playground", env="FIRESTORE_DATABASE_ID")
    gcs_bucket_name: str = Field(default="yaaralabs-playground-470111-data", env="GCS_BUCKET_NAME")
    pubsub_topic_name: str = Field(default="yaaralabs-train-jobs", env="PUBSUB_TOPIC_NAME")
    pubsub_subscription_name: str = Field(default="yaaralabs-trainer-sub", env="PUBSUB_SUBSCRIPTION_NAME")
    
    # CORS Configuration - Allow localhost for development
    cors_origin: str = Field(default="*", env="CORS_ORIGIN")
    
    # Security
    jwt_secret: str = Field(default="your-super-secret-jwt-key-here", env="JWT_SECRET")
    
    # Google Custom Search API (for image search)
    google_api_key: Optional[str] = Field(default=None, env="GOOGLE_API_KEY")
    google_cse_id: Optional[str] = Field(default=None, env="GOOGLE_CSE_ID")
    
    # BrightData Web Scraping API
    brightdata_api_token: Optional[str] = Field(default=None, env="BRIGHTDATA_API_TOKEN")
    brightdata_dataset_id: str = Field(default="gd_m6gjtfmeh43we6cqc", env="BRIGHTDATA_DATASET_ID")
    
    class Config:
        env_file = ".env"


# Initialize local settings
local_settings = LocalSettings()


class GCPClients:
    """GCP client initialization using Application Default Credentials"""
    
    def __init__(self):
        self.project_id = local_settings.google_cloud_project
        
        # Initialize Firestore client
        self.firestore_client = firestore.Client(project=self.project_id, database=local_settings.firestore_database_id)
        self.projects_collection = self.firestore_client.collection('projects')
        
        # Initialize Storage client
        self.storage_client = storage.Client(project=self.project_id)
        self.bucket = self.storage_client.bucket(local_settings.gcs_bucket_name)
        
        # Initialize Pub/Sub clients
        self.pubsub_client = pubsub_v1.PublisherClient()
        self.subscriber_client = pubsub_v1.SubscriberClient()
        self.topic_path = self.pubsub_client.topic_path(
            self.project_id, 
            local_settings.pubsub_topic_name
        )
    
    def get_firestore_client(self):
        return self.firestore_client
    
    def get_storage_client(self):
        return self.storage_client
    
    def get_pubsub_client(self):
        return self.pubsub_client
    
    def get_subscriber_client(self):
        return self.subscriber_client
    
    def get_projects_collection(self):
        return self.projects_collection
    
    def get_bucket(self):
        return self.bucket
    
    def get_topic_path(self):
        return self.topic_path
    
    def get_project_id(self):
        return self.project_id
    
    def get_topic_name(self):
        return local_settings.pubsub_topic_name
    
    def get_subscription_path(self):
        return self.subscriber_client.subscription_path(
            self.project_id, 
            local_settings.pubsub_subscription_name
        )


# Global GCP clients instance for local development
gcp_clients = GCPClients()
