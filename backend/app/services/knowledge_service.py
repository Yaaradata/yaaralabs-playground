import uuid
import logging
import requests
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from google.cloud import firestore, storage
from bs4 import BeautifulSoup
import re

from ..models import Knowledge, KnowledgeType, KnowledgeTextRequest, KnowledgeFileRequest, KnowledgeLinkRequest, KnowledgeQnARequest
from ..config import gcp_clients, settings
from .vertex_ai_service import VertexAIService
from .agent_service import AgentService

logger = logging.getLogger(__name__)


def clean_scraped_text(text: str) -> str:
    """
    Clean scraped web content by removing noise, URLs, base64 data, etc.
    This provides cleaner text for knowledge base storage.
    """
    # Remove base64 data URIs
    text = re.sub(r'data:[^,]+;base64,[A-Za-z0-9+/=]+', '', text)
    
    # Remove all URLs (http/https)
    text = re.sub(r'https?:\/\/\S+', '', text)
    
    # Remove markdown links [text](url) - keep only text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    
    # Remove relative URLs/paths like /explore/movies-chennai
    text = re.sub(r'\s*/[a-zA-Z0-9_\-/\?=&\.%~#]+', '', text)
    
    # Remove leftover brackets
    text = re.sub(r'[\[\]\(\)]', '', text)
    
    # Remove 'icon' noise
    text = re.sub(r'\bicon\b', '', text, flags=re.IGNORECASE)
    
    # Remove tel: links
    text = re.sub(r'tel:[0-9\-]+', '', text)
    
    # Remove common noise patterns (image extensions)
    text = re.sub(r'\b(svg|png|jpg|jpeg|webp|gif)\b', '', text, flags=re.IGNORECASE)
    
    # Convert all newlines to spaces (flatten text)
    text = text.replace('\n', ' ')
    
    # Normalize multiple spaces to single space
    text = re.sub(r'\s{2,}', ' ', text)
    
    return text.strip()


