#!/usr/bin/env python3
"""
Database Cleanup Script
This script clears all data from Firestore collections and Google Cloud Storage
to provide a clean database for fresh testing.
"""

import asyncio
from google.cloud import firestore
from google.cloud import storage
from app.config import gcp_clients


class DatabaseCleaner:
    """Clean up all data from Firestore and Google Cloud Storage"""
    
    def __init__(self):
        self.firestore_client = gcp_clients.get_firestore_client()
        self.storage_client = gcp_clients.get_storage_client()
        self.bucket = gcp_clients.get_bucket()
    
    async def clear_firestore_collections(self):
        """Clear all data from Firestore collections"""
        print("Clearing Firestore collections...")
        
        # Collections to clear
        collections = [
            'teachers_classrooms',
            'students', 
            'demo_projects',
            'projects',
            'training_jobs',
            'models'
        ]
        
        for collection_name in collections:
            try:
                print(f"  Clearing collection: {collection_name}")
                collection_ref = self.firestore_client.collection(collection_name)
                
                # Get all documents in the collection
                docs = collection_ref.get()
                deleted_count = 0
                
                for doc in docs:
                    doc.reference.delete()
                    deleted_count += 1
                
                print(f"    Deleted {deleted_count} documents from {collection_name}")
                
            except Exception as e:
                print(f"    Error clearing {collection_name}: {str(e)}")
    
    async def clear_storage_bucket(self):
        """Clear all files and folders from Google Cloud Storage bucket"""
        print(f"\nClearing Google Cloud Storage bucket: {self.bucket.name}")
        
        try:
            # List all blobs (files and folders) in the bucket recursively
            blobs = self.bucket.list_blobs()
            deleted_count = 0
            
            # Convert to list and sort by name length (longest first) to delete nested items first
            blob_list = list(blobs)
            blob_list.sort(key=lambda x: len(x.name), reverse=True)
            
            for blob in blob_list:
                try:
                    blob.delete()
                    deleted_count += 1
                    print(f"  Deleted: {blob.name}")
                except Exception as e:
                    print(f"  Error deleting {blob.name}: {str(e)}")
            
            print(f"  Total items deleted: {deleted_count}")
            
        except Exception as e:
            print(f"  Error accessing bucket: {str(e)}")
    
    async def clear_all_data(self):
        """Clear all data from both Firestore and Storage"""
        print("Starting database cleanup...")
        print("=" * 50)
        
        # Clear Firestore collections
        await self.clear_firestore_collections()
        
        # Clear Storage bucket
        await self.clear_storage_bucket()
        
        print("\n" + "=" * 50)
        print("Database cleanup completed!")
        print("All Firestore collections and Storage files have been removed.")
        print("You now have a clean database for fresh testing.")


async def main():
    """Main cleanup function"""
    cleaner = DatabaseCleaner()
    
    try:
        await cleaner.clear_all_data()
    except Exception as e:
        print(f"Cleanup failed: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the cleanup
    asyncio.run(main())
