"""Anomaly scoring and Krum (paper section 3.3, eq. 9).

Eq. (9) of the paper:  S_i = l1 * ‖d_i‖2 + l2 * cos(d_i, d_bar) + l3 * dL_i
  ‖d_i‖2   norm of the client update
  cos      agreement with the consensus direction d_bar
  dL_i     local loss change rate = (loss_after - loss_before) / loss_before, reported by the client

Choices the paper leaves open, ours: (1) d_bar is the coordinate-wise MEDIAN of the other clients' updates, not their
mean, because a few scaled attackers drag a mean toward themselves; (2) the paper writes +l2, but a high score must mean
"anomalous", so the default l2 is NEGATIVE (low agreement raises S); defaults l = (1, -1, 1) are `assumed`.
A client is flagged when its robust z-score (median and MAD) of S exceeds ``z_thr``. Both stages report "not run" with a
reason when there are too few clients, instead of silently passing everyone.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np


@dataclass
class Submission:
    client_id: int
    delta: np.ndarray
    n: int
    loss_ratio: float = 1.0      # loss_after / loss_before


DEFAULT_LAMBDA = (1.0, -1.0, 1.0)


def anomaly_scores(subs: Sequence[Submission], lam: Tuple[float, float, float] = DEFAULT_LAMBDA) -> np.ndarray:
    d = np.array([s.delta for s in subs])
    norms = np.linalg.norm(d, axis=1)
    out = np.zeros(len(subs))
    for i, s in enumerate(subs):
        others = np.median(np.delete(d, i, axis=0), axis=0)
        den = norms[i] * np.linalg.norm(others)
        cos = float(d[i] @ others / den) if den > 0 else 0.0
        out[i] = lam[0] * norms[i] + lam[1] * cos + lam[2] * (s.loss_ratio - 1.0)
    return out


def flag_anomalies(subs: Sequence[Submission], z_thr: float = 3.5, lam=DEFAULT_LAMBDA) -> Tuple[Dict[int, str], Optional[str]]:
    """Returns ({client_id: reason}, not_run_reason)."""
    if len(subs) < 4:
        return {}, f"anomaly filter needs >= 4 submissions, got {len(subs)}"
    s = anomaly_scores(subs, lam)
    med = np.median(s)
    mad = np.median(np.abs(s - med)) * 1.4826 + 1e-12
    z = (s - med) / mad
    return {subs[i].client_id: f"anomaly z={z[i]:.1f} > {z_thr}" for i in range(len(subs)) if z[i] > z_thr}, None


def krum_scores(deltas: np.ndarray, f: int) -> np.ndarray:
    n = len(deltas)
    dist = ((deltas[:, None, :] - deltas[None, :, :]) ** 2).sum(-1)
    return np.array([np.sort(np.delete(dist[i], i))[: n - f - 2].sum() for i in range(n)])


def multi_krum(subs: Sequence[Submission], f: int, m: int) -> Tuple[List[int], Optional[str]]:
    """Indices of the m submissions with the lowest Krum score. Needs n >= 2f + 3 and f >= 1."""
    n = len(subs)
    if f < 1 or n < 2 * f + 3:
        return list(range(n)), f"krum needs n >= {2 * max(f, 1) + 3} with f >= 1, got n={n}, f={f}"
    sc = krum_scores(np.array([s.delta for s in subs]), f)
    return sorted(np.argsort(sc)[: max(1, min(m, n - f))].tolist()), None
