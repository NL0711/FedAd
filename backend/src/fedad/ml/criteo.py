"""REAL ad-click data: the Criteo 1TB click logs (display advertising), a slice of one day.

Source: https://huggingface.co/datasets/criteo/CriteoClickLogs, day 2015-02-15, one parquet part (766,864 rows). Licence
CC BY-NC-SA 4.0: free for research and teaching with attribution, NOT for commercial use. Criteo subsamples clicks and
non-clicks at different rates, so the click rate here is much higher than a real ad system's. Cite the dataset.

Columns: label (click), 13 integer count features, 26 categorical features hashed to 32-bit ids (meanings undisclosed).
There is NO user or publisher id. Features used here, with FIXED constants (never per-device statistics):
  numeric      log1p(max(x, 0)) / 6, clamped to [0, 3]; a missing value becomes 0                        13 features
  categorical  crc32("<column>:<value>") mod 16 one-hot ("hashing trick"); a missing value sets no bit    26 x 16 features
The model is logistic regression on these 429 features (+ bias), the same ``ml.model.Model`` used everywhere.

SIMULATED federation, stated plainly: the data are not naturally partitioned. Clients are formed by hashing ONE anonymised
categorical column (the one whose cardinality in the sample is closest to 1000), as a stand-in for "one publisher app per
client". That yields realistic feature skew and unequal client sizes, but it is an assumption of this project, not a Criteo
fact. Each client's rows are split 70/10/20 into train / validation / test at random (not by time).

Setup:  python -m fedad.ml.criteo download   (47 MB)  then  python -m fedad.ml.criteo prepare
"""

from __future__ import annotations

import sys
import urllib.request
import zlib
from pathlib import Path
from typing import List

import numpy as np

from .data import ClientData

NAME = "Criteo click logs (day 2015-02-15, 1 of 24 daily files, part 79)"
LICENSE = "CC BY-NC-SA 4.0 (non-commercial)"
URL = ("https://huggingface.co/datasets/criteo/CriteoClickLogs/resolve/main/data/day=2015-02-15/"
       "part-00079-99c339d5-fbac-4110-9dcf-75453a61a5c1.c000.snappy.parquet")
N_NUMERIC, N_CAT, BUCKETS = 13, 26, 16
N_FEATURES = N_NUMERIC + N_CAT * BUCKETS
NUM_SCALE, NUM_CLAMP = 6.0, 3.0
SYNTHETIC = False

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
RAW = DATA_DIR / "criteo_raw" / "part.parquet"
CACHE = DATA_DIR / "criteo_sample.npz"


def available() -> bool:
    return CACHE.exists()


def download(dest: Path = RAW) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {URL}\n  -> {dest}", file=sys.stderr)
    urllib.request.urlretrieve(URL, dest)
    return dest


