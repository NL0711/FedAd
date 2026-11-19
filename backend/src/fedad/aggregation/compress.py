"""Communication reduction (paper section 4.2): top-k sparsification, index delta coding, float16 values, DEFLATE.

Differences from the paper, stated: the paper's "differential coding relative to previous uploads" is implemented as
delta coding of the sorted index gaps inside one upload (the value stream is not differenced across rounds); DEFLATE
(LZ77 + Huffman) stands in for the Huffman or arithmetic coder it names. Values are quantised to float16, so the
round trip is lossy by that rounding, and only that.

Apply sparsification AFTER noise: top-k of an already noised update is post-processing and costs no extra privacy.
"""

from __future__ import annotations

import struct
import zlib

import numpy as np


def dense_bytes(n_params: int) -> int:
    return 4 * n_params


def top_k(v: np.ndarray, k: int) -> np.ndarray:
    if k <= 0 or k >= v.size:
        return v
    out = np.zeros_like(v)
    idx = np.argpartition(np.abs(v), -k)[-k:]
    out[idx] = v[idx]
    return out


def encode(v: np.ndarray) -> bytes:
    """Encode the non-zero entries of ``v``."""
    idx = np.flatnonzero(v).astype(np.int64)
    gaps = np.diff(idx, prepend=-1).astype(np.uint16 if v.size < 65536 else np.uint32)
    vals = v[idx].astype(np.float16)
    header = struct.pack("<IIB", v.size, idx.size, gaps.itemsize)
    return zlib.compress(header + gaps.tobytes() + vals.tobytes(), 9)


def decode(blob: bytes) -> np.ndarray:
    raw = zlib.decompress(blob)
    size, cnt, isz = struct.unpack("<IIB", raw[:9])
    dt = np.uint16 if isz == 2 else np.uint32
    gaps = np.frombuffer(raw[9:9 + cnt * isz], dtype=dt).astype(np.int64)
    vals = np.frombuffer(raw[9 + cnt * isz:], dtype=np.float16).astype(np.float64)
    out = np.zeros(size)
    out[np.cumsum(gaps) - 1] = vals
    return out
