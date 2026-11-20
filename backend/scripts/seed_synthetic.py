"""Feed SYNTHETIC page-click data to a running FedAd server through the real device protocol, so the admin and advertiser pages have a result
to show. Each fake device registers, trains locally on made-up rows, and uploads a clipped, noised update, exactly like the extension.

    cd backend
    $env:PYTHONPATH="src"; python scripts/seed_synthetic.py https://fedad.onrender.com --devices 14 --updates 3

The made-up pattern (so the Insights grid has a visible shape): Games and Travel late in the day, Food around lunch and dinner, Tech and Finance in
the morning and afternoon, Sports and Fashion in the late afternoon, Health early. Everything it sends is synthetic: say so when you show it, and
start a new campaign from the admin page to clear it before a real run. Registration is limited to 30 devices per hour per address.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request

import numpy as np

from fedad.federation.pipeline import Client, Config
from fedad.ml import schema
from fedad.ml.data import ClientData
from fedad.ml.model import Model

# click probability by category (rows) and 4-hour block (columns: 0-4, 4-8, 8-12, 12-16, 16-20, 20-24)
PATTERN = {
    "Sports":  [0.05, 0.08, 0.10, 0.14, 0.34, 0.30],
    "Tech":    [0.08, 0.14, 0.34, 0.38, 0.22, 0.16],
    "Food":    [0.04, 0.12, 0.18, 0.40, 0.20, 0.36],
    "Travel":  [0.08, 0.06, 0.12, 0.16, 0.28, 0.46],
    "Fashion": [0.05, 0.06, 0.12, 0.28, 0.32, 0.18],
    "Finance": [0.04, 0.16, 0.36, 0.26, 0.12, 0.08],
    "Games":   [0.12, 0.05, 0.08, 0.14, 0.34, 0.52],
    "Health":  [0.06, 0.34, 0.24, 0.14, 0.10, 0.08],
}


def call(base: str, path: str, body: dict | None = None, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})}
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def device_data(rng: np.random.Generator, rows: int, taste: np.ndarray) -> ClientData:
    """One device's made-up page views: a topic, an hour block, and whether the person clicked."""
    X = np.zeros((rows, schema.N_FEATURES))
    y = np.zeros(rows)
    dev = int(rng.integers(0, 3))
    for i in range(rows):
        cat = int(rng.choice(len(schema.CATEGORIES), p=taste))
        hour = int(rng.integers(0, len(schema.HOURS)))
        X[i, schema.OFFSETS["device"] + dev] = 1
        X[i, schema.OFFSETS["hour_bucket"] + hour] = 1
        X[i, schema.OFFSETS["ad_category"] + cat] = 1
        X[i, schema.OFFSETS["placement"] + 1] = 1                       # "feed-middle", the one placement the extension uses
        X[i, schema.OFFSETS["numeric"]:] = rng.normal(0, 0.3, X.shape[1] - schema.OFFSETS["numeric"])
        y[i] = float(rng.random() < PATTERN[schema.CATEGORIES[cat]][hour])
    return ClientData(0, X, y, X[:5], y[:5], X[:5], y[:5])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base", help="server address, for example https://fedad.onrender.com or http://127.0.0.1:8000")
    ap.add_argument("--devices", type=int, default=14)
    ap.add_argument("--updates", type=int, default=3, help="updates per device (the server allows 10 per device by default)")
    ap.add_argument("--rows", type=int, default=120, help="made-up page views per device")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    base = a.base.rstrip("/")
    rng = np.random.default_rng(a.seed)
    sent = 0
    for d in range(a.devices):
        try:
            tok = call(base, "/v1/register", {"label": "synthetic"})["token"]
        except urllib.error.HTTPError as e:
            print(f"stopped: registering device {d + 1} failed with HTTP {e.code} (30 registrations per hour per address)")
            break
        taste = rng.dirichlet(np.full(len(schema.CATEGORIES), 2.0))      # each device favours some topics
        for u in range(a.updates):
            m = call(base, "/v1/model")
            pol = m["policy"]
            cfg = Config(rounds=pol["max_uploads"], local_epochs=pol["local_epochs"], lr=pol["lr"], batch=pol["batch"], clip_c=pol["clip_c"],
                         dp=pol["dp"], top_k=pol["top_k"], seed=int(rng.integers(1_000_000)))
            up = Client(device_data(rng, a.rows, taste), Model(schema.N_FEATURES), cfg, pol["sigma"]).make_upload(np.array(m["weights"]), 0, m["version"])
            body = {"base_version": up.base_version, "n": up.n, "loss_before": up.loss_before, "loss_after": up.loss_after, "blob": base64.b64encode(up.blob).decode()}
            try:
                call(base, "/v1/updates", body, tok)
                sent += 1
            except urllib.error.HTTPError as e:
                print(f"device {d + 1}, update {u + 1}: HTTP {e.code}")
                break
        print(f"device {d + 1}/{a.devices} done, {sent} updates sent")
    print("status:", call(base, "/v1/status"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
