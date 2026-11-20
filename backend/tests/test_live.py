"""Live campaign: device registration, upload contract, privacy ledger, insights, admin-only endpoints."""

import base64
import json

import numpy as np
import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from fedad.aggregation import compress  # noqa: E402
from fedad.federation.pipeline import Client, Config  # noqa: E402
from fedad.ml import schema  # noqa: E402
from fedad.ml.data import ClientData  # noqa: E402
from fedad.ml.model import Model  # noqa: E402
from fedad.web import live  # noqa: E402
from fedad.web.app import app  # noqa: E402


@pytest.fixture()
def api():
    c = TestClient(app)
    code = c.post("/api/live/reset", json={"eps_total": 500, "max_uploads": 3, "buffer_k": 1, "mode": "async"}).json()["join_code"]
    return c, code


def _device_data(n=60, seed=0):
    """A phone's impressions in the on-device schema: users here click Tech ads in the evening."""
    rng = np.random.default_rng(seed)
    X = np.zeros((n, schema.N_FEATURES))
    y = np.zeros(n)
    for i in range(n):
        cat, hour = rng.integers(0, 8), rng.integers(0, 6)
        X[i, schema.OFFSETS["device"]] = 1
        X[i, schema.OFFSETS["hour_bucket"] + hour] = 1
        X[i, schema.OFFSETS["ad_category"] + cat] = 1
        X[i, schema.OFFSETS["placement"] + rng.integers(0, 4)] = 1
        X[i, schema.OFFSETS["numeric"]:] = rng.normal(0, 0.3, 10)
        y[i] = float(rng.random() < (0.8 if (cat == 1 and hour == 5) else 0.1))
    return ClientData(0, X, y, X[:5], y[:5], X[:5], y[:5])


def _upload_body(model_reply, data):
    pol = model_reply["policy"]
    cfg = Config(rounds=pol["max_uploads"], local_epochs=pol["local_epochs"], lr=pol["lr"], batch=pol["batch"],
                 clip_c=pol["clip_c"], dp=pol["dp"], top_k=pol["top_k"], seed=1)
    up = Client(data, Model(schema.N_FEATURES), cfg, pol["sigma"]).make_upload(np.array(model_reply["weights"]), 0,
                                                                            model_reply["version"])
    return {"base_version": up.base_version, "n": up.n, "loss_before": up.loss_before, "loss_after": up.loss_after,
            "blob": base64.b64encode(up.blob).decode()}


def test_schema_and_policy_expose_sigma(api):
    c, _ = api
    s = c.get("/v1/schema").json()
    assert s["n_params"] == schema.N_FEATURES + 1 and len(s["feature_names"]) == schema.N_FEATURES
    m = c.get("/v1/model").json()
    assert m["n_params"] == s["n_params"] and m["policy"]["sigma"] > 0 and m["policy"]["max_uploads"] == 3


def test_join_code_token_and_contribution_flow(api):
    c, code = api
    reg = c.post("/v1/register", json={"label": "my phone"}).json()      # open registration: no join code needed
    hdr = {"Authorization": f"Bearer {reg['token']}"}
    m = c.get("/v1/model").json()
    body = _upload_body(m, _device_data())
    assert c.post("/v1/updates", json=body).status_code == 401                       # no token
    r = c.post("/v1/updates", json=body, headers=hdr)
    assert r.status_code == 200 and r.json()["model_stepped"] is True and r.json()["version"] == 1
    snap = c.get("/api/live").json()
    d = snap["devices"][0]
    assert d["uploads"] == 1 and d["label"] == "my phone" and 0 < d["eps_spent"] < 500
    assert snap["status"]["version"] == 1 and snap["insights"]["n_updates"] == 1
    assert len(snap["insights"]["grid"]["ctr"]) == 8 and len(snap["insights"]["grid"]["ctr"][0]) == 6
    import zlib                                                                     # the proof view: same bytes in, model changed
    blob = base64.b64decode(body["blob"])
    up = snap["model"]["uploads"][0]
    assert up["checksum"] == zlib.adler32(blob) and up["bytes"] == len(blob) and len(up["vec"]) == schema.N_FEATURES + 1
    assert up["after"] != up["before"] and snap["model"]["weights"] == up["after"] and up["step_norm"] > 0


