"""Admin accounts for the /admin area: passwords, JWTs and the `admin_users` collection.

  Firestore  admin_users/<email>  {email, name, password_hash, role: "admin", active,
                                   created_at, last_login_at}

Passwords are hashed with bcrypt. Tokens are HS256 JWTs signed with ADMIN_JWT_SECRET (backend/.env);
without a secret of 32+ characters admin login is off. Signup needs ADMIN_SIGNUP_CODE from the same
file; without it signup is off. Every admin request re-reads the account, so a deleted or
deactivated admin loses access at once even with a valid token.
"""

from __future__ import annotations

import hmac
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
from jose import JWTError, jwt

from ..config import gcp_clients, settings

ADMIN_USERS = "admin_users"
ALGORITHM = "HS256"
ISSUER = "yaaralabs-admin"
MIN_SECRET_LENGTH = 32
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt only reads the first 72 bytes
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AdminAuthError(Exception):
    """A refusal the route turns into an HTTP error: status code and a message for the person."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def validate_email(email: str) -> str:
    email = normalize_email(email)
    if not _EMAIL.match(email) or len(email) > 254:
        raise AdminAuthError(400, "Enter a valid email address.")
    return email


def validate_password(password: str) -> None:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise AdminAuthError(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise AdminAuthError(400, f"Password must be at most {MAX_PASSWORD_BYTES} bytes.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise AdminAuthError(400, "Password must contain at least one letter and one number.")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:MAX_PASSWORD_BYTES], password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# A real hash to check against when the email is unknown, so a wrong email takes as long as a wrong password
_DUMMY_HASH = hash_password("not-a-real-password-0")


def jwt_secret() -> str:
    secret = settings.admin_jwt_secret or ""
    if len(secret) < MIN_SECRET_LENGTH:
        raise AdminAuthError(503, "Admin login isn't configured on the server (ADMIN_JWT_SECRET).")
    return secret


def create_token(user: Dict[str, Any]) -> Dict[str, Any]:
    now = _now()
    expires = now + timedelta(minutes=max(5, settings.admin_jwt_expire_minutes))
    claims = {
        "sub": user["email"],
        "name": user.get("name", ""),
        "role": "admin",
        "iss": ISSUER,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return {
        "access_token": jwt.encode(claims, jwt_secret(), algorithm=ALGORITHM),
        "token_type": "bearer",
        "expires_at": expires.isoformat(),
    }


def decode_token(token: str) -> Dict[str, Any]:
    try:
        claims = jwt.decode(token, jwt_secret(), algorithms=[ALGORITHM], issuer=ISSUER)
    except JWTError:
        raise AdminAuthError(401, "Your admin session has expired. Please log in again.")
    if claims.get("role") != "admin" or not claims.get("sub"):
        raise AdminAuthError(401, "Not an admin token.")
    return claims


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    def iso(v):
        return v.isoformat() if isinstance(v, datetime) else v

    return {
        "email": user.get("email"),
        "name": user.get("name", ""),
        "role": user.get("role", "admin"),
        "active": user.get("active", True),
        "created_at": iso(user.get("created_at")),
        "last_login_at": iso(user.get("last_login_at")),
    }


class AdminUserStore:
    def __init__(self, db=None):
        self._db = db

    @property
    def collection(self):
        return (self._db or gcp_clients.get_firestore_client()).collection(ADMIN_USERS)

    def get(self, email: str) -> Optional[Dict[str, Any]]:
        snap = self.collection.document(normalize_email(email)).get()
        return snap.to_dict() if snap.exists else None

    def list(self) -> list:
        return [public_user(d.to_dict()) for d in self.collection.stream()]

    def signup(self, email: str, name: str, password: str, signup_code: str) -> Dict[str, Any]:
        expected = settings.admin_signup_code or ""
        if not expected:
            raise AdminAuthError(403, "Admin signup is turned off on this server.")
        if not hmac.compare_digest((signup_code or "").encode("utf-8"), expected.encode("utf-8")):
            raise AdminAuthError(403, "The signup code is not correct.")
        email = validate_email(email)
        name = (name or "").strip()[:80]
        if not name:
            raise AdminAuthError(400, "Enter your name.")
        validate_password(password)
        jwt_secret()  # no point creating an account nobody can log in with
        ref = self.collection.document(email)
        if ref.get().exists:
            raise AdminAuthError(409, "An admin with this email already exists. Log in instead.")
        user = {
            "email": email,
            "name": name,
            "password_hash": hash_password(password),
            "role": "admin",
            "active": True,
            "created_at": _now(),
            "last_login_at": None,
        }
        ref.set(user)
        return user

    def login(self, email: str, password: str) -> Dict[str, Any]:
        jwt_secret()
        user = self.get(email)
        ok = verify_password(password or "", user["password_hash"] if user else _DUMMY_HASH)
        if not user or not ok:
            raise AdminAuthError(401, "Wrong email or password.")
        if not user.get("active", True):
            raise AdminAuthError(403, "This admin account is deactivated.")
        user["last_login_at"] = _now()
        self.collection.document(user["email"]).update({"last_login_at": user["last_login_at"]})
        return user

    def user_for_token(self, token: str) -> Dict[str, Any]:
        claims = decode_token(token)
        user = self.get(claims["sub"])
        if not user or not user.get("active", True):
            raise AdminAuthError(401, "This admin account no longer has access.")
        return user
