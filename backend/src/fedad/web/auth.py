"""Sign-in through Supabase Auth. The backend keeps no passwords and no sessions: each request to /api carries the user's Supabase
access token (Authorization: Bearer <jwt>), and the backend checks its signature against the project's public keys.

  SUPABASE_URL   https://<ref>.supabase.co   (public; the keys are fetched from <url>/auth/v1/.well-known/jwks.json)

A token is accepted when it is signed by that project, is not expired, has audience "authenticated", and its `app_metadata.role`
is "admin" (platform: everything under /api) or "advertiser" (Party B: /api/b/* only). `app_metadata` can only be changed with the
project's secret key or in the dashboard, never by the user, so a user cannot grant themselves a role. No secret key is used here.

Users and roles are managed in Supabase (Authentication > Users; set the role with SQL, see README). Prototype: a revoked user
keeps access until their token expires (an hour by default).
"""

from __future__ import annotations

import os
from typing import Any, Optional

import jwt
from fastapi import Request
from jwt import PyJWKClient

ROLES = ("admin", "advertiser")
_clients: dict = {}


def _base() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _signing_key(token: str) -> Any:
    """The project's public key for this token's `kid`. Cached by PyJWKClient; replaced in tests."""
    base = _base()
    client = _clients.get(base)
    if client is None:
        client = _clients[base] = PyJWKClient(base + "/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)
    return client.get_signing_key_from_jwt(token).key


def role_of(request: Request) -> Optional[str]:
    base = _base()
    header = request.headers.get("authorization", "")
    if not base or not header.startswith("Bearer "):
        return None
    token = header[7:]
    try:
        claims = jwt.decode(token, _signing_key(token), algorithms=["ES256", "RS256"], audience="authenticated",
                            issuer=base + "/auth/v1", options={"require": ["exp", "sub"]})
    except Exception:                                    # bad signature, expired, wrong project, key fetch failed: no role
        return None
    role = (claims.get("app_metadata") or {}).get("role")
    return role if role in ROLES else None
