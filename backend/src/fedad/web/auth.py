"""Sign-in for the two consoles. Two accounts, configured by environment variables (no user database):

  FEDAD_ADMIN_USER / FEDAD_ADMIN_PASSWORD   platform operator: everything under /api
  FEDAD_B_USER     / FEDAD_B_PASSWORD       advertiser (Party B): /api/b/* only, aggregates only

  POST /auth/login {username, password}  -> sets an HttpOnly session cookie, returns {role, next}
  POST /auth/logout                      -> clears it
  GET  /auth/me                          -> {role} or {role: null}

The session is a signed, expiring token (HMAC-SHA256 with FEDAD_SECRET, or a random per-process secret, in which case a restart
signs everyone out). Logins are rate-limited per client address. Localhost needs no login (app.py). A prototype sign-in, not an
identity system: two shared accounts, no password reset, no MFA.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter()
COOKIE = "fedad_session"
TTL = 8 * 3600
_SECRET = (os.environ.get("FEDAD_SECRET") or secrets.token_hex(32)).encode()
_ATTEMPTS: Dict[str, Deque[float]] = defaultdict(deque)
MAX_ATTEMPTS, WINDOW = 8, 300.0


def _accounts() -> Dict[str, tuple]:
    out = {}
    for role, ukey, pkey, nxt in (("admin", "FEDAD_ADMIN_USER", "FEDAD_ADMIN_PASSWORD", "/"),
                                  ("advertiser", "FEDAD_B_USER", "FEDAD_B_PASSWORD", "/advertiser.html")):
        u, p = os.environ.get(ukey, ""), os.environ.get(pkey, "")
        if u and p:
            out[role] = (u, p, nxt)
    return out


def _sign(payload: str) -> str:
    return hmac.new(_SECRET, payload.encode(), hashlib.sha256).hexdigest()


def make_token(role: str, now: Optional[float] = None) -> str:
    payload = f"{role}|{int((now or time.time()) + TTL)}"
    return base64.urlsafe_b64encode(payload.encode()).decode() + "." + _sign(payload)


def role_of(request: Request) -> Optional[str]:
    tok = request.cookies.get(COOKIE, "")
    try:
        b64, sig = tok.split(".", 1)
        payload = base64.urlsafe_b64decode(b64.encode()).decode()
        role, exp = payload.split("|")
        if hmac.compare_digest(sig, _sign(payload)) and int(exp) > time.time() and role in ("admin", "advertiser"):
            return role
    except (ValueError, UnicodeDecodeError):
        pass
    return None


class LoginBody(BaseModel):
    username: str = Field(max_length=80)
    password: str = Field(max_length=200)


def _client(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()) or (request.client.host if request.client else "?")


@router.post("/auth/login")
def login(body: LoginBody, request: Request) -> JSONResponse:
    who, now = _client(request), time.time()
    q = _ATTEMPTS[who]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= MAX_ATTEMPTS:
        raise HTTPException(429, "Too many attempts. Wait a few minutes.")
    accounts = _accounts()
    match = None
    for role, (u, p, nxt) in accounts.items():          # compare every account, constant-time each
        ok_u = hmac.compare_digest(body.username.encode(), u.encode())
        ok_p = hmac.compare_digest(body.password.encode(), p.encode())
        if ok_u and ok_p:
            match = (role, nxt)
    if match is None:
        q.append(now)
        raise HTTPException(401, "Wrong username or password")
    secure = (request.headers.get("x-forwarded-proto") or request.url.scheme) == "https"
    resp = JSONResponse({"role": match[0], "next": match[1]})
    resp.set_cookie(COOKIE, make_token(match[0]), max_age=TTL, httponly=True, samesite="lax", secure=secure, path="/")
    return resp


@router.post("/auth/logout")
def logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp


@router.get("/auth/me")
def me(request: Request) -> dict:
    return {"role": role_of(request), "configured": bool(_accounts())}
