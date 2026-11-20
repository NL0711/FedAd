"""Vertical FL service: Party A (ad platform) and Party B (advertiser = the demo shop).

Party A side, called by the browser extension (device token from /v1/register):
  GET  /v1/platform/policy                       {dims, names, sigma, clip}   what the extension must do before sending
  POST /v1/platform/profile {email, profile[14]} Bearer   one locally noised profile per device: 8 category shares + 6 hour shares
Party B side (admin, /api/b/*): aggregates only.
  GET  /api/b/vertical        status and the last result
  POST /api/b/vertical/run    {sigma_e, sigma_g, epochs}: PSI on email, split training, aggregate report
  POST /api/b/vertical/reset  forget profiles and results

What Party B can see: set sizes, the size of the overlap (only when it is at least MIN_COHORT), test AUC, the privacy spent,
and predicted conversion rate per interest segment, only for segments with at least MIN_COHORT people, with Laplace noise on the
rate and counts rounded to 5. Never: an email, a device number, a profile, an embedding, a per-person prediction. Individual
scores exist only inside `_run` and are aggregated before anything is returned.

Prototype: both parties run in one process and share memory, so this is enforced by what the API returns, not by a network or
trust boundary. A deployment with two organisations would run them on separate servers with the same messages.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..ml import schema
from ..vertical import psi, split
from . import live, shop

router = APIRouter()
LOCK = threading.Lock()
MIN_COHORT = int(os.environ.get("FEDAD_MIN_COHORT", "10"))
PROFILE_SIGMA = 0.3                    # noise the extension adds per coordinate (profile is clipped to L2 norm 1 first)
EPS_RATE = 1.0                         # Laplace budget for each released segment rate
DIMS = len(schema.CATEGORIES) + len(schema.HOURS)
NAMES = [f"cat={c}" for c in schema.CATEGORIES] + [f"hour={h}" for h in schema.HOURS]

PROFILES: Dict[int, dict] = {}         # device id -> {"email", "x", "t"}
STATE: Dict[str, Optional[dict]] = {"last": None}


class ProfileBody(BaseModel):
    email: str = Field(max_length=120)
    profile: List[float] = Field(min_length=DIMS, max_length=DIMS)


class RunBody(BaseModel):
    sigma_e: float = Field(3.0, ge=0, le=20)
    sigma_g: float = Field(3.0, ge=0, le=20)
    epochs: int = Field(20, ge=1, le=100)


def _email(s: str) -> str:
    s = s.strip().lower()
    if "@" not in s or len(s) < 5:
        raise HTTPException(400, "email looks wrong")
    return s


@router.get("/v1/platform/policy")
def policy() -> dict:
    return {"dims": DIMS, "names": NAMES, "sigma": PROFILE_SIGMA, "clip": 1.0,
            "how": "category shares and hour shares each sum to 1; scale the vector to L2 norm <= 1, add N(0, sigma^2) to every coordinate"}


@router.post("/v1/platform/profile")
def post_profile(body: ProfileBody, request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    dev = live.CAMPAIGN.device_for(auth[7:]) if auth.startswith("Bearer ") else None
    if dev is None:
        raise HTTPException(401, "bad token")
    x = np.asarray(body.profile, dtype=float)
    # Noised values can legitimately fall outside [0, 1]; reject only the absurd.
    if not np.all(np.isfinite(x)) or np.abs(x).max() > 10 or np.linalg.norm(x) > 8:
        raise HTTPException(400, "profile out of range")
    with LOCK:
        PROFILES[dev.id] = {"email": _email(body.email), "x": x, "t": time.time()}
    return {"ok": True, "profiles": len(PROFILES)}


def _advertiser_table() -> tuple[List[str], np.ndarray]:
    """Party B's own data: every shop account and whether it ever completed a checkout."""
    with shop.LOCK:
        emails = sorted(shop.USERS)
        y = np.array([1.0 if shop.USERS[e]["orders"] else 0.0 for e in emails])
    return emails, y


