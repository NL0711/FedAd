"""Server-side state machine behind the HTTP API: holds the global model, buffers uploads, aggregates.

Modes
  sync   an upload must be trained on the CURRENT version (else 409) and a client may upload once per version. The model
         steps when ``buffer_k`` uploads have arrived.
  async  an upload may be trained on an older version; its weight is discounted by (1 + staleness)^-staleness_a (see
         ``federation/async_runner.py``). One pending upload per client. The model steps when ``buffer_k`` have arrived.
Both: at most ``cfg.rounds`` uploads per client in total, the budget guard (429 afterwards), so a client's epsilon spend
cannot exceed eps_total however the server is driven.

Aggregation reuses the edge pipeline (anomaly filter, Krum, weights) and the cloud combine (plain, secret sharing, HE).
Single process, in memory: a restart loses the model. Persistence is NOT IMPLEMENTED.
"""

from __future__ import annotations

import hashlib
import threading
from typing import Dict, List, Optional

import numpy as np

from ..privacy import dp, he, secagg
from .pipeline import Config, Edge, Upload


class Rejected(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class Coordinator:
    def __init__(self, cfg: Config, init_weights: np.ndarray, spec: str, buffer_k: int = 3, mode: str = "sync"):
        if mode not in ("sync", "async"):
            raise ValueError(mode)
        if cfg.he and cfg.secure_agg:
            raise ValueError("choose secure_agg or he, not both")
        self.cfg, self.mode, self.buffer_k = cfg, mode, buffer_k
        self.w = np.asarray(init_weights, dtype=np.float64).copy()
        self.version = 0
        self.spec_hash = hashlib.sha256(f"{spec}|{self.w.size}".encode()).hexdigest()[:16]
        self.edges = [Edge(cfg, self.w.size) for _ in range(cfg.n_edges)]
        self.buffer: Dict[int, Upload] = {}
        self.uploads_done: Dict[int, int] = {}
        self.history: List[dict] = []
        self.holder = he.KeyHolder(cfg.he_bits) if cfg.he else None
        self.rng = np.random.default_rng([cfg.seed, 5])
        self.lock = threading.Lock()

    def policy(self) -> dict:
        """What a client must follow. A client enforces its own epsilon ceiling and must not trust this blindly."""
        c = self.cfg
        return {"clip_c": c.clip_c, "top_k": c.top_k, "dp": c.dp, "eps_per_upload": c.eps_total / c.rounds,
                "delta_per_upload": c.delta_total / c.rounds, "max_uploads": c.rounds, "local_epochs": c.local_epochs,
                "lr": c.lr, "batch": c.batch}

    def model(self) -> dict:
        with self.lock:
            return {"version": self.version, "weights": self.w.tolist(), "n_params": int(self.w.size),
                    "spec_hash": self.spec_hash, "mode": self.mode, "policy": self.policy(), "prototype": True}

    def status(self) -> dict:
        with self.lock:
            return {"version": self.version, "buffered": len(self.buffer), "buffer_k": self.buffer_k, "mode": self.mode,
                    "rounds_done": len(self.history), "prototype": True}

    def submit(self, up: Upload) -> dict:
        with self.lock:
            cid = up.client_id
            if self.uploads_done.get(cid, 0) >= self.cfg.rounds:
                raise Rejected(429, "upload budget used up")
            if up.base_version > self.version:
                raise Rejected(409, "base_version is in the future")
            if self.mode == "sync" and up.base_version != self.version:
                raise Rejected(409, f"stale: model is at version {self.version}")
            if cid in self.buffer:
                raise Rejected(409, "an upload from this client is already pending")
            self.buffer[cid] = up
            self.uploads_done[cid] = self.uploads_done.get(cid, 0) + 1
            stepped = False
            if len(self.buffer) >= self.buffer_k:
                self._aggregate()
                stepped = True
            return {"accepted": True, "version": self.version, "model_stepped": stepped}

    def _aggregate(self) -> None:
        ups = list(self.buffer.values())
        self.buffer = {}
        stale = {u.client_id: self.version - u.base_version for u in ups} if self.mode == "async" else None
        results = [self.edges[e].aggregate([u for u in ups if u.client_id % self.cfg.n_edges == e], stale)
                   for e in range(self.cfg.n_edges)]
        vecs = [np.append(r.S, r.W) for r in results]
        if self.cfg.he:
            tot = he.he_sum(vecs, self.holder)
        elif self.cfg.secure_agg:
            tot = secagg.secure_sum(vecs, self.cfg.k_servers, self.rng)
        else:
            tot = np.sum(vecs, axis=0)
        if tot[-1] > 0:
            self.w = self.w + tot[:-1] / tot[-1]
        self.version += 1
        self.history.append({"version": self.version, "n_updates": len(ups),
                             "rejected": {k: v for r in results for k, v in r.rejected.items()},
                             "not_run": sorted({m for r in results for m in r.not_run})})
