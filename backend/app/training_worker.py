import json
import logging
from typing import Optional
from google.cloud import pubsub_v1
from google.cloud.exceptions import NotFound
import asyncio

from .training_job_service import training_job_service
from .config import gcp_clients

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TrainingWorker:
    """Worker that processes training jobs from Pub/Sub queue"""
    
    def __init__(self):
        # Lazy initialization - don't create clients until needed
        self._pubsub_client = None
        self._subscriber_client = None
        self._topic_path = None
        self.training_job_service = training_job_service
        
        # Worker configuration
        self.max_concurrent_jobs = 10  # Increased concurrent training jobs for better throughput
        self.running_jobs = set()
    
    @property
    def pubsub_client(self):
        """Lazy load pubsub client"""
        if self._pubsub_client is None:
            self._pubsub_client = gcp_clients.get_pubsub_client()
        return self._pubsub_client
    
    @property
    def subscriber_client(self):
        """Lazy load subscriber client"""
        if self._subscriber_client is None:
            self._subscriber_client = gcp_clients.get_subscriber_client()
        return self._subscriber_client
    
    @property
    def topic_path(self):
        """Lazy load topic path"""
        if self._topic_path is None:
            self._topic_path = gcp_clients.get_topic_path()
        return self._topic_path
    
    def get_subscription_path(self):
        """Get the subscription path for training jobs"""
        subscription_path = gcp_clients.get_subscription_path()
        logger.info(f"Using subscription: {subscription_path}")
        
        return subscription_path
    
    async def process_message(self, message):
        """Process a single message from the queue"""
        try:
            # Parse message
            data = json.loads(message.data.decode('utf-8'))
            logger.info(f"Processing message: {data}")
            
            # Extract job information
            job_id = data.get('jobId')
            action = data.get('action')
            
            if not job_id or action != 'start_training':
                logger.warning(f"Invalid message format: {data}")
                message.ack()
                return
            
            # Check if we can process more jobs
            if len(self.running_jobs) >= self.max_concurrent_jobs:
                logger.info(f"Max concurrent jobs reached ({self.max_concurrent_jobs}), skipping job {job_id}")
                # Don't ack the message, let it be retried
                return
            
            # Add job to running set
            self.running_jobs.add(job_id)
            
            try:
                # Process the training job
                logger.info(f"Starting training for job {job_id}")
                success = await self.training_job_service.process_training_job(job_id)
                
                if success:
                    logger.info(f"Training completed successfully for job {job_id}")
                    message.ack()
                else:
                    logger.error(f"Training failed for job {job_id}")
                    message.ack()  # Don't retry failed jobs
                    
            except Exception as e:
                logger.error(f"Error processing job {job_id}: {str(e)}")
                message.ack()  # Don't retry failed jobs
                
            finally:
                # Remove job from running set
                self.running_jobs.discard(job_id)
                
        except Exception as e:
            logger.error(f"Error processing message: {str(e)}")
            message.ack()  # Don't retry messages with parsing errors
    
    def start_worker(self):
        """Start the training worker"""
        logger.info("Starting training worker...")
        
        subscription_path = self.get_subscription_path()
        
        def callback(message):
            """Callback for processing messages"""
            try:
                # Run the async process_message in a new event loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(self.process_message(message))
                finally:
                    loop.close()
            except Exception as e:
                logger.error(f"Error in message callback: {str(e)}")
                message.ack()
        
        # Start listening for messages using SubscriberClient
        streaming_pull_future = self.subscriber_client.subscribe(
            subscription_path, callback=callback
        )
        
        logger.info(f"Listening for messages on {subscription_path}")
        
        try:
            # Keep the main thread alive
            streaming_pull_future.result()
        except KeyboardInterrupt:
            streaming_pull_future.cancel()
            logger.info("Worker stopped by user")
        except Exception as e:
            logger.error(f"Worker error: {str(e)}")
            streaming_pull_future.cancel()
    
    def stop_worker(self):
        """Stop the training worker"""
        logger.info("Stopping training worker...")
        # Cleanup logic here if needed


# Global worker instance
training_worker = TrainingWorker()


if __name__ == "__main__":
    # Start the worker when run directly
    training_worker.start_worker()
