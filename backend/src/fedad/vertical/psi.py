"""Private set intersection by commutative blinding (Diffie-Hellman PSI), in the RFC 3526 2048-bit safe-prime group.

Each party hashes an identifier into the group (squaring puts it in the prime-order subgroup) and raises it to a secret
exponent. Because (H(x)^a)^b == (H(x)^b)^a, an identifier in both sets ends up with the same doubly-blinded value, and nothing
else can be matched:

  A -> B : H(x)^a for each x in A                        (B learns |A| and nothing about the values)
  B -> A : (H(x)^a)^b in A's order, and H(y)^b shuffled  (A learns |B|)
  A      : (H(y)^b)^a for each of B's, in B's received order, sent back to B
  both   : intersect the doubly-blinded values; sort the matches by that value so both sides order their rows identically

Honest limits: semi-honest parties only, set sizes are revealed, and a party that can guess identifiers (an email list)
can test guesses against its own view of the intersection. Use identifiers with enough entropy.
"""

from __future__ import annotations

import hashlib
import secrets
from typing import Dict, List, Sequence, Tuple

# RFC 3526 group 14 (2048-bit MODP safe prime)
P = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051"
    "015728E5A8AACAA68FFFFFFFFFFFFFFFF", 16)
Q = (P - 1) // 2


def hash_to_group(identifier: str, domain: bytes = b"fedad-psi-v1") -> int:
    """Expand SHA-256 to 2048+128 bits, reduce mod p, square into the order-q subgroup."""
    seed = identifier.strip().lower().encode()
    out, i = b"", 0
    while len(out) < 288:
        out += hashlib.sha256(domain + i.to_bytes(4, "big") + seed).digest()
        i += 1
    x = int.from_bytes(out, "big") % P
    return pow(x, 2, P) if x > 1 else 4


class Party:
    """One side of the protocol. Holds its secret exponent and the order of its own identifiers."""

    def __init__(self, ids: Sequence[str]):
        self.ids: List[str] = list(ids)
        self._k = secrets.randbelow(Q - 2) + 2
        self._perm: List[int] = []

    def blind_own(self, shuffle: bool = False) -> List[int]:
        vals = [pow(hash_to_group(x), self._k, P) for x in self.ids]
        if shuffle:
            order = list(range(len(vals)))
            secrets.SystemRandom().shuffle(order)
            self._perm = order
            return [vals[i] for i in order]
        return vals

    def blind_other(self, blinded: Sequence[int]) -> List[int]:
        for v in blinded:
            if not 1 < v < P - 1 or pow(v, Q, P) != 1:        # must be in the subgroup, or the exponent could leak
                raise ValueError("value is not a group element")
        return [pow(v, self._k, P) for v in blinded]

    def order_of_shuffled(self) -> List[int]:
        return self._perm


def intersect(own_ids: Sequence[str], own_double: Sequence[int], other_double: Sequence[int]) -> List[Tuple[int, str]]:
    """Doubly-blinded value -> index in own_ids for the matches, sorted by the value (a canonical order both sides share)."""
    other = set(other_double)
    hits = [(d, i) for i, d in enumerate(own_double) if d in other]
    hits.sort()
    return [(d, i) for d, i in hits]


def run(ids_a: Sequence[str], ids_b: Sequence[str]) -> Tuple[List[int], List[int]]:
    """Whole protocol in one call: (row indices into A, row indices into B), same length, aligned pairwise."""
    a, b = Party(ids_a), Party(ids_b)
    sa = a.blind_own()                                     # A -> B
    da = b.blind_other(sa)                                 # B -> A, in A's order
    sb = b.blind_own(shuffle=True)                         # B -> A, shuffled
    sba = a.blind_other(sb)                                # A -> B, in the received (shuffled) order
    perm = b.order_of_shuffled()
    db = [0] * len(ids_b)                                  # B undoes its own shuffle: doubly-blinded value per own id
    for pos, orig in enumerate(perm):
        db[orig] = sba[pos]
    mine_a = intersect(a.ids, da, sba)                     # what A computes
    mine_b = intersect(b.ids, db, da)                      # what B computes
    assert [d for d, _ in mine_a] == [d for d, _ in mine_b]
    return [i for _, i in mine_a], [i for _, i in mine_b]
