"""Encoder, HE, async, Bayesian tuning. All data SYNTHETIC."""

import numpy as np
import pytest

from fedad.federation.async_runner import run_async
from fedad.federation.pipeline import Config, run
from fedad.ml.data import HIST_LEN, N_FEATURES, make_clients
from fedad.ml.model import Model, auc
from fedad.privacy import he
from fedad.tuning.bayes import bayes_opt
from fedad.tuning.pul import tune_epsilon


@pytest.fixture(scope="module")
def clients():
    return make_clients(n_clients=8, n_range=(600, 1000), seed=3)


# ---- data
def test_rows_have_history_and_splits(clients):
    c = clients[0]
    assert c.X.shape[1] == N_FEATURES + HIST_LEN and len(c.y_val) > 0 and len(c.y_test) > 0
    h = c.X[:, N_FEATURES:]
    assert h.min() >= 0 and h.max() <= 8 and (h > 0).any()


# ---- encoder (needs torch)
def test_encoder_flat_params_and_learns(clients):
    torch = pytest.importorskip("torch")
    from fedad.ml.encoder import SeqModel
    m = SeqModel()
    w0 = m.init()
    assert w0.shape == (m.n_params,) and np.allclose(w0, SeqModel().init())     # same seed, same init for every client
    X = np.vstack([c.X for c in clients])
    y = np.concatenate([c.y for c in clients])
    p = m.predict(w0, X)
    assert p.shape == (len(y),) and p.min() > 0 and p.max() < 1
    d, before, after = m.local_train(w0, X, y, 5, 0.3, 32, np.random.default_rng(0))
    assert after < before and d.shape == w0.shape


def test_encoder_uses_history_beats_tabular_only(clients):
    pytest.importorskip("torch")
    from fedad.ml.encoder import SeqModel
    X = np.vstack([c.X for c in clients]); y = np.concatenate([c.y for c in clients])
    Xt = np.vstack([c.X_test for c in clients]); yt = np.concatenate([c.y_test for c in clients])
    rng = np.random.default_rng(0)
    seq = SeqModel()
    d, _, _ = seq.local_train(seq.init(), X, y, 10, 0.3, 32, rng)
    lm = Model(N_FEATURES)
    w, _, _ = lm.local_train(lm.init(), X, y, 10, 0.3, 32, rng)
    assert auc(yt, seq.predict(seq.init() + d, Xt)) > auc(yt, lm.predict(w, Xt)) + 0.01


def test_encoder_runs_in_federation(clients):
    pytest.importorskip("torch")
    from fedad.ml.encoder import SeqModel
    r = run(clients[:4], Config(rounds=2, lr=0.3, batch=64), N_FEATURES, model=SeqModel())
    assert r.history[-1]["logloss"] < r.history[0]["logloss"] + 0.2 and r.w.size > N_FEATURES + 1


# ---- homomorphic encryption
@pytest.fixture(scope="module")
def holder():
    return he.KeyHolder(512)    # NOT SECURE size, test only


def test_he_sum_roundtrip_with_negatives_and_many_slots(holder):
    rng = np.random.default_rng(0)
    vs = [rng.normal(0, 50, size=60) for _ in range(4)]      # 60 values > slots per ciphertext
    assert holder.pub.slots < 60
    assert np.allclose(he.he_sum(vs, holder), np.sum(vs, axis=0), atol=1e-3)


def test_he_ciphertexts_are_randomised_and_out_of_range_raises(holder):
    v = np.array([1.0, 2.0])
    assert he.encrypt_vector(holder.pub, v) != he.encrypt_vector(holder.pub, v)
    with pytest.raises(ValueError):
        he.encrypt_vector(holder.pub, np.array([1e9]))


def test_he_pipeline_matches_plain(clients):
    plain = run(clients, Config(rounds=2), N_FEATURES)
    enc = run(clients, Config(rounds=2, he=True, he_bits=512), N_FEATURES)
    assert np.allclose(plain.w, enc.w, atol=1e-3)


def test_he_and_secret_sharing_are_exclusive(clients):
    with pytest.raises(ValueError):
        run(clients, Config(rounds=1, he=True, secure_agg=True, he_bits=512), N_FEATURES)


# ---- asynchronous
def test_async_learns_and_sees_staleness(clients):
    r = run_async(clients, Config(rounds=5), N_FEATURES, buffer_k=3)
    assert r.history[-1]["auc"] > 0.65
    assert max(h["staleness_max"] for h in r.history) >= 1
    assert all(h["n_updates"] <= 3 for h in r.history)


def test_async_client_stops_at_budget(clients):
    cfg = Config(rounds=4, dp=True, eps_total=400.0)
    r = run_async(clients, cfg, N_FEATURES, buffer_k=3)
    eps = [e for e, _ in r.accountant.values()]
    assert len(eps) == len(clients) and max(eps) <= 400.0 + 1e-9


def test_async_staleness_discount_reduces_weight(clients):
    # a larger staleness exponent must change the model (stale updates count less); a_i = 0 reproduces no discount
    a = run_async(clients, Config(rounds=3, staleness_a=0.0), N_FEATURES, buffer_k=3)
    b = run_async(clients, Config(rounds=3, staleness_a=2.0), N_FEATURES, buffer_k=3)
    assert not np.allclose(a.w, b.w)


# ---- Bayesian optimisation
def test_bayes_opt_finds_minimum():
    res = bayes_opt(lambda x: (x[0] - 0.3) ** 2, [(0.0, 1.0)], n_init=4, n_iter=14, seed=1)
    assert abs(res.x_best[0] - 0.3) < 0.08 and len(res.ys) == 18


def test_bayes_opt_log_dimension_and_beats_random_start():
    f = lambda x: (np.log10(x[0]) - 2.0) ** 2        # minimum at 100 on [1, 10000]
    res = bayes_opt(f, [(1.0, 10000.0)], n_init=4, n_iter=14, log=[0], seed=0)
    assert 50 < res.x_best[0] < 200 and res.y_best <= min(res.ys[:4])


def test_tune_epsilon_returns_budget_in_bounds_and_uses_validation(clients):
    cfg, res = tune_epsilon(clients[:4], Config(rounds=3), N_FEATURES, alpha=1.0, beta=50.0,
                            eps_bounds=(50.0, 2000.0), n_init=2, n_iter=2)
    assert cfg.dp and 50.0 <= cfg.eps_total <= 2000.0 and len(res.ys) == 4
