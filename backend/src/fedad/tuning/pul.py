"""Privacy-Utility Loss tuning (paper eq. 8) with Bayesian optimisation over the total privacy budget.

L_PUL = alpha * Error + beta / epsilon, where Error = 1 - AUC on the clients' VALIDATION split (never the test split) and
epsilon is the total budget of a run. alpha and beta are the operator's preference for utility versus privacy, they are
inputs here, not learned: the paper says they are "tuned" without saying against what, and tuning the weights against
the loss they define would just pick the cheapest corner.

The test split is touched once, by the caller, on the returned best configuration.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Callable, Optional, Sequence, Tuple

import numpy as np

from ..federation.pipeline import Config, run
from ..ml.data import ClientData
from .bayes import BOResult, bayes_opt


def tune_epsilon(clients: Sequence[ClientData], cfg: Config, n_features: int, alpha: float, beta: float,
                 eps_bounds: Tuple[float, float] = (20.0, 5000.0), n_init: int = 4, n_iter: int = 8, seed: int = 0,
                 model_factory: Optional[Callable[[], object]] = None) -> Tuple[Config, BOResult]:
    """Return (cfg with the best eps_total, BO trace). Each evaluation is a full federated run with dp=True."""
    def loss(x: np.ndarray) -> float:
        eps = float(x[0])
        model = model_factory() if model_factory else None
        r = run(clients, replace(cfg, dp=True, eps_total=eps), n_features, model=model, eval_split="val")
        return alpha * (1.0 - r.history[-1]["auc"]) + beta / eps

    res = bayes_opt(loss, [eps_bounds], n_init=n_init, n_iter=n_iter, log=[0], seed=seed)
    return replace(cfg, dp=True, eps_total=float(res.x_best[0])), res
