"""HTTP API on localhost with generated data (SYNTHETIC)."""

import base64
import json
import urllib.error
import urllib.request

import numpy as np
import pytest

from fedad.api.client import PolicyRefused, RemoteClient
from fedad.api.server import make_server, serve_in_thread
from fedad.federation.coordinator import Coordinator
from fedad.federation.pipeline import Config, run
from fedad.ml.data import N_FEATURES, make_clients
from fedad.ml.model import Model

TOKENS = {"tok-a": 0, "tok-b": 1, "tok-c": 2, "tok-d": 3}


@pytest.fixture(scope="module")
def clients():
    return make_clients(n_clients=4, n_range=(400, 600), seed=5)


def start(cfg, mode="sync", buffer_k=4):
    coord = Coordinator(cfg, Model(N_FEATURES).init(), "logistic-ctr-v1", buffer_k=buffer_k, mode=mode)
    srv = make_server(coord, TOKENS)
    serve_in_thread(srv)
    return coord, srv, f"http://127.0.0.1:{srv.server_address[1]}"


def raw(method, url, body=None, token=None, headers=None):
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method=method, data=body, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def test_round_over_http_matches_in_process_simulation(clients):
    cfg = Config(rounds=3, n_edges=2)
    coord, srv, url = start(cfg)
    try:
        rcs = [RemoteClient(url, f"tok-{'abcd'[c.client_id]}", c, Model(N_FEATURES), max_eps_per_upload=1e9, seed=cfg.seed)
               for c in clients]
        for _ in range(cfg.rounds):
            replies = [rc.participate() for rc in rcs]
            assert all(r["status"] == 200 for r in replies) and replies[-1]["model_stepped"]
    finally:
        srv.shutdown()
    sim = run(clients, cfg, N_FEATURES)
    assert coord.version == 3 and np.allclose(coord.w, sim.w, atol=1e-3)     # float16 wire values explain the gap


def test_auth_duplicates_stale_and_malformed(clients):
    coord, srv, url = start(Config(rounds=3), buffer_k=2)
    try:
        assert raw("POST", url + "/v1/updates", b"{}", token="wrong")[0] == 401
        assert raw("POST", url + "/v1/updates", b"{}")[0] == 401
        assert raw("POST", url + "/v1/updates", b"not json", token="tok-a")[0] == 400
        big = b"x" * (300 * 1024)
        assert raw("POST", url + "/v1/updates", big, token="tok-a")[0] == 413
        bad = json.dumps({"base_version": 0, "n": 5, "loss_before": 0.5, "loss_after": 0.4,
                          "blob": base64.b64encode(b"junk").decode()}).encode()
        assert raw("POST", url + "/v1/updates", bad, token="tok-a")[0] == 400
        rc = RemoteClient(url, "tok-a", clients[0], Model(N_FEATURES), 1e9)
        assert rc.participate()["status"] == 200
        assert rc.participate()["status"] == 409                          # duplicate while pending
        assert raw("GET", url + "/v1/status")[1]["buffered"] == 1
        assert RemoteClient(url, "tok-b", clients[1], Model(N_FEATURES), 1e9).participate()["model_stepped"]
        stale = RemoteClient(url, "tok-c", clients[2], Model(N_FEATURES), 1e9)
        stale.round = 0
        m = stale.get_model()
        assert m["version"] == 1 and m["prototype"] is True
    finally:
        srv.shutdown()


def test_client_refuses_weak_privacy_policy(clients):
    coord, srv, url = start(Config(rounds=4, dp=True, eps_total=4000.0))     # eps 1000 per upload
    try:
        rc = RemoteClient(url, "tok-a", clients[0], Model(N_FEATURES), max_eps_per_upload=50.0)
        with pytest.raises(PolicyRefused):
            rc.participate()
    finally:
        srv.shutdown()


def test_upload_budget_guard_returns_429(clients):
    coord, srv, url = start(Config(rounds=1), mode="async", buffer_k=1)
    try:
        rc = RemoteClient(url, "tok-a", clients[0], Model(N_FEATURES), 1e9)
        assert rc.participate()["status"] == 200
        assert rc.participate()["status"] == 429
    finally:
        srv.shutdown()


def test_async_accepts_stale_base_version(clients):
    coord, srv, url = start(Config(rounds=3), mode="async", buffer_k=1)
    try:
        a = RemoteClient(url, "tok-a", clients[0], Model(N_FEATURES), 1e9)
        b = RemoteClient(url, "tok-b", clients[1], Model(N_FEATURES), 1e9)
        m = b.get_model()
        assert a.participate()["status"] == 200 and coord.version == 1
        # b trains on the version-0 model it fetched earlier and uploads late: allowed in async mode
        from fedad.federation.pipeline import Client
        up = Client(clients[1], Model(N_FEATURES), Config(rounds=3), 0.0).make_upload(np.array(m["weights"]), 0, 0)
        body = json.dumps({"base_version": 0, "n": up.n, "loss_before": up.loss_before, "loss_after": up.loss_after,
                           "blob": base64.b64encode(up.blob).decode()}).encode()
        code, reply = raw("POST", url + "/v1/updates", body, token="tok-b")
        assert code == 200 and coord.version == 2
    finally:
        srv.shutdown()
