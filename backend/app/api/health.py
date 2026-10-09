from fastapi import APIRouter
from datetime import datetime
import logging

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


@router.get("/health")
@router.head("/health")
async def health_check():
    """Health check endpoint for Cloud Run - supports both GET and HEAD"""
    try:
        # Check spaCy model availability (non-blocking, optional)
        import spacy
        nlp = spacy.load("en_core_web_sm")
        spacy_status = "available"
        spacy_test = "working"
    except ImportError:
        # spaCy not installed yet
        spacy_status = "not_installed"
        spacy_test = "pending_install"
    except OSError:
        # Model not downloaded yet, but this is not a critical failure
        spacy_status = "pending_download"
        spacy_test = "not_available"
    except Exception as e:
        logger.error(f"spaCy model check failed: {e}")
        spacy_status = "error"
        spacy_test = "failed"
    
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "YaaraLabs Playground API",
        "version": "1.0.0",
        "components": {
            "api": "healthy",
            "spacy_model": spacy_status,
            "spacy_test": spacy_test
        }
    }


@router.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "YaaraLabs Playground API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health"
    }
