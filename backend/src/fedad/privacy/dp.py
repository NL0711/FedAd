"""Differential privacy pieces (paper section 3, eqs. 4 to 8, read from the PDF page images).
The paper leaves sigma's calibration open ("computed from epsilon and sensitivity"); we use the analytic Gaussian mechanism.

What is guaranteed. Each client clips its update to L2 norm C and adds Gaussian noise before it leaves the client
(local DP at the update level; neighbouring "datasets" are two possible updates, so sensitivity is 2C). The noise scale
is calibrated with the analytic Gaussian mechanism (Balle and Wang 2018), valid for any epsilon. Per-client spend is
tracked with basic composition (sum of epsilon, sum of delta): simple and loose, never optimistic.

What is NOT covered: anything the client sends outside the noised update (for example the loss statistics used by the
anomaly score), the choice of which clients take part, and a client's data across many app installs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Dict, Sequence, Tuple

import numpy as np


def _phi(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def gaussian_delta(sigma: float, eps: float, sensitivity: float) -> float:
    """Exact delta of the Gaussian mechanism with noise std ``sigma`` (Balle and Wang 2018, Theorem 8)."""
    a = sensitivity / (2.0 * sigma)
    b = eps * sigma / sensitivity
    return _phi(a - b) - math.exp(eps) * _phi(-a - b)


def calibrate_sigma(eps: float, delta: float, sensitivity: float) -> float:
    """Smallest noise std achieving (eps, delta)-DP, by bisection on the exact delta."""
    if eps <= 0 or not 0 < delta < 1:
        raise ValueError("need eps > 0 and 0 < delta < 1")
    lo, hi = 1e-6 * sensitivity, sensitivity
    while gaussian_delta(hi, eps, sensitivity) > delta:
        hi *= 2.0
        if hi > 1e12 * sensitivity:
            raise ValueError("cannot calibrate")
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if gaussian_delta(mid, eps, sensitivity) > delta:
            lo = mid
        else:
            hi = mid
    return hi


def clip_l2(v: np.ndarray, c: float) -> np.ndarray:
    return v / max(1.0, float(np.linalg.norm(v)) / c)


def add_gaussian_noise(v: np.ndarray, sigma_abs: float, rng: np.random.Generator) -> np.ndarray:
    """Eq. (4): v + N(0, sigma^2 I)."""
    return v + rng.normal(0.0, sigma_abs, size=v.shape)


def allocate_budget(eps_total: float, rounds: int, n_samples: Sequence[int], contribution: Sequence[float] = None,
                    mode: str = "uniform") -> np.ndarray:
    """Per-round, per-client epsilon, shape (n_clients,).

    Eq. (5): eps_t = eps_total / T.
    Eq. (6), mode "paper": eps_it = eps_t * (n_i g_i / sum_j n_j g_j), a normalised split of the round budget, so the
    clients' budgets sum to eps_t. Note the paper's worked example (eq. 7) divides by 10000 x 1.0 although the sum
    includes the 1.2 client; with the sum computed properly the example gives 0.01176, not 0.012.
    Mode "uniform": eps_it = eps_t for every client.
    Which one is right depends on the threat model. Each client's noise protects only that client's own update (local
    DP), so by parallel composition every client could use the full eps_t; "paper" divides it by roughly N and so adds
    about N times more noise per client. "paper" is implemented because the paper specifies it; "uniform" is the default.
    """
    n = np.asarray(n_samples, dtype=float)
    eps_t = eps_total / rounds
    if mode == "uniform":
        return np.full(len(n), eps_t)
    if mode == "paper":
        g = np.ones(len(n)) if contribution is None else np.asarray(contribution, dtype=float)
        return eps_t * (n * g) / float((n * g).sum())
    raise ValueError(mode)


@dataclass
class Accountant:
    """Per-client basic composition."""
    delta_round: float
    eps: Dict[int, float] = field(default_factory=dict)
    delta: Dict[int, float] = field(default_factory=dict)

    def spend(self, client: int, eps: float) -> None:
        self.eps[client] = self.eps.get(client, 0.0) + eps
        self.delta[client] = self.delta.get(client, 0.0) + self.delta_round

    def report(self) -> Dict[int, Tuple[float, float]]:
        return {c: (self.eps[c], self.delta[c]) for c in self.eps}


def pul_grid_search(sigmas: Sequence[float], error_fn: Callable[[float], float], eps_fn: Callable[[float], float],
                    alpha: float, beta: float) -> Tuple[float, Dict[float, Tuple[float, float, float]]]:
    """Privacy-Utility Loss, eq. (8): L = alpha * Error(sigma) + beta * (1 / eps). ``eps_fn`` maps sigma to epsilon.

    ``error_fn`` must be measured on VALIDATION data. Returns the best sigma and {sigma: (error, eps, loss)}.
    Grid search only; Bayesian optimisation is NOT IMPLEMENTED. alpha and beta are the caller's choice, not tuned here.
    """
    table = {}
    for s in sigmas:
        e, p = error_fn(s), eps_fn(s)
        table[s] = (e, p, alpha * e + beta / p)
    best = min(table, key=lambda s: table[s][2])
    return best, table
