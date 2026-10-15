from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
import time
import logging
import os

from .config import settings
from .api import (
    projects,
    health,
    teachers,
    students,
    classrooms,
    demo_projects,
    scratch_services,
    agents,
    agent_kb,
    knowledge,
    rules,
    chat,
    internal,
    training_chat,
    rule_based_process,
    rules_bot,
    confusion_matrix,
    rag_chatbot,
    copilot_lab,
    ai_agent,
    image_models,
    live_object_detection,
    deployed,
    exercises,
)
from .api.guests import router as guests_router
from .api.admin import is_production, require_admin

# --------------------------------------------------
# Logging
# --------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --------------------------------------------------
# FastAPI App
# --------------------------------------------------
_PRODUCTION = is_production()
app = FastAPI(
    title="YaaraLabs Playground API",
    description="Backend service for ML project management with GCP integration",
    version="1.0.0",
    # API docs only outside production (docs/hardening.md, item 12)
    docs_url=None if _PRODUCTION else "/docs",
    redoc_url=None if _PRODUCTION else "/redoc",
    # Ensure schema generation doesn't fail on errors
    openapi_url=None if _PRODUCTION else "/openapi.json",
)

# --------------------------------------------------
# CORS Configuration
# --------------------------------------------------
# Deployed frontend URLs come from CORS_ORIGIN (see deploy.ps1 / cloudbuild.yaml)
origins = [
    "https://scratch-editor-773717965404.us-central1.run.app",
    "http://localhost:3000",
    "http://localhost:8080",
    "http://localhost:8601",  # Scratch Editor GUI
    "http://localhost:8602",  # Scratch VM
]

# Allow dynamic origins from env (comma-separated)
if settings.cors_origin:
    extra_origins = [o.strip() for o in settings.cors_origin.split(",")]
    origins.extend([o for o in extra_origins if o])

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(set(origins)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # The Scratch editor reads the saved project version from these (Rule Based Process)
    expose_headers=["X-Scratch-Version", "ETag"],
)

# Trust all hosts (lock this down later if needed)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"],
)

# --------------------------------------------------
# Deployed models (api/deployed.py) can be called from any website
# --------------------------------------------------
# The CORS middleware above only allows our own sites. A deployed model URL is meant to be pasted
# into any app, so its routes answer every origin (no cookies are involved). Added after the CORS
# middleware, so it runs first and answers the preflight itself.
@app.middleware("http")
async def open_cors_for_deployed_models(request: Request, call_next):
    if not request.url.path.startswith("/api/deployed/"):
        return await call_next(request)
    response = Response(status_code=204) if request.method == "OPTIONS" else await call_next(request)
    if "access-control-allow-credentials" in response.headers:
        del response.headers["access-control-allow-credentials"]
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Max-Age"] = "600"
    return response

# --------------------------------------------------
# Request Timing Middleware
# --------------------------------------------------
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    response.headers["X-Process-Time"] = str(time.time() - start_time)
    return response

# --------------------------------------------------
# Global Exception Handler
# --------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "Internal server error",
            "details": [str(exc)] if settings.node_env == "development" else [],
        },
    )

# --------------------------------------------------
# Health Check (CRITICAL FOR CLOUD RUN)
# Supports both GET and HEAD for Cloud Run health checks
# --------------------------------------------------
@app.get("/health")
@app.head("/health")
def health_check():
    return {"status": "ok"}

# --------------------------------------------------
# Diagnostic Endpoint - Check Router Registration
# --------------------------------------------------
@app.get("/api/diagnostics/routes", dependencies=[Depends(require_admin)])
def check_routes():
    """Diagnostic endpoint to verify all routes are registered"""
    critical_paths = ["/agent", "/kb", "/rules", "/chat", "/training"]
    route_info = {}
    
    for prefix in critical_paths:
        routes = [r.path for r in app.routes if hasattr(r, 'path') and r.path.startswith(prefix)]
        route_info[prefix] = {
            "registered": len(routes) > 0,
            "count": len(routes),
            "sample_routes": routes[:5]  # First 5 routes
        }
    
    all_registered = all(info["registered"] for info in route_info.values())
    
    return {
        "status": "ok" if all_registered else "warning",
        "message": "All critical routes registered" if all_registered else "Some routes missing",
        "routes": route_info,
        "total_routes": len([r for r in app.routes if hasattr(r, 'path')])
    }

# --------------------------------------------------
# Routers
# --------------------------------------------------
app.include_router(health.router)
app.include_router(projects.router)
app.include_router(teachers.router)
app.include_router(students.router)
app.include_router(classrooms.router)
app.include_router(demo_projects.router)
app.include_router(guests_router)
app.include_router(scratch_services.router)
app.include_router(rule_based_process.router)
app.include_router(rules_bot.router)
app.include_router(confusion_matrix.router)
app.include_router(rag_chatbot.router)
app.include_router(copilot_lab.router)
app.include_router(ai_agent.router)
app.include_router(image_models.router)
app.include_router(live_object_detection.router)
app.include_router(deployed.router)
app.include_router(exercises.router)

