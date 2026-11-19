"""SYNTHETIC ad-impression data. No real user data is used anywhere in this repo.

A client is one publisher app / user cohort holding its own impressions. Clients differ (non-IID): own base click rate,
own category mix and a client-specific shift of the true click model, scaled by ``heterogeneity``.

Row layout of ``X`` (the layout your app should reproduce):
  columns [0, N_FEATURES)              tabular: one-hot device, hour bucket, ad category, placement, plus numeric
                                       user-context features (recency, frequency, dwell time, ...)
  columns [N_FEATURES, N_FEATURES+L)   behaviour history: ids (1..8, 0 = padding) of the ad categories the user engaged
                                       with before, most recent first, stored as floats
The click probability depends on the tabular part AND on how often the shown ad's category appears in the history, so a
sequence model can beat a tabular-only model on this data. Splits per client: train, validation (tuning), test (report).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import numpy as np

SYNTHETIC = True
CATEGORICAL = {"device": 3, "hour_bucket": 6, "ad_category": 8, "placement": 4}
N_NUMERIC = 10
HIST_LEN = 8
N_CATEGORIES = CATEGORICAL["ad_category"]
AD_CAT_OFFSET = CATEGORICAL["device"] + CATEGORICAL["hour_bucket"]


def feature_names() -> List[str]:
    names = [f"{k}={i}" for k, n in CATEGORICAL.items() for i in range(n)]
    return names + [f"num{i}" for i in range(N_NUMERIC)]


N_FEATURES = len(feature_names())
ROW_WIDTH = N_FEATURES + HIST_LEN


@dataclass
class ClientData:
    client_id: int
    X: np.ndarray
    y: np.ndarray
    X_val: np.ndarray
    y_val: np.ndarray
    X_test: np.ndarray
    y_test: np.ndarray
    synthetic: bool = True

    @property
    def n(self) -> int:
        return len(self.y)


def _draw_features(rng, n, cat_probs, num_shift) -> np.ndarray:
    cols = []
    for probs in cat_probs:
        idx = rng.choice(len(probs), size=n, p=probs)
        oh = np.zeros((n, len(probs)))
        oh[np.arange(n), idx] = 1.0
        cols.append(oh)
    cols.append(rng.normal(0.0, 1.0, size=(n, N_NUMERIC)) + num_shift)
    return np.hstack(cols)


def _draw_history(rng, n, cat_probs) -> np.ndarray:
    """Each user has two favourite categories (drawn from the client's mix); 70 percent of past engagements hit them."""
    probs = cat_probs[2]
    fav = np.stack([rng.choice(N_CATEGORIES, size=2, p=probs) for _ in range(n)])
    pick = rng.random((n, HIST_LEN)) < 0.7
    fav_pick = fav[np.arange(n)[:, None], rng.integers(0, 2, size=(n, HIST_LEN))]
    other = rng.choice(N_CATEGORIES, size=(n, HIST_LEN), p=probs)
    h = np.where(pick, fav_pick, other) + 1
    length = rng.integers(3, HIST_LEN + 1, size=n)
    h[np.arange(HIST_LEN)[None, :] >= length[:, None]] = 0
    return h.astype(float)


def make_clients(n_clients: int = 10, n_range: Tuple[int, int] = (800, 4000), heterogeneity: float = 0.4,
                 base_logit: float = -2.0, history_effect: float = 6.0, val_frac: float = 0.1,
                 test_frac: float = 0.2, seed: int = 0) -> List[ClientData]:
    rng = np.random.default_rng(seed)
    w_true = rng.normal(0.0, 0.8, size=N_FEATURES)
    clients = []
    for c in range(n_clients):
        n = int(rng.integers(n_range[0], n_range[1] + 1))
        cat_probs = [rng.dirichlet(np.full(k, 3.0 / (0.2 + heterogeneity))) for k in CATEGORICAL.values()]
        shift = rng.normal(0.0, heterogeneity, size=N_NUMERIC)
        w_c = w_true + rng.normal(0.0, heterogeneity * 0.5, size=N_FEATURES)
        b_c = base_logit + rng.normal(0.0, heterogeneity * 0.5)
        Xt = _draw_features(rng, n, cat_probs, shift)
        H = _draw_history(rng, n, cat_probs)
        ad = Xt[:, AD_CAT_OFFSET:AD_CAT_OFFSET + N_CATEGORIES].argmax(1) + 1
        nonpad = np.maximum((H > 0).sum(1), 1)
        affinity = ((H == ad[:, None]).sum(1)) / nonpad
        p = 1.0 / (1.0 + np.exp(-(Xt @ w_c + b_c + history_effect * affinity)))
        y = (rng.random(n) < p).astype(float)
        X = np.hstack([Xt, H])
        k_test, k_val = int(n * test_frac), int(n * val_frac)
        k = n - k_test - k_val
        clients.append(ClientData(c, X[:k], y[:k], X[k:k + k_val], y[k:k + k_val], X[k + k_val:], y[k + k_val:]))
    return clients
