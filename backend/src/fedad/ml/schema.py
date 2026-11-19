"""On-device feature schema for the phone app (the live federation). Served to devices at ``GET /v1/schema``.

Why a separate schema from Criteo: Criteo's columns are anonymised and hashed, so a phone cannot produce them. The phone
app instead measures a small set of interpretable signals itself, from the user's own interaction with ads shown in the app.
A device encodes one ad impression as a row of N_FEATURES numbers in the order below; the model is logistic regression on
that row (``ml.model.Model``). Numeric features use FIXED constants (value = clamp((raw - center) / scale, -3, 3)), never
per-device statistics, so every device encodes identically.

The raw events (which ad, when, whether tapped) never leave the phone. What leaves is one clipped, noised, compressed
model update per contribution (see ``federation/pipeline.py: Client.make_upload``, ported to the browser).
"""

from __future__ import annotations

from typing import Dict, List

DEVICES: List[str] = ["phone", "tablet", "desktop"]
HOURS: List[str] = ["00-04", "04-08", "08-12", "12-16", "16-20", "20-24"]      # local time of the device
CATEGORIES: List[str] = ["Sports", "Tech", "Food", "Travel", "Fashion", "Finance", "Games", "Health"]
PLACEMENTS: List[str] = ["feed-top", "feed-middle", "feed-bottom", "banner"]

# name, what the app measures, center, scale
NUMERIC: List[Dict] = [
    {"name": "recency_min", "doc": "minutes since the user last tapped any ad (60 if none)", "center": 10.0, "scale": 20.0},
    {"name": "taps_24h", "doc": "ad taps in the last 24 hours", "center": 2.0, "scale": 3.0},
    {"name": "prev_dwell_s", "doc": "seconds the previous ad stayed in view", "center": 3.0, "scale": 4.0},
    {"name": "scroll_speed", "doc": "scroll speed in CSS px per second just before the ad appeared", "center": 400.0, "scale": 400.0},
    {"name": "position", "doc": "index of this ad in the session", "center": 10.0, "scale": 10.0},
    {"name": "session_min", "doc": "minutes since the session started", "center": 5.0, "scale": 5.0},
    {"name": "weekday", "doc": "day of week, Monday = 0", "center": 3.0, "scale": 2.0},
    {"name": "screen_w", "doc": "screen width in CSS px", "center": 400.0, "scale": 200.0},
    {"name": "net_quality", "doc": "connection quality 0 (slow-2g) to 3 (4g), 2 if unknown", "center": 2.0, "scale": 1.0},
    {"name": "visible_ms", "doc": "milliseconds the ad was visible before the user decided", "center": 1500.0, "scale": 1500.0},
]

GROUPS = [("device", DEVICES), ("hour_bucket", HOURS), ("ad_category", CATEGORIES), ("placement", PLACEMENTS)]
OFFSETS: Dict[str, int] = {}
_o = 0
for _name, _vals in GROUPS:
    OFFSETS[_name] = _o
    _o += len(_vals)
OFFSETS["numeric"] = _o
N_FEATURES = _o + len(NUMERIC)                    # the model adds one bias weight after these
SPEC = "phone-ctr-v1"


def feature_names() -> List[str]:
    return [f"{g}={v}" for g, vals in GROUPS for v in vals] + [n["name"] for n in NUMERIC]


def schema() -> dict:
    return {"spec": SPEC, "n_features": N_FEATURES, "n_params": N_FEATURES + 1, "feature_names": feature_names(),
            "groups": [{"name": g, "values": vals, "offset": OFFSETS[g]} for g, vals in GROUPS],
            "numeric": NUMERIC, "numeric_offset": OFFSETS["numeric"], "numeric_clamp": 3.0,
            "row": "one-hot of each group in the order given, then the numeric features, bias weight last in the model",
            "label": "1 if the user tapped the ad, else 0"}