class _MemStore:
    """Stands in for Postgres: named rows kept as JSON text, the way the database would."""
    def __init__(self):
        self.rows = {}

    def read(self, key="campaign"):
        return json.loads(self.rows[key]) if key in self.rows else None

    def write(self, state, key="campaign"):
        self.rows[key] = json.dumps(state)

    def keys(self, prefix=""):
        return sorted(k for k in self.rows if k.startswith(prefix))

    def delete(self, key):
        self.rows.pop(key, None)


def _restart():
    """What a server restart does: forget everything in memory and load it again from the store."""
    live.REGISTRY.clear()
    live.CAMPAIGN = live._initial()
    return live.CAMPAIGN


def test_campaign_survives_a_restart(api, monkeypatch):
    c, _ = api
    store = _MemStore()
    monkeypatch.setattr(live, "STORE", store)
    reg = c.post("/v1/register", json={"label": "my phone"}).json()
    hdr = {"Authorization": f"Bearer {reg['token']}"}
    assert c.post("/v1/updates", json=_upload_body(c.get("/v1/model").json(), _device_data()), headers=hdr).status_code == 200
    before = live.CAMPAIGN
    assert store.rows and reg["token"] not in json.dumps(store.rows)                  # saved, and only the token's hash
    after = _restart()
    assert after is not before and after.coord.version == before.coord.version == 1
    assert np.array_equal(after.coord.w, before.coord.w) and len(after.uploads) == 1 and len(after.devices) == 1
    assert c.post("/v1/updates", json=_upload_body(c.get("/v1/model").json(), _device_data(seed=1)), headers=hdr).status_code == 200   # same token still works
    assert c.get("/api/live").json()["status"]["version"] == 2


def test_campaigns_are_saved_listed_viewed_and_reactivated(api, monkeypatch):
    c, _ = api
    store = _MemStore()
    monkeypatch.setattr(live, "STORE", store)
    live.REGISTRY.clear()
    # campaign A: one device, two updates
    first = c.get("/api/campaigns").json()["active"]
    reg = c.post("/v1/register", json={"label": "a"}).json()
    hdr = {"Authorization": f"Bearer {reg['token']}"}
    for s in range(2):
        assert c.post("/v1/updates", json=_upload_body(c.get("/v1/model").json(), _device_data(seed=s)), headers=hdr).status_code == 200
    # starting campaign B keeps A
    made = c.post("/api/campaigns", json={"name": "Second run", "eps_total": 300, "max_uploads": 5}).json()
    listed = c.get("/api/campaigns").json()
    names = {i["id"]: i for i in listed["items"]}
    assert listed["active"] == made["id"] and names[made["id"]]["name"] == "Second run" and names[made["id"]]["version"] == 0
    assert names[first]["active"] is False and names[first]["version"] == 2 and names[first]["devices"] == 1 and names[first]["updates"] == 2
    # the saved campaign can be viewed with its own data, while the active one is empty
    old = c.get(f"/api/campaigns/{first}").json()
    assert old["id"] == first and old["status"]["version"] == 2 and len(old["devices"]) == 1
    assert c.get("/api/live").json()["status"]["version"] == 0
    assert c.get("/api/campaigns/nope").status_code == 404
    # it survives a restart, and so does which campaign is active
    after = _restart()
    assert after.id == made["id"] and {i["id"] for i in c.get("/api/campaigns").json()["items"]} == {first, made["id"]}
    # making the old one active again resumes it: the device's token still works
    assert c.post(f"/api/campaigns/{first}/activate").json()["id"] == first
    assert c.get("/api/live").json()["status"]["version"] == 2
    assert c.post("/v1/updates", json=_upload_body(c.get("/v1/model").json(), _device_data(seed=9)), headers=hdr).status_code == 200
    assert c.post("/api/campaigns/nope/activate").status_code == 404


