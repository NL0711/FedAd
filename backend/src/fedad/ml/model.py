"""CTR model: logistic regression with a bias, numpy only.

SIMPLIFICATION vs the paper (section 2.2): the paper's local encoder is multilayer convolution plus an attention
module over behaviour sequences. That is NOT IMPLEMENTED here; the encoder is the model seam (``Model`` below).
"""

from __future__ import annotations

from typing import Tuple

import numpy as np


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


class Model:
    """Flat parameter vector ``w = [weights..., bias]``."""

    def __init__(self, n_features: int):
        self.n_features = n_features

    @property
    def n_params(self) -> int:
        return self.n_features + 1

    def init(self) -> np.ndarray:
        return np.zeros(self.n_params)

    def predict(self, w: np.ndarray, X: np.ndarray) -> np.ndarray:
        """Tabular columns only; the behaviour-history columns (after ``n_features``) are ignored."""
        return sigmoid(X[:, :self.n_features] @ w[:-1] + w[-1])

    def loss(self, w: np.ndarray, X: np.ndarray, y: np.ndarray) -> float:
        p = np.clip(self.predict(w, X), 1e-7, 1 - 1e-7)
        return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))

    def local_train(self, w: np.ndarray, X: np.ndarray, y: np.ndarray, epochs: int, lr: float, batch: int,
                    rng: np.random.Generator, l2: float = 1e-4) -> Tuple[np.ndarray, float, float]:
        """Minibatch SGD from ``w``. Returns (delta = trained - w, loss before, loss after)."""
        before = self.loss(w, X, y)
        cur = w.copy()
        n = len(y)
        for _ in range(epochs):
            order = rng.permutation(n)
            for s in range(0, n, batch):
                idx = order[s:s + batch]
                err = self.predict(cur, X[idx]) - y[idx]
                g = np.concatenate([X[idx, :self.n_features].T @ err / len(idx) + l2 * cur[:-1], [err.mean()]])
                cur -= lr * g
        return cur - w, before, self.loss(cur, X, y)


def auc(y: np.ndarray, score: np.ndarray) -> float:
    """Rank-based ROC AUC with tie handling. NaN if only one class is present."""
    y = np.asarray(y)
    pos = y == 1
    n_pos, n_neg = int(pos.sum()), int((~pos).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(score, kind="mergesort")
    s = score[order]
    ranks = np.empty(len(s))
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[i]:
            j += 1
        ranks[i:j + 1] = (i + j) / 2 + 1
        i = j + 1
    r = np.empty(len(s))
    r[order] = ranks
    return float((r[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))
