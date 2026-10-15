"""
Debug and maintenance routes are not for participants (docs/hardening.md, item 12).

Outside production (NODE_ENV != production) they work as before. In production they need the header
X-Admin-Token matching the ADMIN_TOKEN secret; without it they answer 404, as if they didn't exist.
If ADMIN_TOKEN isn't set in production they are simply off. /health stays open.
"""

from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException

from ..config import settings


def is_production() -> bool:
    return str(os.getenv("NODE_ENV", settings.node_env) or "").strip().lower() == "production"


def require_admin(x_admin_token: Optional[str] = Header(None)) -> None:
    if not is_production():
        return
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected or not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=404, detail="Not Found")
