"""Tests for the RDP accountant, the dashboard API and (when flwr + ray are installed) the Flower engine."""

import time

import numpy as np
import pytest

from fedad.federation.pipeline import Config, run
from fedad.ml.data import N_FEATURES, make_clients
from fedad.privacy import dp, rdp


# ---- RDP accounting -------------------------------------------------------------------------------------------------

def test_rdp_is_never_looser_than_basic_composition():
    for sigma, t in [(1.5, 10), (2.0, 20), (8.0, 50)]:
        # find the per-release eps basic composition would assign to this sigma at delta/T, then sum
        delta_total = 1e-5
        lo, hi = 1e-6, 300.0
        for _ in range(200):
            mid = (lo + hi) / 2
            if dp.gaussian_delta(sigma, mid, 2.0) > delta_total / t:
                lo = mid
            else:
                hi = mid
        basic_eps_each = hi
        assert rdp.eps_after(sigma, 2.0, t, delta_total) <= t * basic_eps_each + 1e-6


def test_rdp_calibration_hits_the_target_and_needs_less_noise():
    sig = rdp.calibrate_sigma(50.0, 1e-5, 2.0, 20)
    assert rdp.eps_after(sig, 2.0, 20, 1e-5) == pytest.approx(50.0, rel=1e-3)
    assert sig < dp.calibrate_sigma(50.0 / 20, 1e-5 / 20, 2.0)
    assert rdp.eps_after(sig * 0.99, 2.0, 20, 1e-5) > 50.0          # smaller noise really would break the target


def test_rdp_matches_google_dp_accounting():
    dpa = pytest.importorskip("dp_accounting")
    from dp_accounting import rdp as grdp
    for sigma, t in [(2.0, 20), (10.0, 20), (40.0, 50)]:
        acc = grdp.RdpAccountant()
        acc.compose(dpa.GaussianDpEvent(sigma / 2.0), t)             # noise multiplier = sigma / sensitivity
        assert rdp.eps_after(sigma, 2.0, t, 1e-5) == pytest.approx(acc.get_epsilon(1e-5), rel=0.01)


def test_rdp_run_spends_the_target_and_beats_basic_utility():
    clients = make_clients(n_clients=8, seed=3)
    basic = run(clients, Config(rounds=15, seed=3, dp=True, eps_total=60.0), N_FEATURES)
    tight = run(clients, Config(rounds=15, seed=3, dp=True, eps_total=60.0, accountant="rdp"), N_FEATURES)
    assert max(e for e, _ in tight.accountant.values()) == pytest.approx(60.0, rel=1e-3)
    assert max(e for e, _ in basic.accountant_rdp.values()) < 60.0          # same noise, honest tighter bound
    assert tight.history[-1]["auc"] > basic.history[-1]["auc"]               # less noise at the same total epsilon
    assert max(s for s in tight.sigma_by_client.values()) < min(s for s in basic.sigma_by_client.values())


def test_rdp_accountant_needs_uniform_budget():
    with pytest.raises(ValueError):
        run(make_clients(n_clients=4, seed=0), Config(rounds=3, dp=True, accountant="rdp", budget_mode="paper"), N_FEATURES)


# ---- dashboard API --------------------------------------------------------------------------------------------------

@pytest.fixture()
def client():
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    from fedad.web.app import app
    return TestClient(app)


def _wait(client, rid, timeout=60):
    t = time.time()
    while time.time() - t < timeout:
        snap = client.get(f"/api/runs/{rid}").json()
        if snap["status"] in ("done", "error"):
            return snap
        time.sleep(0.1)
    raise AssertionError("run did not finish")


needs_criteo = pytest.mark.skipif(not __import__("fedad.ml.criteo", fromlist=["x"]).available(),
                                  reason="real Criteo sample not prepared")


@needs_criteo
def test_api_run_streams_rounds_and_reports_both_epsilons(client):
    rid = client.post("/api/runs", json={"n_clients": 5, "rounds": 4, "dp": True, "eps_total": 80, "accountant": "rdp"}).json()["id"]
    snap = _wait(client, rid)
    assert snap["status"] == "done" and len(snap["rows"]) == 4
    assert snap["summary"]["eps_run"] == pytest.approx(80.0, rel=1e-3)
    assert 0.5 < snap["summary"]["auc"] <= 1.0 and snap["summary"]["synthetic"] is False
    with client.stream("GET", f"/api/runs/{rid}/events") as r:
        text = "".join(r.iter_text())
    assert text.count("event: round") == 4 and "event: done" in text


@needs_criteo
def test_api_async_and_secure_options(client):
    rid = client.post("/api/runs", json={"n_clients": 6, "rounds": 3, "mode": "async", "secure_agg": True, "top_k": 8}).json()["id"]
    snap = _wait(client, rid)
    assert snap["status"] == "done" and snap["rows"]


def test_api_rejects_bad_requests(client):
    assert client.post("/api/runs", json={"he": True, "secure_agg": True}).status_code == 422
    assert client.post("/api/runs", json={"engine": "flower", "mode": "async"}).status_code == 422
    assert client.post("/api/runs", json={"rounds": 10_000}).status_code == 422
    assert client.get("/api/runs/nope").status_code == 404


def test_api_calibrate_endpoint(client):
    d = client.get("/api/privacy/calibrate", params={"eps_total": 100, "rounds": 20}).json()
    assert d["sigma_rdp"] < d["sigma_basic"] and d["eps_rdp_of_basic"] < 100.0
    assert client.get("/api/privacy/calibrate", params={"eps_total": -1}).status_code == 422


# ---- Flower engine --------------------------------------------------------------------------------------------------

@pytest.mark.slow
def test_flower_engine_matches_native_engine():
    pytest.importorskip("flwr")
    pytest.importorskip("ray")
    from fedad.flower_engine import run_flower
    clients = make_clients(n_clients=5, seed=1)
    cfg = Config(rounds=3, seed=1, dp=True, eps_total=120.0, accountant="rdp", secure_agg=True)
    a = run(clients, cfg, N_FEATURES)
    b = run_flower(clients, cfg, N_FEATURES)
    assert len(b.history) == 3
    assert np.allclose(a.w, b.w, atol=1e-9)
    assert b.history[-1]["auc"] == pytest.approx(a.history[-1]["auc"])
    assert max(e for e, _ in b.accountant.values()) == pytest.approx(120.0, rel=1e-3)
