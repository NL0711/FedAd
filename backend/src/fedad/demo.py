"""Experiments on SYNTHETIC ad-impression data. Run: python -m fedad.demo [--deep]

Reports test AUC and log loss on pooled held-out impressions, upload bytes, and the epsilon actually spent. Not accuracy:
click data is imbalanced (about a third of these synthetic impressions are clicks, real rates are far lower), so accuracy
would mislead. Numbers are single-seed on synthetic data; they say how this code behaves, not how a real ad system will.
``--deep`` adds the PyTorch encoder (about a minute) and the Bayesian epsilon tuning.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import replace
from pathlib import Path

from .federation.async_runner import run_async
from .federation.pipeline import Config, run
from .ml.data import N_FEATURES, make_clients


def summarise(name, r, cfg, n_clients, seconds):
    last = r.history[-1]
    eps = max((e for e, _ in r.accountant.values()), default=0.0)
    kb = sum(h["bytes_up"] for h in r.history) / max(1, sum(h.get("n_updates", n_clients) for h in r.history)) / 1024
    return {"name": name, "auc": round(last["auc"], 4), "logloss": round(last["logloss"], 4),
            "kb_per_upload": round(kb, 3), "eps_spent_max": round(eps, 2), "seconds": round(seconds, 1),
            "rejected_last": last["rejected"], "not_run": last["not_run"]}


def main(n_clients: int = 10, rounds: int = 20, seed: int = 0, deep: bool = False) -> None:
    clients = make_clients(n_clients=n_clients, seed=seed)
    base = dict(rounds=rounds, seed=seed)
    atk = {0, 1}
    exps = [
        ("FedAvg", Config(**base), {}),
        ("Weighted FedAvg (eq. 3, our weights)", Config(**base, agg="weighted"), {}),
        ("FedAvg + secret sharing + 2 edges", Config(**base, secure_agg=True), {}),
        ("FedAvg + Paillier HE (1024-bit, demo size)", Config(**base, he=True, he_bits=1024), {}),
        ("FedAvg + top-8 sparsification", Config(**base, top_k=8), {}),
        ("Async buffered (K=4, staleness a=0.5)", Config(**base), {"async": True}),
        ("DP eps_total=100 (local, uniform)", Config(**base, dp=True, eps_total=100.0), {}),
        ("DP eps_total=1000 (local, uniform)", Config(**base, dp=True, eps_total=1000.0), {}),
        ("DP eps_total=1000, paper eq. 6 split", Config(**base, dp=True, eps_total=1000.0, budget_mode="paper"), {}),
        ("2 sign-flip attackers, no defence", Config(**base, attackers=atk), {}),
        ("2 attackers + anomaly filter (eq. 9)", Config(**base, attackers=atk, anomaly=True), {}),
    ]
    out = []
    for name, cfg, opt in exps:
        t = time.time()
        r = run_async(clients, cfg, N_FEATURES, buffer_k=4) if opt.get("async") else run(clients, cfg, N_FEATURES)
        out.append(summarise(name, r, cfg, n_clients, time.time() - t))
    tuned = None
    if deep:
        from .ml.encoder import SeqModel
        from .tuning.pul import tune_epsilon
        t = time.time()
        cfg = Config(rounds=12, lr=0.5, local_epochs=4, batch=32, seed=seed)
        out.append(summarise("Encoder (conv + attention), no DP", run(clients, cfg, N_FEATURES, model=SeqModel()), cfg,
                             n_clients, time.time() - t))
        t = time.time()
        out.append(summarise("Logistic, same schedule", run(clients, cfg, N_FEATURES), cfg, n_clients, time.time() - t))
        t = time.time()
        best, res = tune_epsilon(clients, Config(**base), N_FEATURES, alpha=1.0, beta=100.0, eps_bounds=(20.0, 5000.0),
                                 n_init=4, n_iter=8, seed=seed)
        r = run(clients, best, N_FEATURES)                    # test split, once, on the chosen configuration
        out.append(summarise(f"PUL-tuned eps_total={best.eps_total:.0f} (alpha=1, beta=100, 12 val runs)", r, best,
                             n_clients, time.time() - t))
        tuned = {"alpha": 1.0, "beta": 100.0, "eps_total": best.eps_total, "evaluations": len(res.ys)}
    print(f"SYNTHETIC data, {n_clients} clients, {rounds} rounds, seed {seed}. PROTOTYPE.\n")
    print(f"{'experiment':64s} {'AUC':>7s} {'logloss':>8s} {'KB/upl':>7s} {'eps':>7s} {'sec':>6s}")
    for o in out:
        print(f"{o['name']:64s} {o['auc']:7.4f} {o['logloss']:8.4f} {o['kb_per_upload']:7.3f} {o['eps_spent_max']:7.2f} {o['seconds']:6.1f}")
        if o["rejected_last"]:
            print(f"{'':64s} rejected last round: {o['rejected_last']}")
        if o["not_run"]:
            print(f"{'':64s} NOT RUN: {o['not_run']}")
    p = Path("results")
    p.mkdir(exist_ok=True)
    (p / "demo.json").write_text(json.dumps({"synthetic": True, "prototype": True, "rows": out, "tuning": tuned}, indent=2),
                                 encoding="utf-8")


if __name__ == "__main__":
    main(deep="--deep" in sys.argv)
