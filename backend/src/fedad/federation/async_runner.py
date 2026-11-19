"""Asynchronous federated training (paper sections 2.1 and 4.3: "asynchronous updates reduce dependence on slower nodes").
SIMULATION with a virtual clock; no real concurrency.

Buffered asynchronous aggregation (FedBuff style, Nguyen et al. 2022): every client trains on the newest global model it
fetched, uploads when it finishes (its own speed), and immediately fetches again. The server collects ``buffer_k``
uploads, then runs them through the usual edge pipeline (anomaly filter, Krum, weights) with each weight multiplied by
(1 + staleness)^-staleness_a, where staleness = current model version minus the version the client trained on, and applies
one version step. A fast client therefore cannot flood the model and a slow one is not waited for.

Privacy accounting differs from the synchronous case: the number of uploads per client is not fixed in advance, so each
upload spends eps_total / cfg.rounds and a client STOPS after ``cfg.rounds`` uploads; the budget cannot be exceeded.
"""

from __future__ import annotations

import heapq
from typing import Dict, List, Optional, Sequence

import numpy as np

from ..aggregation import compress
from ..ml.data import ClientData
from .pipeline import Config, Result, Setup, Upload, evaluate


def run_async(clients: Sequence[ClientData], cfg: Config, n_features: int, model=None, buffer_k: int = 4,
              mean_durations: Optional[Dict[int, float]] = None, max_versions: Optional[int] = None,
              eval_split: str = "test") -> Result:
    s = Setup(clients, cfg, n_features, model)
    rng = np.random.default_rng([cfg.seed, 7])
    base = mean_durations or {c.client_id: float(np.exp(rng.normal(0.0, 0.7))) for c in clients}
    by_id = {c.data.client_id: c for c in s.clients}
    done = {c.client_id: 0 for c in clients}
    version = 0
    heap: list = []
    seq = 0

    def schedule(cid: int, t: float) -> None:
        nonlocal seq
        dur = base[cid] * float(np.exp(rng.normal(0.0, 0.2)))
        heapq.heappush(heap, (t + dur, seq, cid, s.w.copy(), version))
        seq += 1

    for c in clients:
        schedule(c.client_id, 0.0)

    buffer: List[Upload] = []
    history: List[dict] = []
    clock = 0.0

    def flush() -> None:
        nonlocal buffer, version
        if not buffer:
            return
        stale = {u.client_id: version - u.base_version for u in buffer}
        results = [s.edges[e].aggregate([u for u in buffer if s.edge_of(u.client_id) == e], stale)
                   for e in range(cfg.n_edges)]
        s.apply(s.combine(results))
        version += 1
        row = {"version": version, "time": clock, "n_updates": len(buffer),
               "staleness_mean": float(np.mean(list(stale.values()))), "staleness_max": int(max(stale.values())),
               "bytes_up": sum(len(u.blob) for u in buffer),
               "rejected": {k: v for r in results for k, v in r.rejected.items()},
               "not_run": sorted({m for r in results for m in r.not_run})}
        row.update(evaluate(s.model, s.w, clients, cfg.attackers, eval_split))
        history.append(row)
        buffer = []

    while heap and (max_versions is None or version < max_versions):
        clock, _, cid, snapshot, base_version = heapq.heappop(heap)
        up = by_id[cid].make_upload(snapshot, done[cid], base_version)
        s.spend(cid)
        done[cid] += 1
        if any(u.client_id == cid for u in buffer):
            flush()
        buffer.append(up)
        if done[cid] < cfg.rounds:
            if len(buffer) >= buffer_k:
                flush()
            schedule(cid, clock)
        elif len(buffer) >= buffer_k:
            flush()
    if max_versions is None or version < max_versions:
        flush()
    return Result(s.w, history, s.acct.report(), s.sigma, compress.dense_bytes(s.model.n_params))
