"""Additively homomorphic encryption of update vectors (paper section 2.3, "homomorphic encryption"): Paillier.

Paillier: n = p q, g = n + 1, Enc(m) = (1 + m n) r^n mod n^2, Dec via lambda = lcm(p-1, q-1). Multiplying ciphertexts adds
plaintexts, so an aggregator can sum encrypted edge vectors without ever holding the key.

Roles (both are needed for the guarantee):
  KeyHolder   generates the key pair, publishes ``pub``, decrypts ONLY the final sum.
  aggregator  holds ``pub`` and adds ciphertexts. It never sees a plaintext vector.
If the aggregator and the key holder are the same party or collude, nothing is protected. This is a single-process
SIMULATION of those roles.

Packing: a vector is fixed-point encoded (2^-16 resolution, offset 2^44 so slots are non-negative) and packed into 64-bit
slots of one plaintext, floor((bits-1)/64) values per ciphertext. Sums of up to 2^18 vectors fit without slot overflow;
|value| must be below 2^27. Out-of-range values raise instead of wrapping.

Security level. Pure-Python big integers, textbook Paillier, no side-channel hardening, no ciphertext authentication or
zero-knowledge proof that a client encrypted an honest vector (a malicious client can still send a bad one). Use
``bits >= 2048`` for anything beyond a demo. ``bits=512`` is accepted for tests and is NOT SECURE. It is slow: one
modular exponentiation per ciphertext per party, so it suits small models (the logistic CTR model), not the encoder
at every round.
"""

from __future__ import annotations

import math
import secrets
from dataclasses import dataclass
from typing import List, Sequence

import numpy as np

SLOT_BITS = 64
SCALE = float(2 ** 16)
OFFSET = 2 ** 44
LIMIT = 2 ** 27


def _is_prime(n: int, rounds: int = 40) -> bool:
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(rounds):
        a = secrets.randbelow(n - 3) + 2
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def _prime(bits: int) -> int:
    while True:
        c = secrets.randbits(bits) | (1 << (bits - 1)) | 1
        if _is_prime(c):
            return c


@dataclass(frozen=True)
class PublicKey:
    n: int

    @property
    def n2(self) -> int:
        return self.n * self.n

    @property
    def bits(self) -> int:
        return self.n.bit_length()

    @property
    def slots(self) -> int:
        return (self.bits - 1) // SLOT_BITS


class KeyHolder:
    def __init__(self, bits: int = 2048):
        if bits < 512:
            raise ValueError("key too small")
        while True:
            p, q = _prime(bits // 2), _prime(bits // 2)
            if p != q and math.gcd(p * q, (p - 1) * (q - 1)) == 1:
                break
        self.pub = PublicKey(p * q)
        self._lam = math.lcm(p - 1, q - 1)
        self._mu = pow(self._lam, -1, self.pub.n)

    def decrypt_int(self, c: int) -> int:
        n = self.pub.n
        return ((pow(c, self._lam, self.pub.n2) - 1) // n) * self._mu % n

    def decrypt_sum(self, cts: Sequence[int], length: int, n_terms: int) -> np.ndarray:
        """Decrypt the packed ciphertexts of a SUM of ``n_terms`` vectors into a float vector of ``length``."""
        slots = self.pub.slots
        out: List[int] = []
        mask = (1 << SLOT_BITS) - 1
        for c in cts:
            m = self.decrypt_int(c)
            for _ in range(slots):
                out.append((m & mask) - n_terms * OFFSET)
                m >>= SLOT_BITS
        return np.array(out[:length], dtype=np.float64) / SCALE


def encrypt_vector(pub: PublicKey, v: np.ndarray) -> List[int]:
    ints = np.round(np.asarray(v, dtype=np.float64) * SCALE)
    if np.any(np.abs(ints) >= LIMIT * SCALE):
        raise ValueError("value out of range for HE fixed point")
    ints = [int(x) + OFFSET for x in ints]
    cts = []
    for s in range(0, len(ints), pub.slots):
        m = 0
        for j, x in enumerate(ints[s:s + pub.slots]):
            m |= x << (SLOT_BITS * j)
        r = secrets.randbelow(pub.n - 2) + 2
        cts.append((1 + m * pub.n) * pow(r, pub.n, pub.n2) % pub.n2)
    return cts


def add_encrypted(pub: PublicKey, a: Sequence[int], b: Sequence[int]) -> List[int]:
    return [x * y % pub.n2 for x, y in zip(a, b)]


def he_sum(vectors: Sequence[np.ndarray], holder: KeyHolder) -> np.ndarray:
    """Encrypt each vector under the holder's public key, add the ciphertexts, decrypt only the sum."""
    pub = holder.pub
    acc = None
    for v in vectors:
        ct = encrypt_vector(pub, v)
        acc = ct if acc is None else add_encrypted(pub, acc, ct)
    return holder.decrypt_sum(acc, len(vectors[0]), len(vectors))
