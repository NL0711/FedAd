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
    code = live.CAMPAIGN.join_code
    for i in range(n):
        email = f"u{i}@example.com"
        tok = c.post("/v1/register", json={"join_code": code, "label": "ext"}).json()["token"]
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


def test_login_sessions_and_roles(c, monkeypatch):
    from fedad.web import auth
    monkeypatch.setenv("FEDAD_ADMIN_USER", "platform")
    monkeypatch.setenv("FEDAD_ADMIN_PASSWORD", "p-admin")
    monkeypatch.setenv("FEDAD_B_USER", "advertiser")
    monkeypatch.setenv("FEDAD_B_PASSWORD", "p-b")
    monkeypatch.setattr(appmod, "OPEN_ADMIN", False)
    auth._ATTEMPTS.clear()
    anon = {"x-forwarded-for": "9.9.9.9"}
    assert c.post("/auth/login", json={"username": "advertiser", "password": "nope"}, headers=anon).status_code == 401
    r = c.post("/auth/login", json={"username": "advertiser", "password": "p-b"}, headers=anon)
    assert r.status_code == 200 and r.json() == {"role": "advertiser", "next": "/advertiser.html"}
    assert "httponly" in r.headers["set-cookie"].lower()
    assert c.get("/api/b/vertical", headers=anon).status_code == 200            # cookie kept by the client
    assert c.get("/api/live", headers=anon).status_code == 403                  # advertiser cannot see per-device data
    assert c.get("/auth/me").json()["role"] == "advertiser"
    c.post("/auth/logout")
    c.cookies.clear()
    assert c.get("/api/b/vertical", headers=anon).status_code == 403
    r = c.post("/auth/login", json={"username": "platform", "password": "p-admin"}, headers=anon)
    assert r.json()["next"] == "/" and c.get("/api/live", headers=anon).status_code == 200
    c.cookies.clear()
    c.cookies.set(auth.COOKIE, "forged.token")
    assert c.get("/api/live", headers=anon).status_code == 403


def test_login_is_rate_limited(c, monkeypatch):
    from fedad.web import auth
    monkeypatch.setenv("FEDAD_B_USER", "advertiser")
    monkeypatch.setenv("FEDAD_B_PASSWORD", "p-b")
    auth._ATTEMPTS.clear()
    h = {"x-forwarded-for": "8.8.8.8"}
    codes = [c.post("/auth/login", json={"username": "x", "password": "y"}, headers=h).status_code for _ in range(auth.MAX_ATTEMPTS + 1)]
    assert codes[-1] == 429 and set(codes[:-1]) == {401}
    assert c.post("/auth/login", json={"username": "advertiser", "password": "p-b"}, headers=h).status_code == 429


def test_access_rules(c, monkeypatch):
    anon = {"x-forwarded-for": "1.2.3.4"}                      # a proxied request is never local
    monkeypatch.setattr(appmod, "OPEN_ADMIN", False)
    monkeypatch.setattr(appmod, "B_KEY", "bkey")
    monkeypatch.setattr(appmod, "ADMIN_KEY", "akey")
    assert c.get("/api/b/vertical", headers=anon).status_code == 403
    assert c.get("/api/b/vertical", headers={**anon, "x-admin-key": "bkey"}).status_code == 200
    assert c.get("/api/live", headers={**anon, "x-admin-key": "bkey"}).status_code == 403      # advertiser cannot see per-device data
    assert c.get("/api/live", headers={**anon, "x-admin-key": "akey"}).status_code == 200
    monkeypatch.setattr(appmod, "OPEN_ADMIN", True)
    assert c.get("/api/b/vertical", headers=anon).status_code == 200
    assert c.get("/api/live", headers=anon).status_code == 403                                  # open demo never opens the rest
