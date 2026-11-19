"""Multi-seed experiments for the report, on REAL Criteo click data (see ml/criteo.py; the federation across clients is
simulated). Run: python -m fedad.experiments [--seeds 5] [--flower] [--no-figures]

Writes results/experiments.json (read by the dashboard) and, unless --no-figures, results/figures/*.png and
results/tables/*.csv (paste-ready for the written report). Every number is mean and 95 percent confidence half-width over
independent seeds (a seed redraws which impressions are used, how publishers map to clients, AND the training/noise
randomness). Prototype.

Suites
  privacy_utility  test AUC and log loss against total epsilon, basic composition versus Renyi (RDP) accounting
  techniques       what each building block costs or buys: centralised baseline, secret sharing, Paillier HE,
                   sparsification, async, DP
  compression      upload size against AUC for top-k sparsification
  flower_parity    (--flower) the same runs on the Flower runtime and the native engine, compared weight by weight

Two engines run the identical Client / Edge / Setup code: ``native`` (fast, in-process loop, used for the many-seed
sweeps) and ``flower`` (Flower Simulation Runtime on Ray, about 20 s start-up per run). ``flower_parity`` shows they agree.
There are no poisoning, attacker or defence experiments here by design: this project's focus is privacy.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Callable, Dict, List, Sequence

import numpy as np

from .federation.async_runner import run_async
from .federation.pipeline import Config, Result, run
from .ml import criteo
from .ml.criteo import N_FEATURES
from .ml.model import auc

N_CLIENTS = 20
ROWS = 60_000
ROUNDS = 15
# Real CTR data with a 430-parameter model: local DP needs a large epsilon before the model beats chance by much.
EPS_GRID = [100.0, 300.0, 1000.0, 3000.0, 10000.0, 30000.0]
TOPK_GRID = [0, 200, 100, 50, 20, 10]


def make_clients(n_clients: int = N_CLIENTS, seed: int = 0):
    return criteo.make_clients(n_clients=n_clients, seed=seed, rows=ROWS)
_T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228}


def mean_ci(xs: Sequence[float]) -> Dict[str, float]:
    """Mean and 95 percent half-width (Student t); half-width is 0 for a single value."""
    a = np.asarray(xs, dtype=float)
    n = len(a)
    if n < 2:
        return {"mean": float(a.mean()), "ci": 0.0, "n": n}
    t = _T975.get(n - 1, 1.96)
    return {"mean": float(a.mean()), "ci": float(t * a.std(ddof=1) / math.sqrt(n)), "n": n}


def _one(clients, cfg: Config, kind: str = "sync") -> Dict[str, float]:
    t = time.time()
    r: Result = run_async(clients, cfg, N_FEATURES, buffer_k=4) if kind == "async" else run(clients, cfg, N_FEATURES)
    last = r.history[-1]
    ups = sum(h.get("n_updates", len(clients)) for h in r.history)
    kb = sum(h["bytes_up"] for h in r.history) / max(1, ups) / 1024
    eps_run = max((e for e, _ in r.accountant.values()), default=0.0)
    eps_rdp = max((e for e, _ in r.accountant_rdp.values()), default=0.0)
    return {"auc": last["auc"], "logloss": last["logloss"], "kb_per_upload": kb, "eps_run": eps_run, "eps_rdp": eps_rdp,
            "seconds": time.time() - t, "dense_kb": r.dense_bytes_per_upload / 1024}


def _over_seeds(seeds: Sequence[int], make_cfg: Callable[[int], Config], kind: str = "sync") -> Dict[str, dict]:
    rows = [_one(make_clients(n_clients=N_CLIENTS, seed=s), make_cfg(s), kind) for s in seeds]
    out = {k: mean_ci([r[k] for r in rows]) for k in rows[0]}
    out["auc"]["by_seed"] = [r["auc"] for r in rows]          # kept so paired comparisons can be made
    return out


def privacy_utility(seeds: Sequence[int]) -> dict:
    base = _over_seeds(seeds, lambda s: Config(rounds=ROUNDS, seed=s))
    curves = {}
    for acc in ("basic", "rdp"):
        curves[acc] = [{"eps_total": e, **_over_seeds(seeds, lambda s, e=e, acc=acc: Config(
            rounds=ROUNDS, seed=s, dp=True, eps_total=e, accountant=acc))} for e in EPS_GRID]
    # how much less noise the tighter accountant needs for the same total (eps, delta)
    from .privacy import rdp
    noise = [{"eps_total": e, **rdp.compare(e, 1e-5, 2.0, ROUNDS)} for e in EPS_GRID]
    # same seed => same data and same training randomness, so the difference isolates the accountant
    paired = [{"eps_total": b["eps_total"], **mean_ci([r - x for r, x in zip(rr["auc"]["by_seed"], b["auc"]["by_seed"])])}
              for b, rr in zip(curves["basic"], curves["rdp"])]
    return {"no_dp": base, "curves": curves, "noise": noise, "paired_auc_gain_rdp": paired, "rounds": ROUNDS,
            "delta_total": 1e-5, "clip_c": 1.0}


def centralised(seeds: Sequence[int]) -> dict:
    """What the ad admin would do WITHOUT federated learning: collect every client's raw impressions and train on the pool.
    Same features, same train/test rows, scikit-learn logistic regression (L2, C=0.1). The upper reference for AUC."""
    from sklearn.linear_model import LogisticRegression
    aucs, rows_collected, secs = [], [], []
    for s in seeds:
        t = time.time()
        cl = make_clients(seed=s)
        X, y = np.vstack([c.X for c in cl]), np.concatenate([c.y for c in cl])
        Xt, yt = np.vstack([c.X_test for c in cl]), np.concatenate([c.y_test for c in cl])
        m = LogisticRegression(C=0.1, max_iter=300).fit(X, y)
        aucs.append(auc(yt, m.predict_proba(Xt)[:, 1]))
        rows_collected.append(len(y))
        secs.append(time.time() - t)
    return {"name": "Centralised: all raw impressions pooled (no privacy)", "group": "centralised", "async": False,
            "auc": {**mean_ci(aucs), "by_seed": aucs}, "seconds": mean_ci(secs), "raw_rows_collected": int(np.mean(rows_collected)),
            "kb_per_upload": mean_ci([0.0]), "eps_run": {"mean": None, "ci": 0.0, "n": 1},       # no DP: no epsilon exists
            "eps_rdp": {"mean": None, "ci": 0.0, "n": 1}, "logloss": {"mean": None, "ci": 0.0, "n": 1}}


def techniques(seeds: Sequence[int]) -> List[dict]:
    exps = [
        ("Federated (FedAvg, no privacy noise)", lambda s: Config(rounds=ROUNDS, seed=s), "sync", "baseline"),
        ("Weighted FedAvg (eq. 3)", lambda s: Config(rounds=ROUNDS, seed=s, agg="weighted"), "sync", "aggregation"),
        ("Secret sharing, 3 servers", lambda s: Config(rounds=ROUNDS, seed=s, secure_agg=True), "sync", "secure aggregation"),
        ("Paillier HE (1024-bit demo size)", lambda s: Config(rounds=ROUNDS, seed=s, he=True, he_bits=1024), "sync",
         "secure aggregation"),
        ("Top-50 sparsification", lambda s: Config(rounds=ROUNDS, seed=s, top_k=50), "sync", "communication"),
        ("Asynchronous buffered (K=4)", lambda s: Config(rounds=ROUNDS, seed=s), "async", "scheduling"),
        ("Local DP, total eps 10000, basic", lambda s: Config(rounds=ROUNDS, seed=s, dp=True, eps_total=10000.0), "sync",
         "differential privacy"),
        ("Local DP, total eps 10000, RDP", lambda s: Config(rounds=ROUNDS, seed=s, dp=True, eps_total=10000.0,
                                                           accountant="rdp"), "sync", "differential privacy"),
        ("Local DP, total eps 1000, RDP", lambda s: Config(rounds=ROUNDS, seed=s, dp=True, eps_total=1000.0,
                                                          accountant="rdp"), "sync", "differential privacy"),
        ("Local DP eps 3000, RDP + secret sharing + top-50", lambda s: Config(
            rounds=ROUNDS, seed=s, dp=True, eps_total=3000.0, accountant="rdp", secure_agg=True, top_k=50), "sync",
         "combined"),
    ]
    out = [centralised(seeds)]
    for name, mk, kind, group in exps:
        out.append({"name": name, "group": group, "async": kind == "async", "raw_rows_collected": 0,
                    **_over_seeds(seeds, mk, kind)})
    return out


def compression(seeds: Sequence[int]) -> List[dict]:
    return [{"top_k": k, **_over_seeds(seeds, lambda s, k=k: Config(rounds=ROUNDS, seed=s, top_k=k))} for k in TOPK_GRID]


def flower_parity(seed: int = 0) -> List[dict]:
    from .flower_engine import flower_version, run_flower
    clients = make_clients(n_clients=N_CLIENTS, seed=seed)
    cases = [("FedAvg", Config(rounds=ROUNDS, seed=seed)),
             ("Local DP eps 3000, RDP + secret sharing", Config(rounds=ROUNDS, seed=seed, dp=True, eps_total=3000.0,
                                                                accountant="rdp", secure_agg=True))]
    out = []
    for name, cfg in cases:
        a = run(clients, cfg, N_FEATURES)
        t = time.time()
        b = run_flower(clients, cfg, N_FEATURES)
        out.append({"name": name, "flower_version": flower_version(), "auc_native": a.history[-1]["auc"],
                    "auc_flower": b.history[-1]["auc"], "max_abs_weight_diff": float(np.abs(a.w - b.w).max()),
                    "flower_seconds": time.time() - t})
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--flower", action="store_true", help="also run the Flower parity check (needs flwr and ray)")
    ap.add_argument("--no-figures", action="store_true")
    ap.add_argument("--out", default="results")
    a = ap.parse_args(argv)
    seeds = list(range(a.seeds))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    res: dict = {"synthetic": False, "prototype": True, "dataset": criteo.info(), "seeds": seeds, "n_clients": N_CLIENTS,
                 "rows": ROWS, "rounds": ROUNDS, "n_params": N_FEATURES + 1}
    for name, fn in (("privacy_utility", privacy_utility), ("techniques", techniques), ("compression", compression)):
        t = time.time()
        res[name] = fn(seeds)
        print(f"{name}: {time.time() - t:.1f}s", flush=True)
    if a.flower:
        res["flower_parity"] = flower_parity()
        print("flower_parity done", flush=True)
    res["total_seconds"] = time.time() - t0
    (out / "experiments.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(f"wrote {out / 'experiments.json'}")
    if not a.no_figures:
        from . import figures
        figures.make_all(res, out)


if __name__ == "__main__":
    main()
