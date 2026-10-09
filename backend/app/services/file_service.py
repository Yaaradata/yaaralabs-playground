"""
File Service - Handles file uploads to GCS and text extraction
"""
import os
import io
import logging
from typing import Optional, Tuple, List, Dict, Any
from datetime import datetime, timezone
import uuid

from google.cloud import storage
import PyPDF2
import pdfplumber
import pandas as pd
from openpyxl import load_workbook

logger = logging.getLogger(__name__)


class FileService:
    """Service for handling file uploads and text extraction"""
    
    # File size limits (in bytes)
    SIZE_LIMITS = {
        'pdf': 2 * 1024 * 1024,      # 2 MB
        'xlsx': 1 * 1024 * 1024,     # 1 MB
        'xls': 1 * 1024 * 1024,      # 1 MB
        'csv': 1 * 1024 * 1024,      # 1 MB
        'txt': 1 * 1024 * 1024,      # 1 MB
    }
    
    # Allowed MIME types
    ALLOWED_TYPES = {
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-excel': 'xls',
        'text/csv': 'csv',
        'text/plain': 'txt',
        'application/csv': 'csv',
    }
    
    def __init__(self, bucket_name: str = None):
        """Initialize GCS client and bucket"""
        from ..config import gcp_clients, settings
        self.storage_client = gcp_clients.get_storage_client()
        self.bucket_name = bucket_name or settings.gcs_bucket_name
        
        # Bucket is provisioned by infra/setup_gcp.sh; never create one implicitly
        try:
            self.bucket = self.storage_client.bucket(self.bucket_name)
            logger.info(f"✅ FileService initialized with bucket: {self.bucket_name}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize GCS bucket: {e}")
            raise
    
    def validate_file(self, filename: str, content_type: str, file_size: int) -> Tuple[bool, str, str]:
        """
        Validate file type and size.
        
        Returns:
            Tuple of (is_valid, error_message, file_type)
        """
        # Get file extension
        ext = filename.lower().split('.')[-1] if '.' in filename else ''
        
        # Check content type
        if content_type not in self.ALLOWED_TYPES:
            return False, f"Unsupported file type: {content_type}. Allowed: PDF, Excel, CSV, TXT", ""
        
        file_type = self.ALLOWED_TYPES[content_type]
        
        # Verify extension matches content type
        if file_type != ext and not (file_type == 'txt' and ext in ['txt', 'text']):
            # Allow some flexibility
            pass
        
        # Check size limit
        size_limit = self.SIZE_LIMITS.get(file_type, 1 * 1024 * 1024)
        if file_size > size_limit:
            limit_mb = size_limit / (1024 * 1024)
            actual_mb = file_size / (1024 * 1024)
            return False, f"File too large: {actual_mb:.2f}MB. Limit for {file_type.upper()}: {limit_mb}MB", file_type
        
        return True, "", file_type
    
    def upload_to_gcs(self, file_content: bytes, agent_id: str, filename: str, file_type: str) -> str:
        """
        Upload file to GCS bucket.
        
        Returns:
            GCS file URL (gs://bucket/path)
        """
        # Generate unique filename
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        unique_id = uuid.uuid4().hex[:8]
        safe_filename = f"{timestamp}_{unique_id}_{filename}"
        
        # Path structure: agents/{agent_id}/files/{filename}
        blob_path = f"agents/{agent_id}/files/{safe_filename}"
        
        try:
            blob = self.bucket.blob(blob_path)
            
            # Set content type
            content_type_map = {
                'pdf': 'application/pdf',
                'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'xls': 'application/vnd.ms-excel',
                'csv': 'text/csv',
                'txt': 'text/plain',
            }
            content_type = content_type_map.get(file_type, 'application/octet-stream')
            
            # Upload with explicit content_type in the call
            blob.upload_from_string(file_content, content_type=content_type)
            
            gcs_url = f"gs://{self.bucket_name}/{blob_path}"
            logger.info(f"✅ File uploaded to GCS: {gcs_url}")
            return gcs_url
            
        except Exception as e:
            logger.error(f"❌ Failed to upload file to GCS: {e}")
            raise Exception(f"Failed to upload file: {str(e)}")
    
    def extract_text(self, file_content: bytes, file_type: str, filename: str) -> Tuple[str, Dict[str, Any]]:
        """
        Extract text from file based on type.
        
        Returns:
            Tuple of (extracted_text, metadata)
        """
        try:
            if file_type == 'pdf':
                return self._extract_from_pdf(file_content)
            elif file_type in ['xlsx', 'xls']:
                return self._extract_from_excel(file_content, file_type)
            elif file_type == 'csv':
                return self._extract_from_csv(file_content)
            elif file_type == 'txt':
                return self._extract_from_txt(file_content)
            else:
                raise ValueError(f"Unsupported file type: {file_type}")
                
        except Exception as e:
            logger.error(f"❌ Failed to extract text from {filename}: {e}")
            raise Exception(f"Failed to extract text: {str(e)}")
    
    def _extract_from_pdf(self, file_content: bytes) -> Tuple[str, Dict[str, Any]]:
        """Extract text from PDF using pdfplumber (better for tables)"""
        text_parts = []
        metadata = {"pages": 0, "has_tables": False}
        
        try:
            # Try pdfplumber first (better for tables)
            with pdfplumber.open(io.BytesIO(file_content)) as pdf:
                metadata["pages"] = len(pdf.pages)
                
                for i, page in enumerate(pdf.pages):
                    page_text = page.extract_text() or ""
                    
                    # Extract tables
                    tables = page.extract_tables()
                    if tables:
                        metadata["has_tables"] = True
                        for table in tables:
                            # Convert table to text format
                            if table:
                                table_text = self._table_to_text(table)
                                page_text += f"\n\n[Table on page {i+1}]\n{table_text}"
                    
                    if page_text.strip():
                        text_parts.append(f"[Page {i+1}]\n{page_text}")
            
            full_text = "\n\n".join(text_parts)
            logger.info(f"✅ Extracted {len(full_text)} chars from PDF ({metadata['pages']} pages)")
            return full_text, metadata
            
        except Exception as e:
            logger.warning(f"⚠️ pdfplumber failed, trying PyPDF2: {e}")
            
            # Fallback to PyPDF2
            try:
                reader = PyPDF2.PdfReader(io.BytesIO(file_content))
                metadata["pages"] = len(reader.pages)
                
                for i, page in enumerate(reader.pages):
                    page_text = page.extract_text() or ""
                    if page_text.strip():
                        text_parts.append(f"[Page {i+1}]\n{page_text}")
                
                full_text = "\n\n".join(text_parts)
                logger.info(f"✅ Extracted {len(full_text)} chars from PDF using PyPDF2")
                return full_text, metadata
                
            except Exception as e2:
                raise Exception(f"PDF extraction failed: {str(e2)}")
    
    def _extract_from_excel(self, file_content: bytes, file_type: str) -> Tuple[str, Dict[str, Any]]:
        """Extract text from Excel file"""
        text_parts = []
        metadata = {"sheets": [], "total_rows": 0}
        
        try:
            # Read all sheets
            excel_file = pd.ExcelFile(io.BytesIO(file_content))
            metadata["sheets"] = excel_file.sheet_names
            
            for sheet_name in excel_file.sheet_names:
                df = pd.read_excel(excel_file, sheet_name=sheet_name)
                metadata["total_rows"] += len(df)
                
                # Convert to readable text
                sheet_text = f"[Sheet: {sheet_name}]\n"
                sheet_text += f"Columns: {', '.join(df.columns.astype(str))}\n\n"
                
                # Convert dataframe to string representation
                for idx, row in df.iterrows():
                    row_text = " | ".join([f"{col}: {val}" for col, val in row.items() if pd.notna(val)])
                    if row_text:
                        sheet_text += f"Row {idx+1}: {row_text}\n"
                
                text_parts.append(sheet_text)
            
            full_text = "\n\n".join(text_parts)
            logger.info(f"✅ Extracted {len(full_text)} chars from Excel ({len(metadata['sheets'])} sheets, {metadata['total_rows']} rows)")
            return full_text, metadata
            
        except Exception as e:
            raise Exception(f"Excel extraction failed: {str(e)}")
    
    def _extract_from_csv(self, file_content: bytes) -> Tuple[str, Dict[str, Any]]:
        """Extract text from CSV file"""
        metadata = {"rows": 0, "columns": []}
        
        try:
            # Try to detect encoding
            try:
                content_str = file_content.decode('utf-8')
            except UnicodeDecodeError:
                content_str = file_content.decode('latin-1')
            
            df = pd.read_csv(io.StringIO(content_str))
            metadata["rows"] = len(df)
            metadata["columns"] = list(df.columns)
            
            # Convert to readable text
            text_parts = []
            text_parts.append(f"Columns: {', '.join(df.columns.astype(str))}\n")
            
            for idx, row in df.iterrows():
                row_text = " | ".join([f"{col}: {val}" for col, val in row.items() if pd.notna(val)])
                if row_text:
                    text_parts.append(f"Row {idx+1}: {row_text}")
            
            full_text = "\n".join(text_parts)
            logger.info(f"✅ Extracted {len(full_text)} chars from CSV ({metadata['rows']} rows)")
            return full_text, metadata
            
        except Exception as e:
            raise Exception(f"CSV extraction failed: {str(e)}")
    
    def _extract_from_txt(self, file_content: bytes) -> Tuple[str, Dict[str, Any]]:
        """Extract text from plain text file"""
        metadata = {"lines": 0}
        
        try:
            # Try to detect encoding
            try:
                text = file_content.decode('utf-8')
            except UnicodeDecodeError:
                text = file_content.decode('latin-1')
            
            metadata["lines"] = len(text.split('\n'))
            logger.info(f"✅ Extracted {len(text)} chars from TXT ({metadata['lines']} lines)")
            return text, metadata
            
        except Exception as e:
            raise Exception(f"TXT extraction failed: {str(e)}")
    
    def _table_to_text(self, table: List[List]) -> str:
        """Convert table data to readable text format"""
        if not table or not table[0]:
            return ""
        
        # First row as headers
        headers = [str(h) if h else "" for h in table[0]]
        rows = []
        
        for row in table[1:]:
            if row:
                row_dict = {}
                for i, cell in enumerate(row):
                    if i < len(headers) and cell:
                        row_dict[headers[i]] = str(cell)
                if row_dict:
                    rows.append(" | ".join([f"{k}: {v}" for k, v in row_dict.items()]))
        
        return f"Headers: {', '.join(headers)}\n" + "\n".join(rows)
    
    def download_file(self, gcs_url: str) -> tuple:
        """
        Download a file from GCS.
        
        Args:
            gcs_url: The gs:// URL of the file
        
        Returns:
            Tuple of (file_content_bytes, content_type)
        """
        try:
            if not gcs_url.startswith('gs://'):
                raise ValueError(f"Invalid GCS URL: {gcs_url}")
            
            # Parse gs:// URL
            path = gcs_url.replace(f'gs://{self.bucket_name}/', '')
            blob = self.bucket.blob(path)
            
            # Download file content
            file_content = blob.download_as_bytes()
            content_type = blob.content_type or 'application/octet-stream'
            
            logger.info(f"✅ Downloaded file from GCS: {gcs_url}")
            return file_content, content_type
            
        except Exception as e:
            logger.error(f"❌ Failed to download file from GCS: {e}")
            raise Exception(f"Failed to download file: {str(e)}")
    
    def delete_from_gcs(self, gcs_url: str) -> bool:
        """Delete file from GCS"""
        try:
            # Parse gs:// URL
            if gcs_url.startswith('gs://'):
                path = gcs_url.replace(f'gs://{self.bucket_name}/', '')
                blob = self.bucket.blob(path)
                blob.delete()
                logger.info(f"✅ Deleted file from GCS: {gcs_url}")
                return True
            return False
        except Exception as e:
            logger.error(f"❌ Failed to delete from GCS: {e}")
            return False


# Singleton instance getter
_file_service_instance = None

def get_file_service() -> FileService:
    """Get or create FileService singleton"""
    global _file_service_instance
    if _file_service_instance is None:
        _file_service_instance = FileService()
    return _file_service_instance


