#!/usr/bin/env python3
"""
Thorough Storage Cleanup Script
This script specifically handles folder structures and empty folders in Google Cloud Storage
"""

import asyncio
from google.cloud import storage
from app.config import gcp_clients


class StorageFolderCleaner:
    """Clean up all folders and files from Google Cloud Storage bucket"""
    
    def __init__(self):
        self.storage_client = gcp_clients.get_storage_client()
        self.bucket = gcp_clients.get_bucket()
    
    async def clear_storage_completely(self):
        """Clear all files and folders from Google Cloud Storage bucket"""
        print(f"Thoroughly clearing Google Cloud Storage bucket: {self.bucket.name}")
        print("=" * 60)
        
        try:
            # Method 1: List and delete all blobs
            print("Method 1: Deleting all blobs...")
            blobs = list(self.bucket.list_blobs())
            print(f"  Found {len(blobs)} blobs")
            
            deleted_count = 0
            for blob in blobs:
                try:
                    print(f"    Deleting: {blob.name}")
                    blob.delete()
                    deleted_count += 1
                except Exception as e:
                    print(f"    Error deleting {blob.name}: {str(e)}")
            
            print(f"  Deleted {deleted_count} blobs")
            
            # Method 2: Try to delete specific known folders
            print("\nMethod 2: Attempting to delete known folder structures...")
            known_folders = [
                "models/",
                "datasets/",
                "projects/",
                "uploads/",
                "temp/"
            ]
            
            for folder in known_folders:
                try:
                    # Try to delete the folder (this might not work for empty folders)
                    blobs_in_folder = list(self.bucket.list_blobs(prefix=folder))
                    if blobs_in_folder:
                        print(f"  Found {len(blobs_in_folder)} items in {folder}")
                        for blob in blobs_in_folder:
                            try:
                                blob.delete()
                                print(f"    Deleted: {blob.name}")
                            except Exception as e:
                                print(f"    Error deleting {blob.name}: {str(e)}")
                    else:
                        print(f"  Folder {folder} appears to be empty")
                except Exception as e:
                    print(f"  Error processing folder {folder}: {str(e)}")
            
            # Method 3: List all remaining blobs to confirm cleanup
            print("\nMethod 3: Verifying cleanup...")
            remaining_blobs = list(self.bucket.list_blobs())
            print(f"  Remaining blobs: {len(remaining_blobs)}")
            
            if remaining_blobs:
                print("  Remaining items:")
                for blob in remaining_blobs:
                    print(f"    - {blob.name}")
            else:
                print("  ✅ All items successfully deleted!")
            
        except Exception as e:
            print(f"Error during storage cleanup: {str(e)}")
            import traceback
            traceback.print_exc()
    
    async def list_bucket_contents(self):
        """List all contents of the bucket for inspection"""
        print(f"\nListing all contents of bucket: {self.bucket.name}")
        print("=" * 60)
        
        try:
            blobs = list(self.bucket.list_blobs())
            
            if not blobs:
                print("  Bucket is completely empty")
                return
            
            print(f"  Found {len(blobs)} items:")
            
            # Group by folder
            folders = {}
            for blob in blobs:
                if '/' in blob.name:
                    folder = blob.name.split('/')[0] + '/'
                    if folder not in folders:
                        folders[folder] = []
                    folders[folder].append(blob.name)
                else:
                    if 'root' not in folders:
                        folders['root'] = []
                    folders['root'].append(blob.name)
            
            for folder, items in folders.items():
                print(f"\n  📁 {folder}:")
                for item in items:
                    print(f"    - {item}")
                    
        except Exception as e:
            print(f"Error listing bucket contents: {str(e)}")


async def main():
    """Main cleanup function"""
    cleaner = StorageFolderCleaner()
    
    try:
        # First list what's in the bucket
        await cleaner.list_bucket_contents()
        
        # Then perform thorough cleanup
        await cleaner.clear_storage_completely()
        
        # Finally list again to confirm cleanup
        await cleaner.list_bucket_contents()
        
    except Exception as e:
        print(f"Cleanup failed: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the cleanup
    asyncio.run(main())
