"""Split model for vertical FL. A: embedding e = tanh(X_a W_a). B: p = sigmoid(e . v + X_b w_b + bias), and the label.

Crossing the boundary, per row: A -> B the embedding (clipped to norm C_e, Gaussian noise sigma_e); B -> A the gradient of the
loss with respect to that embedding (clipped to norm C_g, Gaussian noise sigma_g). Raw features and labels never move.
Each row is released once per epoch in each direction, so a row costs `epochs` Gaussian releases per direction (Renyi
accounting from privacy/rdp.py, sensitivity 2C). The noise is row-level local DP on the messages, not DP on the final model.
Known weakness: gradients can leak labels; clipping and noise reduce that, they do not remove it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from ..ml.model import auc, sigmoid
from ..privacy import rdp


@dataclass
class VConfig:
    hidden: int = 8
    epochs: int = 30
    batch: int = 32
    lr: float = 0.5
    clip_e: float = 2.0                  # embedding norm bound
    clip_g: float = 1.0                  # per-row gradient norm bound
    sigma_e: float = 0.0                 # 0 = no noise
    sigma_g: float = 0.0
    seed: int = 0
    delta: float = 1e-5


def _clip_rows(M: np.ndarray, c: float) -> np.ndarray:
    n = np.linalg.norm(M, axis=1, keepdims=True)
    return M / np.maximum(1.0, n / c)


class PartyA:
    """Platform: features only."""

    def __init__(self, d_a: int, cfg: VConfig, rng: np.random.Generator):
        self.cfg, self.rng = cfg, rng
        self.W = rng.normal(0, 0.3, (d_a, cfg.hidden))
        self._X: Optional[np.ndarray] = None
        self._H: Optional[np.ndarray] = None

    def embed(self, X: np.ndarray, train: bool) -> np.ndarray:
        H = np.tanh(X @ self.W)
        if train:
            self._X, self._H = X, H
        E = _clip_rows(H, self.cfg.clip_e)
        if train and self.cfg.sigma_e > 0:
            E = E + self.rng.normal(0, self.cfg.sigma_e, E.shape)
        return E

    def backward(self, grad_E: np.ndarray) -> None:
        X, H = self._X, self._H
        g = (grad_E * (1 - H ** 2))
        self.W -= self.cfg.lr * (X.T @ g) / len(X)


class PartyB:
    """Advertiser: the label, and optionally its own features X_b."""

    def __init__(self, d_b: int, cfg: VConfig, rng: np.random.Generator):
        self.cfg, self.rng = cfg, rng
        self.v = rng.normal(0, 0.3, cfg.hidden)
        self.w = np.zeros(d_b)
        self.b = 0.0

    def logits(self, E: np.ndarray, Xb: np.ndarray) -> np.ndarray:
        return E @ self.v + (Xb @ self.w if Xb.shape[1] else 0.0) + self.b

    def step(self, E: np.ndarray, Xb: np.ndarray, y: np.ndarray) -> np.ndarray:
        n = len(y)
        r = sigmoid(self.logits(E, Xb)) - y                 # dL/dz per row
        gE = r[:, None] * self.v[None, :]                   # per-row gradient w.r.t. the embedding
        self.v -= self.cfg.lr * (E.T @ r) / n
        if Xb.shape[1]:
            self.w -= self.cfg.lr * (Xb.T @ r) / n
        self.b -= self.cfg.lr * r.mean()
        gE = _clip_rows(gE, self.cfg.clip_g)
        if self.cfg.sigma_g > 0:
            gE = gE + self.rng.normal(0, self.cfg.sigma_g, gE.shape)
        return gE

    def predict(self, E: np.ndarray, Xb: np.ndarray) -> np.ndarray:
        return sigmoid(self.logits(E, Xb))


def privacy_spent(cfg: VConfig) -> Dict[str, Optional[float]]:
    """Row-level epsilon for the embedding and gradient releases (each row is released once per epoch per direction)."""
    e = rdp.eps_after(cfg.sigma_e, 2.0 * cfg.clip_e, cfg.epochs, cfg.delta) if cfg.sigma_e > 0 else None
    g = rdp.eps_after(cfg.sigma_g, 2.0 * cfg.clip_g, cfg.epochs, cfg.delta) if cfg.sigma_g > 0 else None
    return {"eps_embedding": e, "eps_gradient": g, "eps_total": (e or 0) + (g or 0) if (e or g) else None, "delta": cfg.delta}


def train(Xa: np.ndarray, Xb: np.ndarray, y: np.ndarray, cfg: VConfig, test_frac: float = 0.25) -> dict:
    """Train on rows already aligned by PSI. Returns the history, the final test AUC and the privacy spent."""
    rng = np.random.default_rng(cfg.seed)
    n = len(y)
    order = rng.permutation(n)
    n_test = max(1, int(n * test_frac)) if n >= 8 else 0
    te, tr = order[:n_test], order[n_test:]
    A, B = PartyA(Xa.shape[1], cfg, rng), PartyB(Xb.shape[1], cfg, rng)
    hist: List[dict] = []
    for ep in range(cfg.epochs):
        p = rng.permutation(tr)
        for s in range(0, len(p), cfg.batch):
            idx = p[s:s + cfg.batch]
            E = A.embed(Xa[idx], train=True)                # message A -> B
            gE = B.step(E, Xb[idx], y[idx])                 # message B -> A
            A.backward(gE)
        pr = B.predict(A.embed(Xa[tr], False), Xb[tr])
        row = {"epoch": ep + 1, "train_auc": auc(y[tr], pr) if len(set(y[tr])) > 1 else float("nan")}
        if n_test and len(set(y[te])) > 1:
            row["test_auc"] = auc(y[te], B.predict(A.embed(Xa[te], False), Xb[te]))
        hist.append(row)
    return {"history": hist, "test_auc": hist[-1].get("test_auc"), "n": int(n), "n_train": int(len(tr)), "n_test": int(n_test),
            "privacy": privacy_spent(cfg), "model": (A, B)}
