"""Vertical service: extension -> platform profiles, shop -> advertiser labels, PSI + split training, aggregate-only report."""

import json

import numpy as np
import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from fedad.web import app as appmod, live, shop, vertical_api as v  # noqa: E402


@pytest.fixture()
def c(monkeypatch):
    shop.reset()
    v.reset_vertical()
    live.CAMPAIGN = live.Campaign(live.CampaignPolicy())
    monkeypatch.setattr(v, "MIN_COHORT", 10)
    return TestClient(appmod.app)


def _populate(c, n=60, seed=0):
    r = np.random.default_rng(seed)
    for i in range(n):
        email = f"u{i}@example.com"
        live._REGISTERED.clear()                      # 60 devices from one test address would trip the per-address limit
        tok = c.post("/v1/register", json={"label": "ext"}).json()["token"]
        interest = int(r.integers(0, 8))
        x = np.full(v.DIMS, 0.02)
        x[interest] = 0.8
        x[8 + int(r.integers(0, 6))] = 0.5
        x = x / np.linalg.norm(x) + r.normal(0, 0.05, v.DIMS)
        assert c.post("/v1/platform/profile", json={"email": email, "profile": x.tolist()},
                      headers={"Authorization": "Bearer " + tok}).status_code == 200
        shop.USERS[email] = {"cart": [], "orders": [{"id": 1}] if interest in (3, 4) else []}   # Travel/Fashion fans buy
    for i in range(20):                                        # advertiser customers the platform never saw
        shop.USERS[f"other{i}@example.com"] = {"cart": [], "orders": []}


def test_profile_needs_a_device_token_and_valid_shape(c):
    body = {"email": "a@b.com", "profile": [0.1] * v.DIMS}
    assert c.post("/v1/platform/profile", json=body).status_code == 401
    assert c.post("/v1/platform/profile", json={"email": "a@b.com", "profile": [0.1]}, headers={"Authorization": "Bearer x"}).status_code in (401, 422)


def test_run_trains_on_overlap_and_releases_only_aggregates(c):
    _populate(c)
    r = c.post("/api/b/vertical/run", json={"sigma_e": 0.5, "sigma_g": 0.5, "epochs": 40}).json()
    assert r["status"] == "ok" and r["overlap"] == 60 and r["advertiser_customers"] == 80
    assert "test_auc" in r and r["privacy"]["eps_total"] > 0        # test_auc is None when the random test split has one class
    assert "@" not in json.dumps(r)                                  # no email anywhere in the report
    assert set(r) <= {"t", "platform_users", "advertiser_customers", "min_cohort", "request", "overlap", "status", "test_auc", "history",
                      "privacy", "segments", "base_rate", "released", "leakage_note"}      # only the aggregate fields exist
    assert all(s["people"] is None or s["people"] % 5 == 0 for s in r["segments"])


def test_small_overlap_trains_nothing(c):
    _populate(c, n=6)
    r = c.post("/api/b/vertical/run", json={}).json()
    assert r["status"] == "too_small" and r["overlap"] is None and "test_auc" not in r


BASE = "https://proj.supabase.co"


@pytest.fixture()
def supabase(monkeypatch):
    """A throwaway signing key stands in for the Supabase project's; auth._signing_key returns its public half."""
    import time
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from fedad.web import auth
    key, other = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setenv("SUPABASE_URL", BASE)
    monkeypatch.setattr(auth, "_signing_key", lambda token: key.public_key())
    monkeypatch.setattr(appmod, "OPEN_ADMIN", False)

    def token(role="admin", exp=3600, aud="authenticated", iss=BASE + "/auth/v1", signer=None, meta=None):
        claims = {"sub": "u1", "aud": aud, "iss": iss, "exp": int(time.time()) + exp,
                  "app_metadata": meta if meta is not None else ({"role": role} if role else {}), "user_metadata": {"role": "admin"}}
        return jwt.encode(claims, signer or key, algorithm="ES256")
    token.other = other
    return token


ANON = {"x-forwarded-for": "9.9.9.9"}                                  # a proxied request is never local


def _h(tok):
    return {**ANON, "authorization": f"Bearer {tok}"}


def test_supabase_roles(c, supabase):
    assert c.get("/api/b/vertical", headers=ANON).status_code == 403                      # no token
    assert c.get("/api/b/vertical", headers=_h(supabase("advertiser"))).status_code == 200
    assert c.get("/api/live", headers=_h(supabase("advertiser"))).status_code == 403      # advertiser cannot see per-device data
    assert c.get("/api/live", headers=_h(supabase("admin"))).status_code == 200
    assert c.get("/api/b/vertical", headers=_h(supabase("admin"))).status_code == 200     # platform may also open the B endpoints


def test_supabase_rejects_bad_tokens(c, supabase):
    assert c.get("/api/live", headers=_h(supabase("admin", exp=-10))).status_code == 403                    # expired
    assert c.get("/api/live", headers=_h(supabase("admin", aud="anon"))).status_code == 403                 # wrong audience
    assert c.get("/api/live", headers=_h(supabase("admin", iss="https://evil.supabase.co/auth/v1"))).status_code == 403
    assert c.get("/api/live", headers=_h(supabase("admin", signer=supabase.other))).status_code == 403      # signed by another key
    assert c.get("/api/live", headers=_h(supabase(role=None))).status_code == 403                           # signed in, no role
    # user_metadata is editable by the user, so a role there must never count (the helper puts role=admin in it)
    assert c.get("/api/live", headers=_h(supabase(role=None, meta={}))).status_code == 403
    assert c.get("/api/live", headers=_h("not.a.jwt")).status_code == 403


def test_no_supabase_url_means_no_roles(c, supabase, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    assert c.get("/api/live", headers=_h(supabase("admin"))).status_code == 403


def test_access_rules(c, monkeypatch):
    anon = {"x-forwarded-for": "1.2.3.4"}                      # a proxied request is never local
    monkeypatch.setattr(appmod, "OPEN_ADMIN", False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert c.get("/api/b/vertical", headers=anon).status_code == 403
    monkeypatch.setattr(appmod, "OPEN_ADMIN", True)
    assert c.get("/api/b/vertical", headers=anon).status_code == 200
    assert c.get("/api/live", headers=anon).status_code == 403                                  # open demo never opens the rest
