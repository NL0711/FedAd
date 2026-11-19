"""Renyi differential privacy (RDP) accounting for repeated Gaussian releases (Mironov 2017).

Why it is here. ``dp.Accountant`` composes with the basic theorem (sum of epsilons), which is valid but loose: T releases
of an (eps, delta) Gaussian mechanism are charged T * eps. RDP composes the Gaussian mechanism far more tightly, so the SAME
noise gives a much smaller total epsilon, or, the other way round, a target total epsilon needs much less noise per round
(better AUC at the same guarantee). Nothing about the mechanism changes: clip to C, add N(0, sigma^2 I).

Math, all closed form for the Gaussian mechanism with L2 sensitivity ``s`` and noise std ``sigma``:
  RDP of order a:        eps_a = a * s^2 / (2 sigma^2)                 (Mironov 2017, Prop. 7)
  T-fold composition:    T * eps_a                                     (RDP composes by adding)
  conversion to (eps, delta), Balle et al. 2020 / Canonne et al. 2020 (tighter than the original log(1/delta)/(a-1)):
                         eps = T eps_a + log((a-1)/a) - (log(delta) + log(a)) / (a-1),  minimised over a > 1

No subsampling amplification is claimed: every client releases every round it takes part in, and which clients take part
is not hidden. Cross-checked against Google's ``dp-accounting`` in the tests (when installed).
"""

from __future__ import annotations

import math
from typing import Dict, Tuple

import numpy as np

_ORDERS = np.concatenate([1.0 + np.geomspace(1e-3, 1.0, 120), np.geomspace(2.0, 4096.0, 240)])


def rdp_gaussian(sigma: float, sensitivity: float, orders: np.ndarray = _ORDERS) -> np.ndarray:
    """RDP curve of one Gaussian release."""
    return orders * sensitivity ** 2 / (2.0 * sigma ** 2)


def rdp_to_eps(rdp: np.ndarray, delta: float, orders: np.ndarray = _ORDERS) -> Tuple[float, float]:
    """Smallest (eps, order) over ``orders`` for an RDP curve; ``delta`` in (0, 1)."""
    if not 0.0 < delta < 1.0:
        raise ValueError("delta must be in (0, 1)")
    eps = rdp + np.log((orders - 1.0) / orders) - (math.log(delta) + np.log(orders)) / (orders - 1.0)
    i = int(np.argmin(eps))
    return max(float(eps[i]), 0.0), float(orders[i])


def eps_after(sigma: float, sensitivity: float, releases: int, delta: float) -> float:
    """Total epsilon of ``releases`` Gaussian releases at fixed ``sigma`` (the per-client spend in a run)."""
    if releases <= 0:
        return 0.0
    return rdp_to_eps(releases * rdp_gaussian(sigma, sensitivity), delta)[0]


def calibrate_sigma(eps_total: float, delta_total: float, sensitivity: float, releases: int) -> float:
    """Smallest per-release noise std such that ``releases`` releases together are (eps_total, delta_total)-DP by RDP."""
    if eps_total <= 0 or releases <= 0 or not 0 < delta_total < 1:
        raise ValueError("need eps_total > 0, releases >= 1 and 0 < delta_total < 1")
    lo, hi = 1e-6 * sensitivity, sensitivity
    while eps_after(hi, sensitivity, releases, delta_total) > eps_total:
        hi *= 2.0
        if hi > 1e12 * sensitivity:
            raise ValueError("cannot calibrate")
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if eps_after(mid, sensitivity, releases, delta_total) > eps_total:
            lo = mid
        else:
            hi = mid
    return hi


def compare(eps_total: float, delta_total: float, sensitivity: float, releases: int) -> Dict[str, float]:
    """The same total (eps, delta) target under both accountants: the noise each needs and what the other would report.

    ``sigma_basic`` calibrates each release to (eps/T, delta/T) with the exact analytic Gaussian (basic composition).
    ``sigma_rdp`` calibrates the whole T-fold composition by RDP. ``eps_rdp_of_basic`` is the total epsilon the RDP
    accountant assigns to the basic calibration (always <= eps_total: basic is valid but loose).
    """
    from . import dp
    sig_basic = dp.calibrate_sigma(eps_total / releases, delta_total / releases, sensitivity)
    sig_rdp = calibrate_sigma(eps_total, delta_total, sensitivity, releases)
    return {"sigma_basic": sig_basic, "sigma_rdp": sig_rdp, "noise_ratio": sig_rdp / sig_basic,
            "eps_rdp_of_basic": eps_after(sig_basic, sensitivity, releases, delta_total)}
