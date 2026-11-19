"""Bayesian optimisation (paper section 3.2, "tuned dynamically using Bayesian optimization or grid search").

Gaussian-process surrogate (RBF kernel, length scale picked by marginal likelihood from a small grid, jitter for noise)
with expected improvement, numpy only. Minimises ``f`` over a box. Inputs are normalised to [0, 1]; dimensions listed in
``log`` are searched on a log scale (right for epsilon or learning rate). Candidates are random points plus perturbations
of the best so far; no gradient-based acquisition optimiser. Fine for a handful of dimensions and tens of evaluations,
not for high-dimensional or very noisy objectives.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Tuple

import numpy as np


@dataclass
class BOResult:
    x_best: np.ndarray
    y_best: float
    xs: List[np.ndarray] = field(default_factory=list)
    ys: List[float] = field(default_factory=list)


def _rbf(a: np.ndarray, b: np.ndarray, ls: float) -> np.ndarray:
    d2 = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
    return np.exp(-0.5 * d2 / ls ** 2)


def _fit(X: np.ndarray, y: np.ndarray, jitter: float):
    best = None
    for ls in (0.1, 0.2, 0.4, 0.8):
        K = _rbf(X, X, ls) + jitter * np.eye(len(X))
        try:
            L = np.linalg.cholesky(K)
        except np.linalg.LinAlgError:
            continue
        alpha = np.linalg.solve(L.T, np.linalg.solve(L, y))
        nll = 0.5 * y @ alpha + np.log(np.diag(L)).sum()
        if best is None or nll < best[0]:
            best = (nll, ls, L, alpha)
    if best is None:
        raise np.linalg.LinAlgError("GP fit failed")
    return best[1:]


def _predict(Xc: np.ndarray, X: np.ndarray, ls: float, L: np.ndarray, alpha: np.ndarray):
    Ks = _rbf(Xc, X, ls)
    mu = Ks @ alpha
    v = np.linalg.solve(L, Ks.T)
    var = np.maximum(1.0 - (v ** 2).sum(0), 1e-12)
    return mu, np.sqrt(var)


def _ei(mu: np.ndarray, sd: np.ndarray, best: float) -> np.ndarray:
    z = (best - mu) / sd
    cdf = 0.5 * (1 + np.vectorize(math.erf)(z / math.sqrt(2)))
    pdf = np.exp(-0.5 * z ** 2) / math.sqrt(2 * math.pi)
    return (best - mu) * cdf + sd * pdf


def bayes_opt(f: Callable[[np.ndarray], float], bounds: Sequence[Tuple[float, float]], n_init: int = 5, n_iter: int = 15,
              log: Optional[Sequence[int]] = None, seed: int = 0, jitter: float = 1e-6) -> BOResult:
    rng = np.random.default_rng(seed)
    lo = np.array([b[0] for b in bounds], dtype=float)
    hi = np.array([b[1] for b in bounds], dtype=float)
    log = set(log or [])
    for i in log:
        if lo[i] <= 0:
            raise ValueError("log dimensions need positive bounds")
    tl = np.array([math.log(lo[i]) if i in log else lo[i] for i in range(len(lo))])
    th = np.array([math.log(hi[i]) if i in log else hi[i] for i in range(len(hi))])

    def to_x(u: np.ndarray) -> np.ndarray:
        t = tl + u * (th - tl)
        return np.array([math.exp(t[i]) if i in log else t[i] for i in range(len(t))])

    d = len(bounds)
    U = list(rng.random((n_init, d)))
    ys: List[float] = []
    xs: List[np.ndarray] = []
    for u in U:
        x = to_x(u)
        xs.append(x)
        ys.append(float(f(x)))
    for _ in range(n_iter):
        Un = np.array(U)
        y = np.array(ys)
        mu_y, sd_y = y.mean(), y.std() + 1e-12
        ls, L, alpha = _fit(Un, (y - mu_y) / sd_y, jitter)
        best_u = Un[int(np.argmin(y))]
        cand = np.vstack([rng.random((1500, d)), np.clip(best_u + rng.normal(0, 0.05, (500, d)), 0, 1)])
        mu, sd = _predict(cand, Un, ls, L, alpha)
        u = cand[int(np.argmax(_ei(mu, sd, ((y.min() - mu_y) / sd_y))))]
        U.append(u)
        x = to_x(u)
        xs.append(x)
        ys.append(float(f(x)))
    i = int(np.argmin(ys))
    return BOResult(xs[i], ys[i], xs, ys)