def _laplace_rate(mean: float, n: int, rng: np.random.Generator) -> float:
    return float(np.clip(mean + rng.laplace(0.0, 1.0 / (max(n, 1) * EPS_RATE)), 0.0, 1.0))


def _run(req: RunBody) -> dict:
    with LOCK:
        prof = list(PROFILES.values())
    emails_a = [p["email"] for p in prof]
    Xa_all = np.vstack([p["x"] for p in prof]) if prof else np.zeros((0, DIMS))
    emails_b, y_b = _advertiser_table()
    out: dict = {"t": time.time(), "platform_users": len(emails_a), "advertiser_customers": len(emails_b), "min_cohort": MIN_COHORT,
                 "request": req.model_dump()}
    if not emails_a or not emails_b:
        out["status"] = "waiting"
        out["note"] = "Needs browser-extension users on the platform side and shop accounts on the advertiser side."
        return out
    ia, ib = psi.run(emails_a, emails_b)                       # PSI: only the overlap is aligned, nobody else is revealed
    out["overlap"] = len(ia)
    if len(ia) < MIN_COHORT:
        out["status"] = "too_small"
        out["note"] = f"Overlap is under {MIN_COHORT} people: nothing is trained or reported (a small group could identify individuals)."
        out["overlap"] = None
        return out
    Xa, y = Xa_all[ia], y_b[ib]
    if len(set(y)) < 2:
        out["status"] = "one_class"
        out["note"] = "Everyone in the overlap has the same outcome, so there is nothing to learn yet."
        return out
    cfg = split.VConfig(epochs=req.epochs, sigma_e=req.sigma_e, sigma_g=req.sigma_g, seed=int(time.time()) % 10_000)
    res = split.train(Xa, np.zeros((len(y), 0)), y, cfg)
    A, B = res["model"]
    p = B.predict(A.embed(Xa, False), np.zeros((len(y), 0)))
    # Segment = the platform's strongest interest for that person. Only segment-level numbers leave this function.
    top = Xa[:, :len(schema.CATEGORIES)].argmax(axis=1)
    rng = np.random.default_rng()
    segs = []
    for c, name in enumerate(schema.CATEGORIES):
        m = top == c
        n = int(m.sum())
        if n >= MIN_COHORT:
            segs.append({"segment": name, "people": int(round(n / 5.0) * 5), "predicted_conversion": _laplace_rate(float(p[m].mean()), n, rng)})
        else:
            segs.append({"segment": name, "people": None, "predicted_conversion": None})
    out.update({
        "status": "ok", "test_auc": res["test_auc"], "history": [{"epoch": h["epoch"], "test_auc": h.get("test_auc")} for h in res["history"]],
        "privacy": res["privacy"], "segments": segs, "base_rate": _laplace_rate(float(y.mean()), len(y), rng),
        "released": ("set sizes, overlap size, test AUC, segment rates with Laplace noise (epsilon %.1f each) and counts rounded to 5. "
                     "No identifiers, profiles, embeddings or individual predictions." % EPS_RATE),
        "leakage_note": ("Row-level noise is applied to the embeddings A sends and the gradients B returns. Gradients can still leak "
                         "labels; that is a known weakness of split learning."),
    })
    return out


@router.get("/api/b/vertical")
def get_vertical() -> dict:
    with LOCK:
        n = len(PROFILES)
    emails_b, y = _advertiser_table()
    return {"platform_profiles": n, "advertiser_customers": len(emails_b), "min_cohort": MIN_COHORT,
            "platform_policy": {"sigma": PROFILE_SIGMA, "dims": DIMS}, "last": STATE["last"]}


@router.post("/api/b/vertical/run")
def run_vertical(body: RunBody) -> dict:
    STATE["last"] = _run(body)
    return STATE["last"]


@router.post("/api/b/vertical/reset")
def reset_vertical() -> dict:
    with LOCK:
        PROFILES.clear()
    STATE["last"] = None
    return {"ok": True}
