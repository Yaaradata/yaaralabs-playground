"""The /admin area's API: admin signup and login (JWT), dashboard numbers, lists and clear actions.

Not to be confused with api/admin.py (the X-Admin-Token guard on debug routes). Every route except
signup, login and config needs `Authorization: Bearer <token>` from login; see
services/admin_auth.py for accounts and tokens, services/admin_dashboard_service.py for the data.
Destructive "all" actions also need the exact confirmation phrase in the body, so a stray request
can't wipe anything.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from ..config import settings
from ..services.admin_auth import AdminAuthError, AdminUserStore, create_token, public_user
from ..services.admin_dashboard_service import AdminDashboardService
from ..services.lod_limiter import SlidingWindowLimiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

CONFIRM_DELETE_ALL_PROJECTS = "DELETE ALL PROJECTS"
CONFIRM_CLEAR_SESSIONS = "CLEAR ALL SESSIONS"
CONFIRM_DELETE_ALL_MODELS = "DELETE ALL MODELS"
CONFIRM_CLEAR_EVERYTHING = "CLEAR EVERYTHING"

LOGIN_PER_MINUTE = 10
_login_limiter = SlidingWindowLimiter()
_bearer = HTTPBearer(auto_error=False)


def get_user_store() -> AdminUserStore:
    return AdminUserStore()


def get_dashboard() -> AdminDashboardService:
    return AdminDashboardService()


def _http(e: AdminAuthError) -> HTTPException:
    headers = {"WWW-Authenticate": "Bearer"} if e.status_code == 401 else None
    return HTTPException(status_code=e.status_code, detail=e.message, headers=headers)


def current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    store: AdminUserStore = Depends(get_user_store),
) -> Dict[str, Any]:
    if not credentials or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Please log in as an admin.", headers={"WWW-Authenticate": "Bearer"})
    try:
        return store.user_for_token(credentials.credentials)
    except AdminAuthError as e:
        raise _http(e)


def _limit_login(request: Request, email: str) -> None:
    ip = request.client.host if request.client else "unknown"
    for key in (f"ip:{ip}", f"email:{(email or '').strip().lower()}"):
        if not _login_limiter.allow(key, "admin-login", LOGIN_PER_MINUTE, 60.0):
            raise HTTPException(status_code=429, detail="Too many attempts. Wait a minute and try again.")


def _confirm(given: str, expected: str) -> None:
    if (given or "").strip() != expected:
        raise HTTPException(status_code=400, detail=f'Type "{expected}" to confirm.')


# ── accounts ──

class SignupBody(BaseModel):
    email: str = Field(..., max_length=254)
    name: str = Field(..., max_length=80)
    password: str = Field(..., max_length=200)
    signup_code: str = Field(..., max_length=200)


class LoginBody(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=200)


@router.get("/config")
def admin_config():
    """What the login page needs to know before anyone is signed in."""
    return {
        "login_enabled": len(settings.admin_jwt_secret or "") >= 32,
        "signup_enabled": bool(settings.admin_signup_code),
    }


@router.post("/signup", status_code=201)
def signup(body: SignupBody, request: Request, store: AdminUserStore = Depends(get_user_store)):
    _limit_login(request, body.email)
    try:
        user = store.signup(body.email, body.name, body.password, body.signup_code)
        logger.info("Admin account created: %s", user["email"])
        return {**create_token(user), "admin": public_user(user)}
    except AdminAuthError as e:
        raise _http(e)


@router.post("/login")
def login(body: LoginBody, request: Request, store: AdminUserStore = Depends(get_user_store)):
    _limit_login(request, body.email)
    try:
        user = store.login(body.email, body.password)
        return {**create_token(user), "admin": public_user(user)}
    except AdminAuthError as e:
        raise _http(e)


@router.get("/me")
def me(admin: Dict[str, Any] = Depends(current_admin)):
    return public_user(admin)


@router.get("/admins")
def list_admins(admin: Dict[str, Any] = Depends(current_admin), store: AdminUserStore = Depends(get_user_store)):
    return {"items": store.list()}


# ── dashboard ──

@router.get("/stats")
def stats(admin: Dict[str, Any] = Depends(current_admin), svc: AdminDashboardService = Depends(get_dashboard)):
    return svc.stats()


@router.get("/projects")
def projects(
    type: Optional[str] = None,
    status: Optional[str] = None,
    session_id: Optional[str] = None,
    owner: Optional[Literal["guest", "other"]] = None,
    search: Optional[str] = Query(None, max_length=200),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    sort: Literal["newest", "oldest", "name", "name_desc"] = "newest",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: Dict[str, Any] = Depends(current_admin),
    svc: AdminDashboardService = Depends(get_dashboard),
):
    return svc.list_projects(type=type, status=status, session_id=session_id, owner=owner, search=search,
                             date_from=date_from, date_to=date_to, sort=sort, limit=limit, offset=offset)


@router.get("/sessions")
def sessions(
    status: Optional[Literal["active", "expired", "inactive", "all"]] = None,
    search: Optional[str] = Query(None, max_length=200),
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    sort: Literal["newest", "oldest", "name", "name_desc"] = "newest",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: Dict[str, Any] = Depends(current_admin),
    svc: AdminDashboardService = Depends(get_dashboard),
):
    return svc.list_sessions(status=status, search=search, date_from=date_from, date_to=date_to,
                             sort=sort, limit=limit, offset=offset)


@router.get("/models")
def models(
    kind: Optional[Literal["text", "image"]] = None,
    search: Optional[str] = Query(None, max_length=200),
    orphaned: Optional[bool] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    sort: Literal["newest", "oldest", "name", "name_desc", "size", "files"] = "newest",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: Dict[str, Any] = Depends(current_admin),
    svc: AdminDashboardService = Depends(get_dashboard),
):
    return svc.list_models(kind=kind, search=search, orphaned=orphaned, date_from=date_from, date_to=date_to,
                           sort=sort, limit=limit, offset=offset)


@router.get("/audit")
def audit(limit: int = Query(50, ge=1, le=200), admin: Dict[str, Any] = Depends(current_admin),
          svc: AdminDashboardService = Depends(get_dashboard)):
    return {"items": svc.audit_log(limit)}


# ── clearing ──

class IdsBody(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=500)


class ConfirmBody(BaseModel):
    confirm: str = Field(..., max_length=100)


class ClearSessionsBody(BaseModel):
    confirm: str = Field("", max_length=100)
    session_ids: Optional[List[str]] = Field(None, max_length=500)
    expired_only: bool = False
    include_projects: bool = True


class ModelKeysBody(BaseModel):
    keys: List[str] = Field(..., min_length=1, max_length=500)


def _done(svc: AdminDashboardService, admin: Dict[str, Any], action: str, details: Dict[str, Any],
          result: Dict[str, Any]) -> Dict[str, Any]:
    svc.record(admin["email"], action, {**details, **result})
    logger.warning("Admin %s ran %s: %s", admin["email"], action, result)
    return {"success": True, **result}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, admin: Dict[str, Any] = Depends(current_admin),
                   svc: AdminDashboardService = Depends(get_dashboard)):
    result = svc.delete_projects([project_id])
    if not result["deleted_projects"]:
        raise HTTPException(status_code=404, detail="Project not found")
    return _done(svc, admin, "delete_project", {"project_id": project_id}, result)


@router.post("/projects/delete")
def delete_projects(body: IdsBody, admin: Dict[str, Any] = Depends(current_admin),
                    svc: AdminDashboardService = Depends(get_dashboard)):
    return _done(svc, admin, "delete_projects", {"count": len(body.ids)}, svc.delete_projects(body.ids))


@router.post("/projects/delete-all")
def delete_all_projects(body: ConfirmBody, admin: Dict[str, Any] = Depends(current_admin),
                        svc: AdminDashboardService = Depends(get_dashboard)):
    _confirm(body.confirm, CONFIRM_DELETE_ALL_PROJECTS)
    return _done(svc, admin, "delete_all_projects", {}, svc.delete_all_projects())


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, include_projects: bool = True, admin: Dict[str, Any] = Depends(current_admin),
                   svc: AdminDashboardService = Depends(get_dashboard)):
    result = svc.clear_sessions([session_id], include_projects=include_projects)
    if not result["deleted_sessions"]:
        raise HTTPException(status_code=404, detail="Session not found")
    return _done(svc, admin, "delete_session", {"session_id": session_id}, result)


@router.post("/sessions/clear")
def clear_sessions(body: ClearSessionsBody, admin: Dict[str, Any] = Depends(current_admin),
                   svc: AdminDashboardService = Depends(get_dashboard)):
    """Selected sessions (session_ids), or all of them (needs the phrase); expired_only keeps active ones."""
    if body.session_ids is None and not body.expired_only:
        _confirm(body.confirm, CONFIRM_CLEAR_SESSIONS)
    result = svc.clear_sessions(body.session_ids, expired_only=body.expired_only,
                                include_projects=body.include_projects)
    details = {"expired_only": body.expired_only, "include_projects": body.include_projects,
               "selected": len(body.session_ids) if body.session_ids is not None else "all"}
    return _done(svc, admin, "clear_sessions", details, result)


@router.post("/models/delete")
def delete_models(body: ModelKeysBody, admin: Dict[str, Any] = Depends(current_admin),
                  svc: AdminDashboardService = Depends(get_dashboard)):
    result = svc.delete_models(body.keys)
    if result["rejected"] and not result["deleted_models"]:
        raise HTTPException(status_code=400, detail="Those are not model folders.")
    return _done(svc, admin, "delete_models", {"count": len(body.keys)}, result)


@router.post("/models/delete-all")
def delete_all_models(body: ConfirmBody, admin: Dict[str, Any] = Depends(current_admin),
                      svc: AdminDashboardService = Depends(get_dashboard)):
    _confirm(body.confirm, CONFIRM_DELETE_ALL_MODELS)
    return _done(svc, admin, "delete_all_models", {}, svc.delete_all_models())


@router.post("/clear-everything")
def clear_everything(body: ConfirmBody, admin: Dict[str, Any] = Depends(current_admin),
                     svc: AdminDashboardService = Depends(get_dashboard)):
    _confirm(body.confirm, CONFIRM_CLEAR_EVERYTHING)
    return _done(svc, admin, "clear_everything", {}, svc.clear_everything())
