"""Aggregation weights (paper section 2.4, eq. 3).

Eq. (3) of the paper: theta_next = sum_i w_i theta_i with sum w_i = 1. Written on updates from the same base model
this is w + sum_i a_i d_i / sum_i a_i (w_i = a_i / sum a). The paper only says w_i depends on sample size, update
magnitude and historical performance; the raw weight below is OUR instantiation:

  a_i = n_i * h_i * m_i

  n_i  sample count (FedAvg's weight)
  h_i  historical performance in [h_min, 1]: exponential moving average of the client's local relative loss
       improvement, divided by the best client's. Self-reported, so a lying client can inflate it; the anomaly filter
       does not see it. Treat as a heuristic.
  m_i  update-magnitude damping = min(1, median norm / own norm): large updates count less.

With h = m = 1 this is exactly FedAvg. The paper's claim that this beats FedAvg is for MNIST with 10 clients; it is NOT
reproduced here and must be measured on your data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Sequence

import numpy as np


@dataclass
class History:
    ema: Dict[int, float] = field(default_factory=dict)
    beta: float = 0.7
    h_min: float = 0.1

    def update(self, client: int, loss_before: float, loss_after: float) -> None:
        gain = max(0.0, (loss_before - loss_after) / max(loss_before, 1e-9))
        self.ema[client] = gain if client not in self.ema else self.beta * self.ema[client] + (1 - self.beta) * gain

    def h(self, client: int) -> float:
        best = max(self.ema.values()) if self.ema else 0.0
        if best <= 0 or client not in self.ema:
            return 1.0
        return float(min(1.0, max(self.h_min, self.ema[client] / best)))


def weights(mode: str, n: Sequence[int], norms: Sequence[float], h: Sequence[float]) -> np.ndarray:
    """Raw (un-normalised) weights a_i. mode: fedavg | weighted."""
    n = np.asarray(n, dtype=float)
    if mode == "fedavg":
        return n
    if mode == "weighted":
        norms = np.asarray(norms, dtype=float)
        med = np.median(norms)
        m = np.minimum(1.0, med / np.maximum(norms, 1e-12)) if med > 0 else np.ones_like(norms)
        return n * np.asarray(h, dtype=float) * m
    raise ValueError(mode)