class KnowledgeService:
    """Service layer for knowledge base operations"""
    
    def __init__(self):
        self._firestore_client = None
        self._bucket = None
        self._project_id = None
        self._knowledge_collection = None
        self._vertex_ai = None
        self._agent_service = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """Lazy initialization - only initialize when first accessed"""
        if self._initialized:
            return
        
        try:
            self._firestore_client = gcp_clients.get_firestore_client()
            self._bucket = gcp_clients.get_bucket()
            self._project_id = gcp_clients.get_project_id()
            
            # Initialize collections
            self._knowledge_collection = self._firestore_client.collection('knowledge')
            
            # Initialize Vertex AI service
            self._vertex_ai = VertexAIService(self._project_id)
            
            # Initialize Agent Service for loading settings
            self._agent_service = AgentService()
            
            self._initialized = True
            logger.info("✅ KnowledgeService initialized")
        except Exception as e:
            logger.warning(f"⚠️ KnowledgeService initialization deferred (will retry on first use): {e}")
            # Don't raise - allow schema generation to proceed
    
    @property
    def firestore_client(self):
        self._ensure_initialized()
        return self._firestore_client
    
    @property
    def bucket(self):
        self._ensure_initialized()
        return self._bucket
    
    @property
    def project_id(self):
        if self._project_id is None:
            self._project_id = gcp_clients.get_project_id()
        return self._project_id
    
    @property
    def knowledge_collection(self):
        self._ensure_initialized()
        return self._knowledge_collection
    
    @property
    def vertex_ai(self):
        self._ensure_initialized()
        return self._vertex_ai
    
    @property
    def agent_service(self):
        self._ensure_initialized()
        return self._agent_service
    
    def _normalize_text(self, text: str) -> str:
        """Normalize text by removing extra whitespace and normalizing newlines"""
        # Remove extra whitespace
        text = text.strip()
        # Normalize multiple newlines
        text = re.sub(r'\n\s*\n+', '\n\n', text)
        # Normalize multiple spaces
        text = re.sub(r' +', ' ', text)
        return text
    
    def _chunk_text(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """Split text into chunks with overlap"""
        chunks = []
        words = text.split()
        
        for i in range(0, len(words), chunk_size - overlap):
            chunk = ' '.join(words[i:i + chunk_size])
            if chunk.strip():
                chunks.append(chunk)
        
        return chunks
    
    def _get_embedding_model_name(self, agent_id: str) -> str:
        """Get embedding model name from agent settings"""
        try:
            settings = self.agent_service.get_settings(agent_id)
            return settings.embedding_model if settings else "text-embedding-005"
        except Exception as e:
            logger.warning(f"⚠️ Failed to load embedding model from settings: {e}")
            return "text-embedding-005"
    
    def add_text_knowledge(self, request: KnowledgeTextRequest) -> dict:
        """Add text knowledge to agent with chunking support"""
        try:
            logger.info(f"Adding text knowledge for agent: {request.agent_id}")
            
            # Normalize text
            content = request.content.strip()
            content = re.sub(r'\n\s*\n+', '\n\n', content)  # Normalize multiple newlines
            
            # Check content length
            if len(content) > 10000:
                raise ValueError("Content exceeds maximum length of 10000 characters")
            
            # Chunk the text if it's long enough
            word_count = len(content.split())
            if word_count > 500:
                chunks = self._chunk_text(content, chunk_size=500, overlap=100)
            else:
                chunks = [content]
            
            # Get embedding model from settings
            embedding_model_name = self._get_embedding_model_name(request.agent_id)
            logger.info(f"🔤 Adding text knowledge - Using embedding model: {embedding_model_name}")
            
            # Generate embeddings for each chunk
            knowledge_ids = []
            for i, chunk in enumerate(chunks):
                # Generate embedding for this chunk
                embedding = self.vertex_ai.generate_embedding(chunk, embedding_model_name=embedding_model_name)
                
                # Create knowledge document
                knowledge_id = f"KB_{uuid.uuid4().hex[:12].upper()}"
                knowledge_data = {
                    "knowledge_id": knowledge_id,
                    "agent_id": request.agent_id,
                    "session_id": request.session_id,
                    "type": KnowledgeType.TEXT.value,
                    "source_type": "MANUAL",
                    "content": chunk,
                    "embedding": embedding,
                    "metadata": {
                        "chunk_index": i,
                        "total_chunks": len(chunks)
                    },
                    "priority": 1,
                    "created_at": datetime.now(timezone.utc)
                }
                
                # Save to Firestore
                knowledge_ref = self.knowledge_collection.document(knowledge_id)
                knowledge_ref.set(knowledge_data)
                knowledge_ids.append(knowledge_id)
            
            logger.info(f"✅ Text knowledge added: {len(knowledge_ids)} chunks")
            return {"knowledge_ids": knowledge_ids, "chunks_added": len(knowledge_ids)}
            
        except Exception as e:
            logger.error(f"❌ Failed to add text knowledge: {e}")
            raise Exception(f"Failed to add text knowledge: {str(e)}")
    
    def add_file_knowledge(
        self,
        agent_id: str,
        session_id: Optional[str],
        file_name: str,
        file_type: str,
        file_url: str,
        file_size: int,
        extracted_text: str,
        file_metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Add file knowledge to agent's KB.
        
        Args:
            agent_id: Agent ID
            session_id: Session ID for traceability
            file_name: Original file name
            file_type: File type (pdf, xlsx, csv, txt)
            file_url: GCS URL where file is stored
            file_size: File size in bytes
            extracted_text: Text extracted from the file
            file_metadata: Additional metadata from extraction (pages, sheets, etc.)
        
        Returns:
            Dict with knowledge_ids and chunks_added
        """
        try:
            logger.info(f"📁 Adding file knowledge for agent: {agent_id}, file: {file_name}")
            
            # Normalize the extracted text
            normalized_text = self._normalize_text(extracted_text)
            
            if not normalized_text.strip():
                raise ValueError("No text content to add")
            
            # Chunk the text
            chunks = self._chunk_text(normalized_text)
            logger.info(f"📄 Split into {len(chunks)} chunks")
            
            # Get embedding model from settings
            embedding_model_name = self._get_embedding_model_name(agent_id)
            logger.info(f"🔤 Adding file knowledge - Using embedding model: {embedding_model_name}")
            
            # Generate embeddings for each chunk
            embeddings = self.vertex_ai.generate_embeddings_batch(chunks, embedding_model_name=embedding_model_name)
            
            # Store each chunk as a separate knowledge entry
            knowledge_ids = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                knowledge_id = f"KB_FILE_{uuid.uuid4().hex[:12].upper()}"
                knowledge_data = {
                    "knowledge_id": knowledge_id,
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "type": KnowledgeType.FILE.value,
                    "source_type": "UPLOAD",
                    "content": chunk,
                    "embedding": embedding,
                    "metadata": {
                        "file_name": file_name,
                        "file_type": file_type,
                        "file_url": file_url,
                        "file_size": file_size,
                        "chunk_index": i,
                        "total_chunks": len(chunks),
                        **file_metadata  # Include pages, sheets, etc.
                    },
                    "priority": 1,
                    "created_at": datetime.now(timezone.utc)
                }
                
                knowledge_ref = self.knowledge_collection.document(knowledge_id)
                knowledge_ref.set(knowledge_data)
                knowledge_ids.append(knowledge_id)
                logger.info(f"✅ Stored chunk {i+1}/{len(chunks)}: {knowledge_id}")
            
            logger.info(f"✅ File knowledge added: {len(knowledge_ids)} chunks from {file_name}")
            return {
                "knowledge_ids": knowledge_ids,
                "chunks_added": len(knowledge_ids)
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to add file knowledge: {e}")
            raise Exception(f"Failed to add file knowledge: {str(e)}")
    
    def _extract_text_from_file(self, file_url: str) -> str:
        """Extract text from file (simplified implementation)"""
        try:
            # For GCS URLs, download the file
            if file_url.startswith("gs://"):
                # Parse GCS URL
                parts = file_url.replace("gs://", "").split("/", 1)
                bucket_name = parts[0]
                blob_name = parts[1] if len(parts) > 1 else ""
                
                # Download from GCS
                from ..config import gcp_clients
                storage_client = gcp_clients.get_storage_client()
                bucket = storage_client.bucket(bucket_name)
                blob = bucket.blob(blob_name)
                content = blob.download_as_text()
                return content
            else:
                # For HTTP URLs, download
                response = requests.get(file_url, timeout=30)
                response.raise_for_status()
                return response.text
                
        except Exception as e:
            logger.error(f"❌ Failed to extract text from file: {e}")
            raise Exception(f"Failed to extract text from file: {str(e)}")
    
    def _scrape_with_brightdata(self, url: str) -> Dict[str, Any]:
        """
        Scrape URL content using BrightData API.
        BrightData handles JavaScript rendering and provides better content extraction.
        
        Returns:
            Dict with 'text', 'page_title', and 'success' status
        """
        if not settings.brightdata_api_token:
            return {"success": False, "error": "BrightData API token not configured"}
        
        try:
            brightdata_url = f"https://api.brightdata.com/datasets/v3/scrape?dataset_id={settings.brightdata_dataset_id}&notify=false&include_errors=true"
            
            # Authorization header without "Bearer " prefix - matches BrightData API format
            headers = {
                "Authorization": settings.brightdata_api_token,
                "Content-Type": "application/json"
            }
            
            payload = {
                "input": [{"url": url}]
            }
            
            logger.info(f"🌐 Scraping with BrightData API: {url}")
            response = requests.post(
                brightdata_url,
                headers=headers,
                json=payload,
                timeout=60  # BrightData may take longer for JS rendering
            )
            
            response.raise_for_status()
            data = response.json()
            
            logger.info(f"📦 BrightData response keys: {data.keys() if isinstance(data, dict) else type(data)}")
            
            # BrightData returns html2text field with the converted text
            raw_text = ""
            page_title = url
            
            # Handle both single object and list responses
            if isinstance(data, list) and len(data) > 0:
                item = data[0]
                raw_text = item.get("html2text", "") or item.get("text", "") or item.get("content", "")
                page_title = item.get("title", "") or item.get("page_title", "") or url
            elif isinstance(data, dict):
                raw_text = data.get("html2text", "") or data.get("text", "") or data.get("content", "")
                page_title = data.get("title", "") or data.get("page_title", "") or url
            
            if not raw_text:
                logger.warning(f"⚠️ BrightData response structure: {data}")
                return {"success": False, "error": "No text content in BrightData response"}
            
            # Apply enhanced cleaning
            cleaned_text = clean_scraped_text(raw_text)
            
            logger.info(f"✅ BrightData scraped {len(raw_text)} chars, cleaned to {len(cleaned_text)} chars")
            
            return {
                "success": True,
                "text": cleaned_text,
                "page_title": page_title,
                "raw_chars": len(raw_text),
                "cleaned_chars": len(cleaned_text),
                "scrape_method": "brightdata"
            }
            
        except requests.exceptions.RequestException as e:
            logger.warning(f"⚠️ BrightData API request failed: {e}")
            return {"success": False, "error": str(e)}
        except Exception as e:
            logger.warning(f"⚠️ BrightData scraping error: {e}")
            return {"success": False, "error": str(e)}
    
    def _scrape_with_beautifulsoup(self, url: str) -> Dict[str, Any]:
        """
        Fallback scraping using requests + BeautifulSoup.
        Works for static HTML pages but may not capture JavaScript-rendered content.
        
        Returns:
            Dict with 'text', 'page_title', and 'success' status
        """
        # Multiple user agents to try if blocked
        user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ]
        
        last_error = None
        
        for user_agent in user_agents:
            try:
                # Create a session to handle cookies
                session = requests.Session()
                
                # More comprehensive browser-like headers
                headers = {
                    'User-Agent': user_agent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Cache-Control': 'max-age=0',
                }
                
                # First make a request to establish session/cookies
                response = session.get(url, timeout=30, headers=headers, allow_redirects=True)
                
                # Check for blocking
                if response.status_code == 403:
                    logger.warning(f"⚠️ Got 403 with user agent, trying next...")
                    last_error = f"403 Forbidden - Site is blocking scrapers"
                    continue
                    
                response.raise_for_status()
                break  # Success, exit the retry loop
                
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 403:
                    logger.warning(f"⚠️ Got 403 Forbidden, trying different user agent...")
                    last_error = str(e)
                    continue
                raise
            except Exception as e:
                last_error = str(e)
                continue
        else:
            # All user agents failed
            return {
                "success": False, 
                "error": f"Site blocked scraping (403 Forbidden). This website has anti-bot protection. Try using BrightData API for JavaScript-heavy sites. Last error: {last_error}"
            }
        
        # If we got here, we have a successful response
        try:
            # Parse HTML and extract text
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Get page title
            page_title = soup.title.string.strip() if soup.title and soup.title.string else url
            
            # Try to get meta description as fallback
            meta_description = ""
            meta_tag = soup.find('meta', attrs={'name': 'description'}) or soup.find('meta', attrs={'property': 'og:description'})
            if meta_tag and meta_tag.get('content'):
                meta_description = meta_tag.get('content', '')
            
            # Remove unwanted elements (but keep main content areas)
            for element in soup(["script", "style", "noscript", "iframe", "svg"]):
                element.decompose()
            
            # Try to find main content areas first
            main_content = soup.find('main') or soup.find('article') or soup.find(id='content') or soup.find(class_='content')
            
            if main_content:
                text = main_content.get_text(separator=' ', strip=True)
            else:
                # Remove nav, footer, etc. only if no main content found
                for element in soup(["nav", "footer", "header", "aside"]):
                    element.decompose()
                text = soup.get_text(separator=' ', strip=True)
            
            # Clean up text - normalize whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            
            # If still no text, try getting from body
            if len(text) < 100:
                body = soup.find('body')
                if body:
                    text = body.get_text(separator=' ', strip=True)
                    text = re.sub(r'\s+', ' ', text).strip()
            
            # Add meta description if main text is too short
            if len(text) < 200 and meta_description:
                text = f"{page_title}. {meta_description}. {text}"
            
            # Apply enhanced cleaning
            cleaned_text = clean_scraped_text(text)
            
            logger.info(f"✅ BeautifulSoup scraped {len(text)} chars, cleaned to {len(cleaned_text)} chars")
            
            return {
                "success": True,
                "text": cleaned_text,
                "page_title": page_title,
                "raw_chars": len(text),
                "cleaned_chars": len(cleaned_text),
                "scrape_method": "beautifulsoup"
            }
            
        except Exception as e:
            logger.error(f"❌ BeautifulSoup parsing error: {e}")
            return {"success": False, "error": str(e)}

    def add_link_knowledge(self, request: KnowledgeLinkRequest) -> Dict[str, Any]:
        """Add link knowledge to agent using BrightData API (preferred) or BeautifulSoup fallback"""
        try:
            logger.info(f"🔗 Adding link knowledge for agent: {request.agent_id}, URL: {request.url}")
            
            # Try BrightData first (better for JS-rendered content), then fallback to BeautifulSoup
            scrape_result = self._scrape_with_brightdata(request.url)
            
            if not scrape_result["success"]:
                logger.info(f"⚠️ BrightData failed, falling back to BeautifulSoup: {scrape_result.get('error', 'Unknown error')}")
                scrape_result = self._scrape_with_beautifulsoup(request.url)
            
            if not scrape_result["success"]:
                error_msg = scrape_result.get('error', 'Unknown error')
                # Provide helpful error messages
                if "403" in error_msg or "Forbidden" in error_msg:
                    raise ValueError(f"This website is blocking web scrapers. Try a different URL like a blog post, documentation page, or article. Dynamic sites like ticket booking, e-commerce checkouts, and login-required pages typically cannot be scraped.")
                elif "timeout" in error_msg.lower():
                    raise ValueError(f"The website took too long to respond. Please try again later.")
                else:
                    raise ValueError(f"Failed to scrape URL: {error_msg}")
            
            text = scrape_result["text"]
            page_title = scrape_result["page_title"]
            scrape_method = scrape_result.get("scrape_method", "unknown")
            
            logger.info(f"📝 Extracted {len(text)} chars from URL using {scrape_method}")
            
            if len(text) < 50:
                raise ValueError(f"Could not extract enough text from URL. This site may require JavaScript to render content. Only got {len(text)} characters.")
            
            # Chunk the text
            chunks = self._chunk_text(text)
            logger.info(f"📄 Split into {len(chunks)} chunks")
            
            # Get embedding model from settings
            embedding_model_name = self._get_embedding_model_name(request.agent_id)
            logger.info(f"🔤 Adding link knowledge - Using embedding model: {embedding_model_name}")
            
            # Generate embeddings for each chunk
            embeddings = self.vertex_ai.generate_embeddings_batch(chunks, embedding_model_name=embedding_model_name)
            
            # Store each chunk as a separate knowledge entry
            knowledge_ids = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                knowledge_id = f"KB_LINK_{uuid.uuid4().hex[:12].upper()}"
                knowledge_data = {
                    "knowledge_id": knowledge_id,
                    "agent_id": request.agent_id,
                    "session_id": request.session_id if hasattr(request, 'session_id') else None,
                    "type": KnowledgeType.LINK.value,
                    "source_type": "URL",
                    "content": chunk,
                    "embedding": embedding,
                    "metadata": {
                        "url": request.url,
                        "page_title": page_title,
                        "chunk_index": i,
                        "total_chunks": len(chunks),
                        "extracted_chars": len(text),
                        "scrape_method": scrape_method
                    },
                    "priority": 1,
                    "created_at": datetime.now(timezone.utc)
                }
                
                knowledge_ref = self.knowledge_collection.document(knowledge_id)
                knowledge_ref.set(knowledge_data)
                knowledge_ids.append(knowledge_id)
            
            logger.info(f"✅ Link knowledge added: {len(knowledge_ids)} chunks from {request.url} using {scrape_method}")
            return {
                "knowledge_ids": knowledge_ids,
                "chunks_added": len(knowledge_ids),
                "url": request.url,
                "page_title": page_title,
                "extracted_chars": len(text),
                "scrape_method": scrape_method
            }
            
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Failed to fetch URL {request.url}: {e}")
            raise Exception(f"Failed to fetch URL: {str(e)}")
        except Exception as e:
            logger.error(f"❌ Failed to add link knowledge: {e}")
            raise Exception(f"Failed to add link knowledge: {str(e)}")
    
    def add_qna_knowledge(self, request: KnowledgeQnARequest) -> str:
        """Add Q&A knowledge to agent"""
        try:
            logger.info(f"Adding Q&A knowledge for agent: {request.agent_id}")
            
            # Combine Q + A
            qna_content = f"Q: {request.question}\nA: {request.answer}"
            
            # Get embedding model from settings
            embedding_model_name = self._get_embedding_model_name(request.agent_id)
            logger.info(f"🔤 Adding Q&A knowledge - Using embedding model: {embedding_model_name}")
            
            # Generate embedding
            embedding = self.vertex_ai.generate_embedding(qna_content, embedding_model_name=embedding_model_name)
            
            # Create knowledge document with high priority
            knowledge_id = f"KB_{uuid.uuid4().hex[:12].upper()}"
            knowledge_data = {
                "knowledge_id": knowledge_id,
                "agent_id": request.agent_id,
                "type": KnowledgeType.QNA.value,
                "content": qna_content,
                "embedding": embedding,
                "metadata": {
                    "question": request.question,
                    "answer": request.answer
                },
                "priority": 10,  # High priority for Q&A
                "created_at": datetime.now(timezone.utc)
            }
            
            # Save to Firestore
            knowledge_ref = self.knowledge_collection.document(knowledge_id)
            knowledge_ref.set(knowledge_data)
            
            logger.info(f"✅ Q&A knowledge added: {knowledge_id}")
            return knowledge_id
            
        except Exception as e:
            logger.error(f"❌ Failed to add Q&A knowledge: {e}")
            raise Exception(f"Failed to add Q&A knowledge: {str(e)}")
    
    def list_knowledge(self, agent_id: str, kb_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all knowledge entries for an agent"""
        try:
            # First, get all knowledge for this agent
            query = self.knowledge_collection.where('agent_id', '==', agent_id)
            knowledge_refs = query.stream()
            
            knowledge_list = []
            for doc in knowledge_refs:
                data = doc.to_dict()
                
                # Filter by type if specified (case-insensitive)
                if kb_type:
                    doc_type = data.get('type', '').lower()
                    if doc_type != kb_type.lower():
                        continue
                
                # Remove embedding from response (too large)
                if 'embedding' in data:
                    del data['embedding']
                knowledge_list.append(data)
            
            # Sort by created_at descending
            knowledge_list.sort(key=lambda x: x.get('created_at', ''), reverse=True)
            
            logger.info(f"✅ Listed {len(knowledge_list)} knowledge entries for agent: {agent_id}")
            return knowledge_list
            
        except Exception as e:
            logger.error(f"❌ Failed to list knowledge: {e}")
            raise Exception(f"Failed to list knowledge: {str(e)}")
    
    def get_knowledge(self, knowledge_id: str) -> Optional[Dict[str, Any]]:
        """Get a single knowledge entry by ID"""
        try:
            knowledge_ref = self.knowledge_collection.document(knowledge_id)
            doc = knowledge_ref.get()
            
            if not doc.exists:
                return None
            
            data = doc.to_dict()
            # Remove embedding from response
            if 'embedding' in data:
                del data['embedding']
            
            return data
            
        except Exception as e:
            logger.error(f"❌ Failed to get knowledge: {e}")
            raise Exception(f"Failed to get knowledge: {str(e)}")
    
    def update_knowledge(self, knowledge_id: str, content: str) -> Dict[str, Any]:
        """Update a knowledge entry's content and regenerate embedding"""
        try:
            knowledge_ref = self.knowledge_collection.document(knowledge_id)
            doc = knowledge_ref.get()
            
            if not doc.exists:
                raise ValueError(f"Knowledge entry not found: {knowledge_id}")
            
            # Get agent_id from the document to load settings
            data = doc.to_dict()
            agent_id = data.get('agent_id')
            
            # Get embedding model from settings
            embedding_model_name = self._get_embedding_model_name(agent_id) if agent_id else None
            logger.info(f"🔤 Updating knowledge - Using embedding model: {embedding_model_name}")
            
            # Generate new embedding for updated content
            embedding = self.vertex_ai.generate_embedding(content, embedding_model_name=embedding_model_name)
            
            # Update document
            knowledge_ref.update({
                "content": content,
                "embedding": embedding,
                "updated_at": datetime.now(timezone.utc)
            })
            
            logger.info(f"✅ Knowledge updated: {knowledge_id}")
            return {"knowledge_id": knowledge_id, "updated": True}
            
        except Exception as e:
            logger.error(f"❌ Failed to update knowledge: {e}")
            raise Exception(f"Failed to update knowledge: {str(e)}")
    
    def delete_knowledge(self, knowledge_id: str) -> bool:
        """Delete a knowledge entry"""
        try:
            knowledge_ref = self.knowledge_collection.document(knowledge_id)
            doc = knowledge_ref.get()
            
            if not doc.exists:
                raise ValueError(f"Knowledge entry not found: {knowledge_id}")
            
            knowledge_ref.delete()
            
            logger.info(f"✅ Knowledge deleted: {knowledge_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to delete knowledge: {e}")
            raise Exception(f"Failed to delete knowledge: {str(e)}")

    def retrieve_knowledge(self, agent_id: str, query_embedding: List[float], top_k: int = 5, similarity_threshold: float = 0.7) -> List[Knowledge]:
        """
        Retrieve relevant knowledge using embedding similarity.
        
        Args:
            agent_id: The agent ID to search KB for
            query_embedding: The embedding vector of user's query
            top_k: Maximum number of results to return
            similarity_threshold: Minimum similarity score (0.0-1.0) to include KB
                                  - 0.3 = Only somewhat relevant content
                                  - 0.5 = Only moderately relevant content
                                  - 0.7 = Only highly relevant content
        """
        try:
            # Load agent settings to get similarity method
            settings = self.agent_service.get_settings(agent_id)
            similarity_method = settings.similarity if settings else "Cosine similarity"
            logger.info(f"📐 Using similarity method: {similarity_method}")
            
            # Get all knowledge for this agent
            knowledge_refs = self.knowledge_collection.where('agent_id', '==', agent_id).stream()
            
            # Calculate similarities
            similarities = []
            all_scores = []  # For logging
            for knowledge_doc in knowledge_refs:
                knowledge_data = knowledge_doc.to_dict()
                if 'embedding' in knowledge_data and knowledge_data['embedding']:
                    embedding = knowledge_data['embedding']
                    # Use the similarity method from settings
                    similarity = self.vertex_ai.calculate_similarity(query_embedding, embedding, method=similarity_method)
                    
                    # Boost Q&A knowledge
                    priority_boost = knowledge_data.get('priority', 1) / 10.0
                    final_score = similarity + (priority_boost * 0.1)
                    
                    # Log ALL scores for debugging
                    kb_preview = knowledge_data.get('content', '')[:100]
                    all_scores.append((final_score, knowledge_data.get('knowledge_id'), kb_preview))
                    
                    # Only include if above threshold
                    if final_score >= similarity_threshold:
                        similarities.append((final_score, knowledge_data))
                        logger.info(f"✅ KB MATCH: {knowledge_data.get('knowledge_id')} score={final_score:.3f} (method: {similarity_method})")
                    else:
                        logger.info(f"⚠️ KB below threshold: {knowledge_data.get('knowledge_id')} score={final_score:.3f} (threshold={similarity_threshold}, method: {similarity_method})")
            
            # Log all scores for debugging with similarity method name
            if all_scores:
                logger.info(f"📊 All KB similarity scores ({similarity_method}): {[(f'{s[0]:.3f}', s[1]) for s in all_scores]}")
            
            # Sort by similarity (descending)
            similarities.sort(key=lambda x: x[0], reverse=True)
            
            # Return top K (only those above threshold)
            top_knowledge = []
            for score, knowledge_data in similarities[:top_k]:
                knowledge_data['similarity_score'] = score
                top_knowledge.append(Knowledge(**knowledge_data))
            
            logger.info(f"✅ Retrieved {len(top_knowledge)} relevant KB entries (threshold={similarity_threshold})")
            return top_knowledge
            
        except Exception as e:
            logger.error(f"❌ Failed to retrieve knowledge: {e}")
            return []

