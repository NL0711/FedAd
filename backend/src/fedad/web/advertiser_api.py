"""Advertiser (Party B) view: predicted click rate from the shared, privacy-protected model. Nothing else.

  GET /api/b/model   predicted click rate per category and per hour of day, read from the global model, plus how many devices
                     contributed and the privacy settings. Nothing about any device, person, email, page or site.

These are the global model's predictions, not matched customers or measured lift: there is no identity join, so nothing here links
what a person did on the platform to what they bought at an advertiser. Each device's update was clipped and noised on the device
before it was sent. With fewer than MIN_COHORT contributing devices the numbers are flagged as an early estimate (the model reflects
very few people and is mostly noise). Rates are rounded to 0.1 point. The per-device view (`/api/live`) stays admin-only.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

from . import live

router = APIRouter()
MIN_COHORT = int(os.environ.get("FEDAD_MIN_COHORT", "10"))


def _round(rows: list[dict]) -> list[dict]:
    return [{"name": r["name"], "ctr": round(float(r["ctr"]), 3)} for r in rows]


@router.get("/api/b/model")
def get_model() -> dict:
    camp = live.CAMPAIGN
    contributors = sum(1 for d in camp.devices.values() if d.uploads > 0)
    out: dict = {"contributors": contributors, "min_contributors": MIN_COHORT, "early": contributors < MIN_COHORT,
                 "version": camp.coord.version, "dp": camp.cfg.dp}
    if contributors == 0:
        out["waiting"] = True
        out["note"] = "No device has contributed yet."
        return out
    ins = camp.insights()
    out.update({
        "waiting": False, "updates": ins["n_updates"], "baseline_ctr": round(float(ins["baseline_ctr"]), 3),
        "by_category": _round(ins["by_category"]), "by_hour": _round(ins["by_hour"]),
        "noise_sigma_per_upload": ins["noise_sigma_per_upload"], "eps_per_device": camp.cfg.eps_total if camp.cfg.dp else None,
        "note": ins["reading"],
    })
    return out