# Agent / Chat APIs - with error handling to catch registration failures
logger.info("🔍 Attempting to register agent routers...")

# Register routers with explicit error handling and verification
# IMPORTANT: Router registration happens BEFORE service initialization
# Services are only initialized when endpoints are called (via Depends)
routers_to_register = [
    ("agents", agents.router, "/agent"),
    ("agent_kb", agent_kb.router, "/agent"),
    ("knowledge", knowledge.router, "/kb"),
    ("rules", rules.router, "/rules"),
    ("chat", chat.router, "/chat"),
    ("internal", internal.router, "/internal"),
    ("training_chat", training_chat.router, "/training"),
]

registered_count = 0
failed_routers = []

for name, router, prefix in routers_to_register:
    try:
        logger.info(f"🔍 Registering {name} router (prefix: {prefix})...")
        # Check if router exists
        if router is None:
            raise ValueError(f"Router {name} is None - import may have failed")
        
        # Register the router
        app.include_router(router)
        registered_count += 1
        logger.info(f"✅ {name.capitalize()} router registered successfully")
        
        # Verify it was added
        route_count_before = len([r for r in app.routes if hasattr(r, 'path') and r.path.startswith(prefix)])
        logger.info(f"   Routes with prefix {prefix}: {route_count_before}")
        
    except Exception as e:
        failed_routers.append(name)
        error_msg = f"❌ CRITICAL: Failed to register {name} router: {e}"
        logger.error(error_msg, exc_info=True)
        # Print to stderr as well to ensure visibility in Cloud Run logs
        import sys
        print(f"ERROR: Failed to register {name} router: {e}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc(file=sys.stderr)

if failed_routers:
    logger.error(f"❌ FAILED TO REGISTER ROUTERS: {failed_routers}")
    import sys
    print(f"CRITICAL ERROR: Failed to register routers: {failed_routers}", file=sys.stderr, flush=True)
else:
    logger.info(f"✅ Successfully registered {registered_count}/{len(routers_to_register)} routers")

logger.info(f"🔍 Total routes registered: {len(app.routes)}")

# Verify critical routes are present
critical_paths = ["/agent", "/kb", "/rules", "/chat", "/training"]
found_paths = []
route_paths_by_prefix = {path: [] for path in critical_paths}

for route in app.routes:
    if hasattr(route, 'path'):
        route_path = route.path
        for critical in critical_paths:
            if route_path.startswith(critical):
                found_paths.append(critical)
                route_paths_by_prefix[critical].append(route_path)
                break

# Log detailed route information
for prefix in critical_paths:
    routes = route_paths_by_prefix[prefix]
    if routes:
        logger.info(f"✅ Found {len(routes)} routes for {prefix}:")
        for r in routes[:5]:  # Show first 5
            logger.info(f"   - {r}")
        if len(routes) > 5:
            logger.info(f"   ... and {len(routes) - 5} more")
    else:
        logger.warning(f"⚠️ No routes found for {prefix}")

# Check if all critical routes are registered
missing_paths = set(critical_paths) - set(found_paths)
if missing_paths:
    logger.error(f"❌ CRITICAL: Missing route prefixes: {missing_paths}")
    import sys
    print(f"CRITICAL ERROR: Missing API route prefixes: {missing_paths}", file=sys.stderr, flush=True)
    print(f"This means the following APIs will NOT work: {missing_paths}", file=sys.stderr, flush=True)
else:
    logger.info(f"✅ All critical route prefixes verified: {critical_paths}")
    total_critical_routes = sum(len(routes) for routes in route_paths_by_prefix.values())
    logger.info(f"✅ Total critical API routes: {total_critical_routes}")

# --------------------------------------------------
# Startup / Shutdown (KEEP LIGHTWEIGHT)
# --------------------------------------------------
@app.on_event("startup")
async def startup_event():
    logger.info("✅ YaaraLabs Playground API starting")
    logger.info(f"Environment: {settings.node_env}")
    logger.info(f"GCP Project: {settings.google_cloud_project}")
    _warm_text_embedder()
    logger.info("🚀 Startup complete (no background workers)")


def _warm_text_embedder():
    """Load the Text Recognition sentence-embedding model in a background thread, so the first
    learner's training or prediction doesn't wait for it. Startup itself is not delayed."""
    import threading

    def warm():
        try:
            from .text_embed_service import embed_text_trainer
            embed_text_trainer.embedder.warm()
        except Exception as e:  # noqa: BLE001 - training / prediction will retry the load
            logger.warning(f"Text embedding model warm-up failed: {e}")

    threading.Thread(target=warm, name="text-embed-warmup", daemon=True).start()

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("🛑 Shutting down YaaraLabs Playground API")

# --------------------------------------------------
# Local Dev Entry Point (NOT used in Cloud Run)
# --------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=settings.node_env == "development",
    )
