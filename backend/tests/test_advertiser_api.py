"""Advertiser view: predicted click rate from the shared model only, and who may open it."""

import base64
import json

import numpy as np
import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from fedad.federation.pipeline import Client, Config  # noqa: E402
from fedad.ml import schema  # noqa: E402
from fedad.ml.data import ClientData  # noqa: E402
from fedad.ml.model import Model  # noqa: E402
from fedad.web import advertiser_api as adv, app as appmod, live  # noqa: E402


@pytest.fixture()
def c():
    live.CAMPAIGN = live.Campaign(live.CampaignPolicy(buffer_k=1))
    live._REGISTERED.clear()
    return TestClient(appmod.app)


def _data(seed):
    rng = np.random.default_rng(seed)
    n = 40
    X = np.zeros((n, schema.N_FEATURES))
    y = np.zeros(n)
    for i in range(n):
        cat, hour = rng.integers(0, 8), rng.integers(0, 6)
        X[i, schema.OFFSETS["device"]] = 1
        X[i, schema.OFFSETS["hour_bucket"] + hour] = 1
        X[i, schema.OFFSETS["ad_category"] + cat] = 1
        X[i, schema.OFFSETS["placement"] + rng.integers(0, 4)] = 1
        y[i] = float(rng.random() < (0.8 if cat == 1 else 0.1))
    return ClientData(0, X, y, X[:5], y[:5], X[:5], y[:5])


def _contribute(c, seed):
    live._REGISTERED.clear()
    tok = c.post("/v1/register", json={"label": "ext"}).json()["token"]
    m = c.get("/v1/model").json()
    pol = m["policy"]
    cfg = Config(rounds=pol["max_uploads"], local_epochs=pol["local_epochs"], lr=pol["lr"], batch=pol["batch"], clip_c=pol["clip_c"],
                 dp=pol["dp"], top_k=pol["top_k"], seed=seed)
    up = Client(_data(seed), Model(schema.N_FEATURES), cfg, pol["sigma"]).make_upload(np.array(m["weights"]), 0, m["version"])
    body = {"base_version": up.base_version, "n": up.n, "loss_before": up.loss_before, "loss_after": up.loss_after,
            "blob": base64.b64encode(up.blob).decode()}
    assert c.post("/v1/updates", json=body, headers={"Authorization": "Bearer " + tok}).status_code == 200


def test_waiting_until_a_device_contributes(c):
    r = c.get("/api/b/model").json()
    assert r["waiting"] is True and r["contributors"] == 0 and "by_category" not in r


def test_shows_only_predicted_click_rate_from_the_model(c, monkeypatch):
    monkeypatch.setattr(adv, "MIN_COHORT", 3)
    for s in range(2):
        _contribute(c, s)
    early = c.get("/api/b/model").json()
    assert early["early"] is True and early["contributors"] == 2 and len(early["by_category"]) == len(schema.CATEGORIES)
    _contribute(c, 2)
    r = c.get("/api/b/model").json()
    assert r["early"] is False and r["waiting"] is False and r["version"] == 3
    assert all(0 <= x["ctr"] <= 1 for x in r["by_category"] + r["by_hour"]) and len(r["by_hour"]) == len(schema.HOURS)
    assert set(r) <= {"contributors", "min_contributors", "early", "version", "dp", "waiting", "updates", "baseline_ctr", "by_category",
                      "by_hour", "noise_sigma_per_upload", "eps_per_device", "note"}              # nothing about any device or person
    assert "@" not in json.dumps(r)


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
    assert c.get("/api/b/model", headers=ANON).status_code == 403                         # no token
    assert c.get("/api/b/model", headers=_h(supabase("advertiser"))).status_code == 200
    assert c.get("/api/live", headers=_h(supabase("advertiser"))).status_code == 403      # advertiser cannot see per-device data
    assert c.get("/api/live", headers=_h(supabase("admin"))).status_code == 200
    assert c.get("/api/b/model", headers=_h(supabase("admin"))).status_code == 200        # platform may also open the B endpoints


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
    assert c.get("/api/b/model", headers=anon).status_code == 403
    monkeypatch.setattr(appmod, "OPEN_ADMIN", True)
    assert c.get("/api/b/model", headers=anon).status_code == 200
    assert c.get("/api/live", headers=anon).status_code == 403                                  # open demo never opens the rest
