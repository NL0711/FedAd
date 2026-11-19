"""Criteo loader: hermetic checks on a tiny fabricated parquet in the real schema, plus checks on the real sample if present."""

import numpy as np
import pytest

pa = pytest.importorskip("pyarrow")
import pyarrow.parquet as pq  # noqa: E402

from fedad.federation.pipeline import Config, run  # noqa: E402
from fedad.ml import criteo  # noqa: E402


@pytest.fixture()
def tiny_cache(tmp_path, monkeypatch):
    rng = np.random.default_rng(0)
    n = 4000
    cols = {"label": (rng.random(n) < 0.05).astype("int32")}
    for j in range(1, 14):
        v = rng.integers(0, 500, n).astype("float64")
        v[rng.random(n) < 0.1] = np.nan                                     # missing values
        cols[f"integer_feature_{j}"] = pa.array(np.where(np.isnan(v), None, v), type=pa.int32())
    for j in range(1, 27):
        card = 800 if j == 5 else 40
        vals = [f"{x:08x}" if rng.random() > 0.05 else None for x in rng.integers(0, card, n)]
        cols[f"categorical_feature_{j}"] = pa.array(vals, type=pa.string())
    pq.write_table(pa.table(cols), tmp_path / "tiny.parquet")
    cache = tmp_path / "tiny.npz"
    info = criteo.prepare(tmp_path / "tiny.parquet", cache, rows=3000, seed=1)
    monkeypatch.setattr(criteo, "CACHE", cache)
    return info


def test_prepare_picks_the_partition_column_closest_to_1000(tiny_cache):
    assert tiny_cache["partition_column"] == 5 and tiny_cache["rows"] == 3000


def test_clients_have_the_documented_layout(tiny_cache):
    cl = criteo.make_clients(n_clients=4, seed=0, rows=2500, min_rows=50)
    assert 2 <= len(cl) <= 4
    for c in cl:
        assert c.X.shape[1] == criteo.N_FEATURES and c.synthetic is False
        num, cat = c.X[:, :criteo.N_NUMERIC], c.X[:, criteo.N_NUMERIC:]
        assert num.min() >= 0 and num.max() <= criteo.NUM_CLAMP
        per_field = cat.reshape(len(c.X), criteo.N_CAT, criteo.BUCKETS).sum(2)
        assert per_field.max() <= 1.0                                      # at most one bucket per categorical field
        assert len(c.X) + len(c.X_val) + len(c.X_test) >= 50
    total = sum(len(c.y) + len(c.y_val) + len(c.y_test) for c in cl)
    assert total == 2500                                                    # every drawn impression lands on a client


def test_seed_changes_rows_and_assignment_but_is_reproducible(tiny_cache):
    a = criteo.make_clients(n_clients=4, seed=0, rows=2500, min_rows=50)
    b = criteo.make_clients(n_clients=4, seed=0, rows=2500, min_rows=50)
    c = criteo.make_clients(n_clients=4, seed=1, rows=2500, min_rows=50)
    assert all(np.array_equal(x.X, y.X) for x, y in zip(a, b))
    assert [x.n for x in a] != [x.n for x in c]


def test_federated_run_on_criteo_format_data(tiny_cache):
    cl = criteo.make_clients(n_clients=4, seed=0, rows=2500, min_rows=50)
    r = run(cl, Config(rounds=3, seed=0, dp=True, eps_total=5000.0, accountant="rdp"), criteo.N_FEATURES)
    assert len(r.history) == 3 and 0.0 <= r.history[-1]["auc"] <= 1.0


@pytest.mark.skipif(not criteo.available(), reason="real Criteo sample not prepared")
def test_real_sample_is_realistic():
    z = criteo.info()
    assert z["synthetic"] is False and 0.01 < z["click_rate"] < 0.1 and z["n_features"] == criteo.N_FEATURES
    cl = criteo.make_clients(n_clients=10, seed=0, rows=20_000)
    assert len(cl) >= 5 and sum(c.n for c in cl) > 10_000
