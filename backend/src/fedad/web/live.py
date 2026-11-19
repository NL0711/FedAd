"""Live campaign: real devices (the phone app) contribute to one federated CTR model; the ad admin watches.

Device-facing contract (any origin on the LAN; bearer token from /v1/register):
  GET  /v1/schema    feature layout and fixed scaling constants (see ml/schema.py)
  GET  /v1/model     {version, weights[], n_params, spec_hash, mode, policy{..., sigma}, prototype}
  GET  /v1/status    {version, buffered, buffer_k, mode, rounds_done}
  POST /v1/register  {join_code, label?} -> {token, device_id}
  POST /v1/updates   Authorization: Bearer <token>; same body and errors as api/server.py (blob = compress.encode of the
                     clipped, noised update, base64)
Admin-facing (localhost only, enforced in app.py):
  GET  /api/live         campaign snapshot: policy, devices, privacy ledger, insights, join URLs
  POST /api/live/reset   start a new campaign with a new policy (drops all devices and the model)

The server never receives raw impressions. It holds the noised updates only until aggregated, and the global model.
Insights are computed from the model weights alone. Prototype: in memory, plain HTTP on the LAN (a token can be sniffed on
shared Wi-Fi), join code is a demo-grade gate, no persistence.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import logging
import secrets
import socket
import struct
import threading
import time
import zlib
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..aggregation import compress
from ..federation.coordinator import Coordinator, Rejected
from ..federation.pipeline import Config, Upload
from ..ml import schema
from ..ml.model import Model, sigmoid
from ..privacy import rdp

MAX_BODY = 256 * 1024
MAX_DEVICES = 60
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"        # no look-alike characters

router = APIRouter()
log = logging.getLogger("fedad.live")


class CampaignPolicy(BaseModel):
    eps_total: float = Field(1000.0, gt=0, le=100000.0)       # demo default: clear insights; lower it live to show the trade-off
    max_uploads: int = Field(10, ge=1, le=100)            # contributions per device; the budget is split over them
    buffer_k: int = Field(1, ge=1, le=20)                 # uploads per model step (1 = every contribution moves the model)
    mode: str = Field("async", pattern="^(sync|async)$")
    dp: bool = True
    top_k: int = Field(0, ge=0, le=schema.N_FEATURES + 1)
    # The global model starts with its intercept at this click rate (a public prior chosen by the admin, not learned from
    # anyone's data). Without it the model starts at 50 percent and the absolute rates in Insights are meaningless for a long time.
    prior_ctr: float = Field(0.05, gt=0.001, lt=0.5)


class Device:
    def __init__(self, device_id: int, label: str):
        self.id, self.label = device_id, label
        self.token = secrets.token_urlsafe(32)
        self.joined = time.time()
        self.last_seen = self.joined
        self.uploads = 0
        self.bytes = 0
        self.examples = 0


class Campaign:
    def __init__(self, policy: CampaignPolicy):
        self.policy = policy
        self.cfg = Config(rounds=policy.max_uploads, dp=policy.dp, eps_total=policy.eps_total, accountant="rdp", top_k=policy.top_k,
                          clip_c=1.0, local_epochs=3, lr=0.2, batch=16, n_edges=1)
        self.model = Model(schema.N_FEATURES)
        w0 = self.model.init()
        w0[-1] = float(np.log(policy.prior_ctr / (1.0 - policy.prior_ctr)))        # logit of the prior click rate
        self.coord = Coordinator(self.cfg, w0, schema.SPEC, policy.buffer_k, policy.mode)
        self.join_code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        self.devices: Dict[int, Device] = {}
        self.by_token: Dict[str, int] = {}
        self.events: List[dict] = []
        self.uploads: List[dict] = []                      # every received update, for the proof view
        self.created = time.time()
        self.lock = threading.Lock()

    def register(self, label: str) -> Device:
        with self.lock:
            if len(self.devices) >= MAX_DEVICES:
                raise HTTPException(429, "device limit reached")
            d = Device(len(self.devices) + 1, label[:24] or f"device-{len(self.devices) + 1}")
            self.devices[d.id] = d
            self.by_token[d.token] = d.id
            return d

    def device_for(self, token: str) -> Optional[Device]:
        found = None
        for tok, did in list(self.by_token.items()):       # compare against all, constant-time each
            if hmac.compare_digest(tok, token):
                found = did
        return self.devices.get(found) if found is not None else None

    def submit(self, dev: Device, up: Upload) -> dict:
        before = self.coord.w.copy()
        reply = self.coord.submit(up)
        vec = compress.decode(up.blob)
        after = self.coord.w
        with self.lock:
            # What the server actually received and what it did with it: the same bytes the phone checksummed before sending.
            self.uploads.append({
                "t": time.time(), "device": dev.id, "version": reply["version"], "stepped": reply["model_stepped"], "bytes": len(up.blob),
                "checksum": zlib.adler32(up.blob), "norm": float(np.linalg.norm(vec)), "step_norm": float(np.linalg.norm(after - before)),
                "n": up.n, "loss_before": up.loss_before, "loss_after": up.loss_after, "vec": [round(float(x), 4) for x in vec],
                "before": [round(float(x), 4) for x in before], "after": [round(float(x), 4) for x in after],
            })
            self.uploads = self.uploads[-40:]
            rec = self.uploads[-1]
            moved = sorted(range(len(after)), key=lambda i: -abs(after[i] - before[i]))[:3]
            log.info("UPDATE device=#%d bytes=%d adler32=0x%08X |update|=%.3f n=%d loss=%.3f->%.3f received[0:6]=%s | model v%d->v%d%s |dw|=%.4f |w|=%.3f top_moved=%s",
                     dev.id, rec["bytes"], rec["checksum"], rec["norm"], up.n, up.loss_before, up.loss_after, rec["vec"][:6],
                     reply["version"] - (1 if reply["model_stepped"] else 0), reply["version"], "" if reply["model_stepped"] else " (queued)",
                     rec["step_norm"], float(np.linalg.norm(after)),
                     ",".join(f"{schema.feature_names()[i] if i < schema.N_FEATURES else 'bias'}:{after[i] - before[i]:+.3f}" for i in moved))
            dev.uploads += 1
            dev.bytes += len(up.blob)
            dev.examples += up.n
            dev.last_seen = time.time()
            self.events.append({"t": time.time(), "device": dev.id, "bytes": len(up.blob), "version": reply["version"],
                                "stepped": reply["model_stepped"]})
            self.events = self.events[-200:]
        return reply

    # ---- admin view -----------------------------------------------------------------------------------------------

    def ledger(self) -> List[dict]:
        pol = self.coord.policy()
        out = []
        for d in self.devices.values():
            eps = rdp.eps_after(pol["sigma"], 2.0 * self.cfg.clip_c, d.uploads, self.cfg.delta_total) if self.cfg.dp else None
            out.append({"id": d.id, "label": d.label, "uploads": d.uploads, "max_uploads": self.cfg.rounds, "bytes": d.bytes,
                        "examples": d.examples, "eps_spent": eps, "eps_total": self.cfg.eps_total if self.cfg.dp else None,
                        "joined": d.joined, "last_seen": d.last_seen})
        return out

    def insights(self) -> dict:
        """Predicted CTR from the global model alone, numeric context at its typical value (zero after centring)."""
        m = self.coord.model()
        w = np.asarray(m["weights"])
        o, b = schema.OFFSETS, w[-1]
        grp = {name: w[o[name]:o[name] + len(vals)] for name, vals in schema.GROUPS}
        dev_m, pl_m = float(grp["device"].mean()), float(grp["placement"].mean())
        hr_m, cat_m = float(grp["hour_bucket"].mean()), float(grp["ad_category"].mean())

        def p(z: float) -> float:
            return float(sigmoid(np.array(z)))
        base = b + dev_m + pl_m
        grid = [[p(base + grp["ad_category"][c] + grp["hour_bucket"][h]) for h in range(len(schema.HOURS))]
                for c in range(len(schema.CATEGORIES))]
        avg = p(base + cat_m + hr_m)
        sigma = self.coord.policy()["sigma"]
        n_up = sum(d.uploads for d in self.devices.values())
        return {
            "version": m["version"], "n_updates": n_up, "baseline_ctr": avg,
            "by_category": [{"name": n, "ctr": p(base + grp["ad_category"][i] + hr_m)} for i, n in enumerate(schema.CATEGORIES)],
            "by_hour": [{"name": n, "ctr": p(base + grp["hour_bucket"][i] + cat_m)} for i, n in enumerate(schema.HOURS)],
            "by_device": [{"name": n, "ctr": p(b + grp["device"][i] + pl_m + cat_m + hr_m)} for i, n in enumerate(schema.DEVICES)],
            "by_placement": [{"name": n, "ctr": p(b + dev_m + grp["placement"][i] + cat_m + hr_m)} for i, n in enumerate(schema.PLACEMENTS)],
            "grid": {"categories": schema.CATEGORIES, "hours": schema.HOURS, "ctr": grid},
            "noise_sigma_per_upload": sigma, "dp": self.cfg.dp,
            "reading": ("Add noise, then average: with few uploads the picture is mostly noise. Raise epsilon or collect more "
                        "contributions to sharpen it." if self.cfg.dp else "No noise added (privacy off)."),
        }

    def snapshot(self) -> dict:
        st = self.coord.status()
        return {"policy": self.coord.policy(), "campaign": self.policy.model_dump(), "status": st, "devices": self.ledger(),
                "events": self.events[-30:], "insights": self.insights(), "created": self.created,
                "model": {"names": schema.feature_names() + ["bias"], "weights": [round(float(x), 4) for x in self.coord.w],
                          "uploads": self.uploads[-15:][::-1]},
                "history": self.coord.history[-50:], "prototype": True}


CAMPAIGN = Campaign(CampaignPolicy())


def lan_ips() -> List[str]:
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))                    # no packet is sent; picks the outbound interface
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


# ---- device-facing endpoints ------------------------------------------------------------------------------------------

class RegisterBody(BaseModel):
    join_code: str = Field(max_length=16)
    label: str = Field("", max_length=24)


@router.get("/v1/schema")
def get_schema() -> dict:
    return schema.schema()


@router.get("/v1/model")
def get_model() -> dict:
    return CAMPAIGN.coord.model()


@router.get("/v1/status")
def get_status() -> dict:
    return CAMPAIGN.coord.status()


@router.post("/v1/register")
def register(body: RegisterBody, request: Request) -> dict:
    if not hmac.compare_digest(body.join_code.strip().upper(), CAMPAIGN.join_code):
        raise HTTPException(403, "wrong join code")
    d = CAMPAIGN.register(body.label.strip())
    log.info("REGISTER device=#%d label=%r ip=%s | policy: eps_total=%.0f uploads<=%d sigma=%.3f accountant=rdp", d.id, d.label,
             request.client.host if request.client else "?", CAMPAIGN.cfg.eps_total, CAMPAIGN.cfg.rounds, CAMPAIGN.coord.policy()["sigma"])
    return {"token": d.token, "device_id": d.id, "label": d.label}


@router.post("/v1/updates")
async def post_update(request: Request) -> dict:
    camp = CAMPAIGN
    auth = request.headers.get("authorization", "")
    dev = camp.device_for(auth[7:]) if auth.startswith("Bearer ") else None
    if dev is None:
        raise HTTPException(401, "bad token")
    try:
        length = int(request.headers.get("content-length", "-1"))
    except ValueError:
        length = -1
    if length < 0:
        raise HTTPException(400, "Content-Length required")
    if length > MAX_BODY:
        raise HTTPException(413, "body too large")
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "body too large")
    try:
        import json
        d = json.loads(raw)
        up = Upload(dev.id, base64.b64decode(d["blob"], validate=True), int(d["n"]), float(d["loss_before"]),
                    float(d["loss_after"]), int(d["base_version"]))
        if up.n <= 0 or not all(np.isfinite([up.loss_before, up.loss_after])) or up.loss_before <= 0:
            raise ValueError("bad numbers")
        vec = compress.decode(up.blob)
        if vec.size != camp.coord.w.size or not np.all(np.isfinite(vec)):
            raise ValueError("wrong length or non-finite update")
    except (KeyError, ValueError, TypeError, IndexError, binascii.Error, zlib.error, struct.error) as e:
        raise HTTPException(400, f"malformed: {type(e).__name__}")
    try:
        return camp.submit(dev, up)
    except Rejected as r:
        raise HTTPException(r.code, r.message)


# ---- admin-facing endpoints (localhost only; see app.py) -----------------------------------------------------------------

@router.get("/api/live")
def live_snapshot(request: Request) -> dict:
    from .app import clean
    import os
    port = request.url.port or 8000
    code = CAMPAIGN.join_code
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    public = bool(host) and not host.startswith(("localhost", "127.", "[::1]", "0.0.0.0"))
    if public:                                           # deployed (for example on Render): phones use the public address
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
        urls = [f"{scheme}://{host}/phone.html?code={code}"]
    else:
        urls = [f"http://{ip}:{port}/phone.html?code={code}" for ip in lan_ips()]
    snap = CAMPAIGN.snapshot()
    snap["join"] = {"code": code, "urls": urls, "lan_enabled": public or bool(os.environ.get("FEDAD_LAN"))}
    return clean(snap)


@router.post("/api/live/reset")
def live_reset(policy: CampaignPolicy) -> dict:
    global CAMPAIGN
    CAMPAIGN = Campaign(policy)
    log.info("CAMPAIGN new code=%s eps_total=%.0f uploads/device=%d buffer_k=%d dp=%s prior_ctr=%.2f", CAMPAIGN.join_code, policy.eps_total,
             policy.max_uploads, policy.buffer_k, policy.dp, policy.prior_ctr)
    return {"ok": True, "join_code": CAMPAIGN.join_code}