def test_the_old_single_campaign_row_becomes_campaign_1(api, monkeypatch):
    c, _ = api
    reg = c.post("/v1/register", json={"label": "a"}).json()
    assert c.post("/v1/updates", json=_upload_body(c.get("/v1/model").json(), _device_data()), headers={"Authorization": f"Bearer {reg['token']}"}).status_code == 200
    old = live.CAMPAIGN.to_state()
    del old["id"]                                              # earlier versions wrote one anonymous row, "campaign"
    old["policy"].pop("name")
    store = _MemStore()
    store.write(old)
    monkeypatch.setattr(live, "STORE", store)
    after = _restart()
    assert after.policy.name == "Campaign 1" and after.coord.version == 1 and len(after.devices) == 1
    assert store.keys("campaign:") and store.read("active")["id"] == after.id     # now stored the new way
    assert _restart().id == after.id and _restart().coord.version == 1            # and read from there next time, not from the old row


def test_an_untouched_campaign_is_not_kept(api, monkeypatch):
    c, _ = api
    monkeypatch.setattr(live, "STORE", _MemStore())
    live.REGISTRY.clear()
    c.post("/api/campaigns", json={"name": "one"})
    c.post("/api/campaigns", json={"name": "two"})             # "one" never got a device, so it is not saved
    names = [i["name"] for i in c.get("/api/campaigns").json()["items"]]
    assert names == ["two"]


def test_upload_budget_and_malformed(api):
    c, code = api
    reg = c.post("/v1/register", json={"join_code": code}).json()
    hdr = {"Authorization": f"Bearer {reg['token']}"}
    for _ in range(3):
        m = c.get("/v1/model").json()
        assert c.post("/v1/updates", json=_upload_body(m, _device_data()), headers=hdr).status_code == 200
    m = c.get("/v1/model").json()
    assert c.post("/v1/updates", json=_upload_body(m, _device_data()), headers=hdr).status_code == 429
    bad = _upload_body(m, _device_data())
    bad["blob"] = base64.b64encode(compress.encode(np.ones(5))).decode()           # wrong length
    reg2 = c.post("/v1/register", json={"join_code": code}).json()
    assert c.post("/v1/updates", json=bad, headers={"Authorization": f"Bearer {reg2['token']}"}).status_code == 400


def test_admin_endpoints_refuse_non_local_clients(api):
    _, _ = api
    remote = TestClient(app, client=("192.168.1.50", 5000))
    assert remote.get("/api/live").status_code == 403
    assert remote.post("/api/live/reset", json={}).status_code == 403
    assert remote.get("/v1/schema").status_code == 200                              # the device contract stays open


def test_insights_reflect_what_devices_taught_the_model():
    camp = live.Campaign(live.CampaignPolicy(eps_total=5000, max_uploads=20, dp=False))
    model = camp.model
    rng_data = _device_data(400, seed=3)
    w = camp.coord.w
    for _ in range(15):                                                              # noise-free, so the signal must show
        pol = camp.coord.policy()
        cfg = Config(rounds=20, local_epochs=pol["local_epochs"], lr=pol["lr"], batch=pol["batch"], dp=False, seed=0)
        up = Client(rng_data, model, cfg, 0.0).make_upload(camp.coord.w, 0, camp.coord.version)
        d = camp.register("x") if len(camp.devices) < 1 else camp.devices[1]
        up.client_id = d.id
        camp.coord.uploads_done[d.id] = 0
        camp.submit(d, up)
    ins = camp.insights()
    cats = {c["name"]: c["ctr"] for c in ins["by_category"]}
    hours = {h["name"]: h["ctr"] for h in ins["by_hour"]}
    assert cats["Tech"] == max(cats.values()) and hours["20-24"] == max(hours.values())
    assert w is not None
