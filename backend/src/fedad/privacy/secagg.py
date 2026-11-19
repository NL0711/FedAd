"""Additive secret sharing of an update vector across ``k`` aggregation servers (paper section 2.3, eq. 2).

A vector is fixed-point encoded and split into k uniformly random shares mod 2^64 that sum to it. Any k-1 shares are
independent of the secret. Each server sums the shares it receives; only the sum of the server totals is revealed.

Scope, stated plainly:
  - It protects an update only from fewer than k colluding servers. It does NOT stop a client lying, and it does not
    protect a value that is revealed in the clear elsewhere.
  - It is a single-process SIMULATION: nothing here is networked or authenticated.
  - Homomorphic encryption, which the paper combines with it, is NOT IMPLEMENTED.
  - Fixed point is 2^-20 resolution; |value| must stay far below 2^43.
"""

from __future__ import annotations

from typing import List, Sequence

import numpy as np

SCALE = float(2 ** 20)


def encode(x: np.ndarray) -> np.ndarray:
    return np.round(np.asarray(x, dtype=np.float64) * SCALE).astype(np.int64).view(np.uint64)


def decode(u: np.ndarray) -> np.ndarray:
    return u.view(np.int64).astype(np.float64) / SCALE


def share(x: np.ndarray, k: int, rng: np.random.Generator) -> List[np.ndarray]:
    if k < 2:
        raise ValueError("need at least 2 servers")
    secret = encode(x)
    shares = [rng.integers(0, 2 ** 64, size=secret.shape, dtype=np.uint64) for _ in range(k - 1)]
    last = secret.copy()
    with np.errstate(over="ignore"):
        for s in shares:
            last = last - s
    return shares + [last]


def server_sum(shares_for_server: Sequence[np.ndarray]) -> np.ndarray:
    total = np.zeros_like(shares_for_server[0])
    with np.errstate(over="ignore"):
        for s in shares_for_server:
            total = total + s
    return total


def reconstruct(server_totals: Sequence[np.ndarray]) -> np.ndarray:
    total = np.zeros_like(server_totals[0])
    with np.errstate(over="ignore"):
        for t in server_totals:
            total = total + t
    return decode(total)


def secure_sum(vectors: Sequence[np.ndarray], k: int, rng: np.random.Generator) -> np.ndarray:
    """Sum of ``vectors`` computed through k servers."""
    per_server: List[List[np.ndarray]] = [[] for _ in range(k)]
    for v in vectors:
        for srv, sh in enumerate(share(v, k, rng)):
            per_server[srv].append(sh)
    return reconstruct([server_sum(p) for p in per_server])
