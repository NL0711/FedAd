"""Three-layer federated training (paper sections 2.1 and 4.1): clients -> edge nodes -> cloud. SIMULATION in one process.

Round, in order:
  client  local training -> clip to C -> Gaussian noise (if dp) -> top-k (if set) -> encode          [privacy boundary]
  edge    decode -> anomaly filter -> multi-Krum -> weights a_i -> partial sums S_e = sum a_i d_i and W_e = sum a_i
  cloud   combine [S_e, W_e] (plain, secret sharing, or Paillier HE), then w += S / W

Trust model (a consequence of the paper's design, which does not spell it out): anomaly detection and Krum need to see
individual updates, which secret sharing and HE hide. So edges see their clients' (already noised) updates in the clear
and are trusted for that; the cloud only ever sees shares or ciphertexts and the final sums. Not end-to-end secure.

``secure_agg`` (secret sharing) and ``he`` (Paillier) are alternatives; the paper's "combination" is NOT implemented as
one layered protocol. Asynchronous training lives in ``async_runner.py``, the HTTP service in ``api/``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set

import numpy as np

from ..aggregation import aggregate, compress, robust
from ..ml.data import ClientData
from ..ml.model import Model, auc
from ..privacy import dp, he, secagg


@dataclass
class Config:
    rounds: int = 20               # sync: rounds; async: maximum uploads per client (the budget is split over them)
    local_epochs: int = 2
    lr: float = 0.3
    batch: int = 64
    clip_c: float = 1.0
    agg: str = "fedavg"            # fedavg | weighted
    dp: bool = False
    eps_total: float = 2.0
    delta_total: float = 1e-5
    budget_mode: str = "uniform"   # uniform | paper
    n_edges: int = 2
    secure_agg: bool = False       # additive secret sharing across k servers
    k_servers: int = 3
    he: bool = False               # Paillier homomorphic summation (alternative to secure_agg)
    he_bits: int = 2048            # 512 is for tests only and NOT SECURE
    anomaly: bool = False
    z_thr: float = 3.5
    krum_f: int = 0                # 0 = off
    krum_m: int = 0                # 0 = keep n - f
    top_k: int = 0                 # 0 = off
    staleness_a: float = 0.5       # async: weight multiplier (1 + staleness)^-a
    seed: int = 0
    attackers: Set[int] = field(default_factory=set)
    attack_scale: float = 5.0


@dataclass
class Upload:
    client_id: int
    blob: bytes
    n: int
    loss_before: float
    loss_after: float
    base_version: int = 0


class Client:
    """What runs inside the user's app. ``make_upload`` is the only thing that leaves the device."""

    def __init__(self, data: ClientData, model, cfg: Config, sigma: float):
        self.data, self.model, self.cfg, self.sigma = data, model, cfg, sigma

    def make_upload(self, w: np.ndarray, rnd: int, base_version: int = 0) -> Upload:
        rng = np.random.default_rng([self.cfg.seed, rnd, self.data.client_id])
        d, lb, la = self.model.local_train(w, self.data.X, self.data.y, self.cfg.local_epochs, self.cfg.lr, self.cfg.batch, rng)
        if self.data.client_id in self.cfg.attackers:
            v = -self.cfg.attack_scale * d          # sign-flip poisoning: skips clipping and noise
        else:
            v = dp.clip_l2(d, self.cfg.clip_c)
            if self.cfg.dp:
                v = dp.add_gaussian_noise(v, self.sigma, rng)
        v = compress.top_k(v, self.cfg.top_k)
        return Upload(self.data.client_id, compress.encode(v), self.data.n, lb, la, base_version)


@dataclass
class EdgeResult:
    S: np.ndarray
    W: float
    rejected: Dict[int, str]
    not_run: List[str]


class Edge:
    def __init__(self, cfg: Config, n_params: int):
        self.cfg, self.n_params = cfg, n_params
        self.hist = aggregate.History()

    def aggregate(self, uploads: Sequence[Upload], staleness: Optional[Dict[int, int]] = None) -> EdgeResult:
        """``staleness`` maps client id to (current version - base version); weights get (1 + tau)^-staleness_a."""
        cfg = self.cfg
        subs = []
        for u in uploads:
            d = compress.decode(u.blob)
            subs.append(robust.Submission(u.client_id, d, u.n, u.loss_after / max(u.loss_before, 1e-9)))
            self.hist.update(u.client_id, u.loss_before, u.loss_after)
        rejected: Dict[int, str] = {}
        not_run: List[str] = []
        if cfg.anomaly:
            rej, why = robust.flag_anomalies(subs, cfg.z_thr)
            rejected.update(rej)
            if why:
                not_run.append(why)
            subs = [s for s in subs if s.client_id not in rej]
        if cfg.krum_f:
            keep, why = robust.multi_krum(subs, cfg.krum_f, cfg.krum_m or len(subs) - cfg.krum_f)
            if why:
                not_run.append(why)
            else:
                for i, s in enumerate(subs):
                    if i not in keep:
                        rejected[s.client_id] = "not selected by multi-Krum"
                subs = [subs[i] for i in keep]
        if not subs:
            return EdgeResult(np.zeros(self.n_params), 0.0, rejected, not_run)
        norms = [np.linalg.norm(s.delta) for s in subs]
        a = aggregate.weights(cfg.agg, [s.n for s in subs], norms, [self.hist.h(s.client_id) for s in subs])
        if staleness:
            a = a * np.array([(1.0 + staleness.get(s.client_id, 0)) ** (-cfg.staleness_a) for s in subs])
        S = sum(ai * s.delta for ai, s in zip(a, subs))
        return EdgeResult(np.asarray(S), float(a.sum()), rejected, not_run)


