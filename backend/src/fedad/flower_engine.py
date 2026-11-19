"""Run the FedAd pipeline on Flower (flwr 1.44, message API, Simulation Runtime on the Ray backend).

Flower is the federated runtime: it owns the ServerApp / ClientApp lifecycle, node sampling, message passing and
(virtual) supernodes. FedAd's own code stays the single source of truth for what happens inside a round:

  ClientApp.train   -> ``pipeline.Client.make_upload``  (local SGD, clip to C, Gaussian noise, top-k, encode)
  Strategy          -> ``pipeline.Edge.aggregate`` per edge, then ``Setup.combine`` (plain, secret sharing or Paillier HE)
  evaluation        -> pooled held-out AUC / log loss, computed on the server with the same ``evaluate`` as the native engine

The update that crosses the Flower message boundary is the already clipped, noised, compressed blob (as a uint8 array),
so the privacy boundary is identical to the native simulation and the HTTP coordinator. Results match the native engine
up to floating-point summation order (tested). Flower's own DP wrappers are not used: they are server-side or fixed-clip
variants of a different threat model than this project's local DP.

Everything runs in one machine: Ray worker processes act as the clients. Not a deployment.
"""

from __future__ import annotations

from typing import Callable, List, Optional, Sequence

import numpy as np

from .federation.pipeline import Client, Config, Result, Setup, Upload, evaluate
from .ml.data import ClientData

try:                                            # optional dependency: pip install "fedad[flower]"
    from flwr.app import ArrayRecord, ConfigRecord, Context, Message, MetricRecord, RecordDict
    from flwr.clientapp import ClientApp
    from flwr.serverapp import Grid, ServerApp
    from flwr.serverapp.strategy import FedAvg
    from flwr.simulation import run_simulation
    HAVE_FLOWER = True
except ImportError:                             # pragma: no cover
    HAVE_FLOWER = False


def flower_version() -> Optional[str]:
    if not HAVE_FLOWER:
        return None
    import flwr
    return flwr.__version__


class _FedAdStrategy(FedAvg if HAVE_FLOWER else object):          # type: ignore[misc]
    """Flower Strategy whose aggregation is FedAd's edge pipeline."""

    def __init__(self, setup: Setup, clients: Sequence[ClientData], cfg: Config, eval_split: str, on_round):
        n = len(clients)
        super().__init__(fraction_train=1.0, fraction_evaluate=0.0, min_train_nodes=n, min_available_nodes=n)
        self.setup, self.clients, self.cfg, self.eval_split, self.on_round = setup, clients, cfg, eval_split, on_round
        self.history: List[dict] = []

    def aggregate_train(self, server_round, replies):
        valid, _ = self._check_and_log_replies(replies, is_train=True, validate=False)
        s, cfg = self.setup, self.cfg
        ups = []
        for m in valid:
            met = m.content["metrics"]
            blob = m.content["update"]["0"].numpy().tobytes()
            ups.append(Upload(int(met["client-id"]), blob, int(met["num-examples"]), float(met["loss-before"]),
                              float(met["loss-after"])))
        ups.sort(key=lambda u: u.client_id)
        for u in ups:
            s.spend(u.client_id)
        results = [s.edges[e].aggregate([u for u in ups if s.edge_of(u.client_id) == e]) for e in range(cfg.n_edges)]
        s.apply(s.combine(results))
        row = {"round": server_round - 1, "bytes_up": sum(len(u.blob) for u in ups),
               "rejected": {k: v for r in results for k, v in r.rejected.items()},
               "not_run": sorted({m for r in results for m in r.not_run})}
        row.update(evaluate(s.model, s.w, self.clients, cfg.attackers, self.eval_split))
        row.update(s.privacy_so_far())
        self.history.append(row)
        if self.on_round:
            self.on_round(row)
        return ArrayRecord([s.w.astype(np.float64)]), MetricRecord({"auc": row["auc"], "logloss": row["logloss"]})


def run_flower(clients: Sequence[ClientData], cfg: Config, n_features: int, model=None, eval_split: str = "test",
               on_round: Optional[Callable[[dict], None]] = None, num_cpus: int = 4) -> Result:
    """Synchronous FedAd training as a Flower simulation. Same arguments and Result as ``pipeline.run``."""
    if not HAVE_FLOWER:
        raise RuntimeError("flwr is not installed: pip install flwr 'ray>=2.31'")
    setup = Setup(clients, cfg, n_features, model)
    workers = list(setup.clients)                # partition i -> Client i; the Client carries its own data and sigma
    strategy = _FedAdStrategy(setup, clients, cfg, eval_split, on_round)

    client_app = ClientApp()

    @client_app.train()
    def train(msg: Message, context: Context) -> Message:
        c: Client = workers[int(context.node_config["partition-id"])]
        w = msg.content["arrays"]["0"].numpy().astype(np.float64)
        rnd = int(msg.content["config"]["server-round"]) - 1
        up = c.make_upload(w, rnd)
        content = RecordDict({
            "update": ArrayRecord([np.frombuffer(up.blob, dtype=np.uint8).copy()]),
            "metrics": MetricRecord({"num-examples": up.n, "client-id": up.client_id,
                                     "loss-before": up.loss_before, "loss-after": up.loss_after}),
        })
        return Message(content=content, reply_to=msg)

    server_app = ServerApp()

    @server_app.main()
    def main(grid: Grid, context: Context) -> None:
        strategy.start(grid=grid, initial_arrays=ArrayRecord([setup.w.astype(np.float64)]), num_rounds=cfg.rounds,
                       train_config=ConfigRecord())

    run_simulation(server_app=server_app, client_app=client_app, num_supernodes=len(clients), backend_name="ray",
                   backend_config={"client_resources": {"num_cpus": 1, "num_gpus": 0.0},
                                   "init_args": {"num_cpus": num_cpus, "include_dashboard": False,
                                                 "logging_level": 40}},
                   verbose_logging=False)
    if len(strategy.history) != cfg.rounds:
        raise RuntimeError(f"Flower finished {len(strategy.history)} of {cfg.rounds} rounds; see the log above")
    return setup.result(strategy.history)
