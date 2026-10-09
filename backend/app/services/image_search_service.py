"""
Image Search Service using Google Custom Search API
Fetches relevant images based on query context
"""
import logging
import httpx
from typing import List, Dict, Any, Optional

from ..config import settings

logger = logging.getLogger(__name__)


class ImageSearchService:
    """Service for searching relevant images using Google Custom Search API"""
    
    BASE_URL = "https://www.googleapis.com/customsearch/v1"
    
    def __init__(self):
        self.api_key = settings.google_api_key
        self.cse_id = settings.google_cse_id
        self._enabled = bool(self.api_key and self.cse_id)
        
        if self._enabled:
            logger.info("✅ ImageSearchService initialized with Google Custom Search")
        else:
            logger.warning("⚠️ ImageSearchService disabled - missing GOOGLE_API_KEY or GOOGLE_CSE_ID")
    
    @property
    def is_enabled(self) -> bool:
        """Check if image search is available"""
        return self._enabled
    
    def search_images(
        self, 
        query: str, 
        num_images: int = 3,
        safe_search: str = "active"
    ) -> List[Dict[str, Any]]:
        """
        Search for relevant images using Google Custom Search API
        
        Args:
            query: Search query string
            num_images: Number of images to return (max 10)
            safe_search: Safe search level ("active", "moderate", "off")
            
        Returns:
            List of image results with url, title, thumbnail, source
        """
        if not self._enabled:
            logger.debug("Image search skipped - service not configured")
            return []
        
        try:
            # Limit to max 10 images per API constraints
            num_images = min(num_images, 10)
            
            # Build search params
            params = {
                "key": self.api_key,
                "cx": self.cse_id,
                "q": query,
                "searchType": "image",
                "num": num_images,
                "safe": safe_search,
                "imgSize": "large",  # large size for better quality
                "imgType": "photo",   # prefer photos over clipart/drawings
            }
            
            logger.info(f"🖼️ Searching images for: '{query[:50]}...'")
            
            # Make synchronous request
            with httpx.Client(timeout=10.0) as client:
                response = client.get(self.BASE_URL, params=params)
                response.raise_for_status()
                data = response.json()
            
            # Parse results
            images = []
            items = data.get("items", [])
            
            for item in items:
                image_data = {
                    "url": item.get("link", ""),
                    "title": item.get("title", "Image"),
                    "thumbnail": item.get("image", {}).get("thumbnailLink", ""),
                    "width": item.get("image", {}).get("width", 0),
                    "height": item.get("image", {}).get("height", 0),
                    "source": item.get("displayLink", ""),
                    "context_url": item.get("image", {}).get("contextLink", "")
                }
                
                # Only include if we have a valid URL
                if image_data["url"]:
                    images.append(image_data)
            
            logger.info(f"🖼️ Found {len(images)} relevant images")
            return images
            
        except httpx.TimeoutException:
            logger.warning("⏱️ Image search timed out")
            return []
        except httpx.HTTPStatusError as e:
            logger.error(f"❌ Image search HTTP error: {e.response.status_code}")
            return []
        except Exception as e:
            logger.error(f"❌ Image search failed: {str(e)}")
            return []
    
    async def search_images_async(
        self, 
        query: str, 
        num_images: int = 3,
        safe_search: str = "active"
    ) -> List[Dict[str, Any]]:
        """
        Async version of image search
        
        Args:
            query: Search query string
            num_images: Number of images to return (max 10)
            safe_search: Safe search level
            
        Returns:
            List of image results
        """
        if not self._enabled:
            return []
        
        try:
            num_images = min(num_images, 10)
            
            params = {
                "key": self.api_key,
                "cx": self.cse_id,
                "q": query,
                "searchType": "image",
                "num": num_images,
                "safe": safe_search,
                "imgSize": "large",
                "imgType": "photo",
            }
            
            logger.info(f"🖼️ [Async] Searching images for: '{query[:50]}...'")
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(self.BASE_URL, params=params)
                response.raise_for_status()
                data = response.json()
            
            images = []
            for item in data.get("items", []):
                image_data = {
                    "url": item.get("link", ""),
                    "title": item.get("title", "Image"),
                    "thumbnail": item.get("image", {}).get("thumbnailLink", ""),
                    "width": item.get("image", {}).get("width", 0),
                    "height": item.get("image", {}).get("height", 0),
                    "source": item.get("displayLink", ""),
                    "context_url": item.get("image", {}).get("contextLink", "")
                }
                if image_data["url"]:
                    images.append(image_data)
            
            logger.info(f"🖼️ [Async] Found {len(images)} relevant images")
            return images
            
        except Exception as e:
            logger.error(f"❌ Async image search failed: {str(e)}")
            return []
    
    def extract_search_terms(self, message: str, response: str) -> str:
        """
        Extract optimal search terms from message and response
        Uses key nouns/topics rather than full sentences
        
        Args:
            message: User's message
            response: AI's response text
            
        Returns:
            Optimized search query string
        """
        # Combine message with first part of response for context
        combined = f"{message} {response[:200] if len(response) > 200 else response}"
        
        # Remove common stop words and punctuation for cleaner search
        import re
        
        # Clean up the text
        cleaned = re.sub(r'[^\w\s]', ' ', combined.lower())
        
        # Common words to filter out
        stop_words = {
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
            'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
            'before', 'after', 'above', 'below', 'between', 'under', 'again',
            'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
            'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
            'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
            'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
            'about', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
            'those', 'am', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me',
            'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
            'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves',
            'themselves', 'tell', 'please', 'help', 'want', 'know', 'think',
            'like', 'get', 'make', 'see', 'look', 'find', 'give', 'use'
        }
        
        # Extract meaningful words
        words = cleaned.split()
        meaningful_words = [w for w in words if w not in stop_words and len(w) > 2]
        
        # Take first 5 meaningful words for focused search
        search_terms = ' '.join(meaningful_words[:5])
        
        return search_terms if search_terms else message[:50]


# Singleton instance
_image_search_service: Optional[ImageSearchService] = None


def get_image_search_service() -> ImageSearchService:
    """Get or create singleton ImageSearchService instance"""
    global _image_search_service
    if _image_search_service is None:
        _image_search_service = ImageSearchService()
    return _image_search_service