@dataclass
class Result:
    w: np.ndarray
    history: List[dict]
    accountant: Dict[int, tuple]
    sigma_by_client: Dict[int, float]
    dense_bytes_per_upload: int
    synthetic: bool = True
    prototype: bool = True


def evaluate(model, w: np.ndarray, clients: Sequence[ClientData], skip: Set[int], split: str = "test") -> Dict[str, float]:
    """Pooled AUC and log loss on the honest clients' ``split`` ("test" for reporting, "val" for tuning)."""
    keep = [c for c in clients if c.client_id not in skip]
    X = np.vstack([getattr(c, "X_" + split) for c in keep])
    y = np.concatenate([getattr(c, "y_" + split) for c in keep])
    return {"auc": auc(y, model.predict(w, X)), "logloss": model.loss(w, X, y)}


class Setup:
    """Everything a run needs besides the loop: model, per-client noise, accountant, edges, aggregation backend."""

    def __init__(self, clients: Sequence[ClientData], cfg: Config, n_features: int, model=None):
        if cfg.he and cfg.secure_agg:
            raise ValueError("choose secure_agg or he, not both (a layered protocol is NOT IMPLEMENTED)")
        self.cfg = cfg
        self.model = model if model is not None else Model(n_features)
        self.w = self.model.init()
        self.eps_it = dp.allocate_budget(cfg.eps_total, cfg.rounds, [c.n for c in clients], mode=cfg.budget_mode)
        self.delta_round = cfg.delta_total / cfg.rounds
        self.sigma: Dict[int, float] = {}
        if cfg.dp:
            self.sigma = {c.client_id: dp.calibrate_sigma(float(e), self.delta_round, 2.0 * cfg.clip_c)
                          for c, e in zip(clients, self.eps_it)}
        self.eps_of = {c.client_id: float(e) for c, e in zip(clients, self.eps_it)}
        self.clients = [Client(c, self.model, cfg, self.sigma.get(c.client_id, 0.0)) for c in clients]
        self.edges = [Edge(cfg, self.model.n_params) for _ in range(cfg.n_edges)]
        self.acct = dp.Accountant(self.delta_round)
        self.rng = np.random.default_rng([cfg.seed, 99])
        self.holder = he.KeyHolder(cfg.he_bits) if cfg.he else None

    def combine(self, results: Sequence[EdgeResult]) -> np.ndarray:
        vecs = [np.append(r.S, r.W) for r in results]
        if self.cfg.he:
            return he.he_sum(vecs, self.holder)
        if self.cfg.secure_agg:
            return secagg.secure_sum(vecs, self.cfg.k_servers, self.rng)
        return np.sum(vecs, axis=0)

    def apply(self, tot: np.ndarray) -> None:
        if tot[-1] > 0:
            self.w = self.w + tot[:-1] / tot[-1]

    def spend(self, client_id: int) -> None:
        if self.cfg.dp and client_id not in self.cfg.attackers:
            self.acct.spend(client_id, self.eps_of[client_id])

    def edge_of(self, client_id: int) -> int:
        return client_id % self.cfg.n_edges


def run(clients: Sequence[ClientData], cfg: Config, n_features: int, model=None, eval_split: str = "test") -> Result:
    s = Setup(clients, cfg, n_features, model)
    history = []
    for rnd in range(cfg.rounds):
        ups = [c.make_upload(s.w, rnd) for c in s.clients]
        for c in clients:
            s.spend(c.client_id)
        results = [s.edges[e].aggregate([u for u in ups if s.edge_of(u.client_id) == e]) for e in range(cfg.n_edges)]
        s.apply(s.combine(results))
        row = {"round": rnd, "bytes_up": sum(len(u.blob) for u in ups),
               "rejected": {k: v for r in results for k, v in r.rejected.items()},
               "not_run": sorted({m for r in results for m in r.not_run})}
        row.update(evaluate(s.model, s.w, clients, cfg.attackers, eval_split))
        history.append(row)
    return Result(s.w, history, s.acct.report(), s.sigma, compress.dense_bytes(s.model.n_params))