def prepare(parquet: Path = RAW, cache: Path = CACHE, rows: int = 300_000, seed: int = 0) -> dict:
    """Read the parquet, take a random ``rows`` sample, and store a compact cache (bucket ids, scaled numerics, labels)."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq
    t = pq.read_table(parquet)
    n_all = t.num_rows
    idx = np.sort(np.random.default_rng(seed).choice(n_all, size=min(rows, n_all), replace=False))
    t = t.take(idx)
    y = t["label"].to_numpy().astype(np.uint8)
    num = np.zeros((len(y), N_NUMERIC), dtype=np.float32)
    for j in range(N_NUMERIC):
        col = t[f"integer_feature_{j + 1}"].fill_null(0).to_numpy().astype(np.float64)
        num[:, j] = np.clip(np.log1p(np.maximum(col, 0.0)) / NUM_SCALE, 0.0, NUM_CLAMP)
    bucket = np.full((len(y), N_CAT), 255, dtype=np.uint8)           # 255 = missing
    crc = np.zeros((len(y), N_CAT), dtype=np.uint32)
    card = []
    for j in range(N_CAT):
        enc = pc.dictionary_encode(t[f"categorical_feature_{j + 1}"]).combine_chunks()
        vals = enc.dictionary.to_pylist()
        h = np.array([zlib.crc32(f"c{j + 1}:{v}".encode()) for v in vals], dtype=np.uint32)
        code = enc.indices.fill_null(-1).to_numpy(zero_copy_only=False).astype(np.int64)
        ok = code >= 0
        crc[ok, j] = h[code[ok]]
        bucket[ok, j] = (h[code[ok]] % BUCKETS).astype(np.uint8)
        card.append(len(vals))
    part_col = int(np.argmin([abs(c - 1000) for c in card]))
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, y=y, num=num, bucket=bucket, part=crc[:, part_col], part_col=part_col,
                        cardinality=np.array(card), source_rows=n_all)
    info = {"rows": int(len(y)), "source_rows": int(n_all), "click_rate": float(y.mean()), "partition_column": part_col + 1,
            "partition_cardinality": int(card[part_col])}
    print(info, file=sys.stderr)
    return info


def info() -> dict:
    z = np.load(CACHE)
    return {"name": NAME, "license": LICENSE, "synthetic": False, "sample_rows": int(len(z["y"])),
            "source_rows": int(z["source_rows"]), "click_rate": float(z["y"].mean()), "n_features": N_FEATURES,
            "partition_column": int(z["part_col"]) + 1, "partition_cardinality": int(z["cardinality"][int(z["part_col"])]),
            "short": "Criteo click logs (real, anonymised)"}


def _dense(num: np.ndarray, bucket: np.ndarray) -> np.ndarray:
    n = len(num)
    X = np.zeros((n, N_FEATURES), dtype=np.float32)
    X[:, :N_NUMERIC] = num
    rows = np.arange(n)
    for j in range(N_CAT):
        ok = bucket[:, j] != 255
        X[rows[ok], N_NUMERIC + j * BUCKETS + bucket[ok, j].astype(np.int64)] = 1.0
    return X


def make_clients(n_clients: int = 20, seed: int = 0, rows: int = 60_000, val_frac: float = 0.1, test_frac: float = 0.2,
                 min_rows: int = 200) -> List[ClientData]:
    """``rows`` real impressions, split across ``n_clients`` simulated publisher clients (see the module docstring).

    ``seed`` changes which rows are drawn and how the publisher ids hash onto clients. Clients with fewer than ``min_rows``
    rows are merged into the smallest remaining clients so that every client can train and be evaluated.
    """
    if not CACHE.exists():
        raise FileNotFoundError("Criteo sample not prepared: run `python -m fedad.ml.criteo download` then `... prepare`")
    z = np.load(CACHE)
    rng = np.random.default_rng(seed)
    n_all = len(z["y"])
    pick = np.sort(rng.choice(n_all, size=min(rows, n_all), replace=False))
    y, num, bucket, part = z["y"][pick].astype(np.float64), z["num"][pick], z["bucket"][pick], z["part"][pick].astype(np.uint64)
    salt = np.uint64(int(rng.integers(1, 2 ** 31)))
    owner = ((part * np.uint64(2654435761) + salt) % np.uint64(2 ** 32) % np.uint64(n_clients)).astype(np.int64)
    sizes = np.bincount(owner, minlength=n_clients)
    for c in np.argsort(sizes):                                       # fold tiny clients into the smallest other client
        if sizes[c] and sizes[c] < min_rows:
            others = [o for o in np.argsort(sizes) if o != c and sizes[o] >= min_rows]
            if others:
                owner[owner == c] = others[0]
                sizes = np.bincount(owner, minlength=n_clients)
    clients = []
    for cid, c in enumerate(np.flatnonzero(sizes >= min_rows)):
        rs = np.flatnonzero(owner == c)
        rs = rs[rng.permutation(len(rs))]
        X = _dense(num[rs], bucket[rs])
        yy = y[rs]
        k_test, k_val = int(len(rs) * test_frac), int(len(rs) * val_frac)
        k = len(rs) - k_test - k_val
        clients.append(ClientData(cid, X[:k], yy[:k], X[k:k + k_val], yy[k:k + k_val], X[k + k_val:], yy[k + k_val:],
                                  synthetic=False))
    return clients


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "prepare"
    if cmd == "download":
        download()
    elif cmd == "prepare":
        prepare()
    elif cmd == "info":
        print(info())
    else:
        raise SystemExit("usage: python -m fedad.ml.criteo [download|prepare|info]")
