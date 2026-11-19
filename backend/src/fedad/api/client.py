"""Reference client for the HTTP API. The Flutter app must do the same steps; this is the executable spec.

A client enforces its OWN privacy ceiling: ``max_eps_per_upload`` caps what it will accept from the server's policy, so a
server (or a man in the middle on plain HTTP) cannot talk it into sending a nearly un-noised update.
"""

from __future__ import annotations

import base64
import json
import ssl
import urllib.error
import urllib.request
from typing import Optional

import numpy as np

from ..federation.pipeline import Client, Config
from ..ml.data import ClientData
from ..privacy import dp


class PolicyRefused(Exception):
    pass


class RemoteClient:
    def __init__(self, base_url: str, token: str, data: ClientData, model, max_eps_per_upload: float,
                 ssl_context: Optional[ssl.SSLContext] = None, seed: int = 0):
        self.base, self.token, self.data, self.model = base_url.rstrip("/"), token, data, model
        self.max_eps, self.ctx, self.seed, self.round = max_eps_per_upload, ssl_context, seed, 0

    def _call(self, method: str, path: str, body: Optional[dict] = None):
        req = urllib.request.Request(self.base + path, method=method,
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30, context=self.ctx) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def get_model(self) -> dict:
        code, m = self._call("GET", "/v1/model")
        if code != 200:
            raise RuntimeError(f"model fetch failed: {code}")
        return m

    def participate(self) -> dict:
        """Fetch the model, train locally, noise, compress, upload. Returns the server's reply (with ``status`` added)."""
        m = self.get_model()
        pol = m["policy"]
        if pol["dp"] and pol["eps_per_upload"] > self.max_eps:
            raise PolicyRefused(f"server asks eps {pol['eps_per_upload']} per upload, ceiling is {self.max_eps}")
        cfg = Config(rounds=pol["max_uploads"], local_epochs=pol["local_epochs"], lr=pol["lr"], batch=pol["batch"],
                     clip_c=pol["clip_c"], dp=pol["dp"], top_k=pol["top_k"], seed=self.seed)
        sigma = dp.calibrate_sigma(pol["eps_per_upload"], pol["delta_per_upload"], 2.0 * pol["clip_c"]) if pol["dp"] else 0.0
        up = Client(self.data, self.model, cfg, sigma).make_upload(np.array(m["weights"]), self.round, m["version"])
        self.round += 1
        code, reply = self._call("POST", "/v1/updates", {
            "base_version": up.base_version, "n": up.n, "loss_before": up.loss_before, "loss_after": up.loss_after,
            "blob": base64.b64encode(up.blob).decode()})
        reply["status"] = code
        return reply
