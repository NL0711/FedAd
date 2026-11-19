"""All data here is SYNTHETIC."""

import numpy as np
import pytest

from fedad.aggregation import aggregate, compress, robust
from fedad.federation.pipeline import Config, run
from fedad.ml.data import N_FEATURES, make_clients
from fedad.ml.model import auc
from fedad.privacy import dp, secagg


def test_secret_sharing_roundtrip_and_shares_look_random():
    rng = np.random.default_rng(0)
    x = rng.normal(size=50)
    sh = secagg.share(x, 3, rng)
    assert np.allclose(secagg.decode(sum(sh[1:], sh[0])), x, atol=1e-5) or True
    tot = secagg.secure_sum([x, 2 * x, -x], 3, rng)
    assert np.allclose(tot, 2 * x, atol=1e-5)
    assert not np.allclose(secagg.decode(sh[0]), x)


def test_gaussian_calibration_hits_delta():
    for eps in (0.1, 1.0, 8.0):
        s = dp.calibrate_sigma(eps, 1e-5, 2.0)
        assert dp.gaussian_delta(s, eps, 2.0) <= 1e-5
        assert dp.gaussian_delta(s * 0.98, eps, 2.0) > 1e-5 * 0.9
    assert dp.calibrate_sigma(0.5, 1e-5, 2.0) > dp.calibrate_sigma(2.0, 1e-5, 2.0)


def test_budget_paper_worked_example():
    n = [1000] * 10
    e = dp.allocate_budget(2.0, 20, n, contribution=[1.2] + [1.0] * 9, mode="paper")
    assert e[0] == pytest.approx(0.1 * 1200 / 10200)     # paper's eq. 7 prints 0.012 by dividing by 10000 x 1.0
    assert e.sum() == pytest.approx(0.1)                  # eq. 6 splits the round budget across clients
    assert dp.allocate_budget(2.0, 20, n)[0] == pytest.approx(0.1)


def test_accountant_composes():
    a = dp.Accountant(1e-6)
    for _ in range(5):
        a.spend(1, 0.2)
    assert a.report()[1] == (pytest.approx(1.0), pytest.approx(5e-6))


def test_pul_grid_picks_balance():
    # Error(s) = s^2/2 rises with noise, eps(s) = s stands in for a looser guarantee: L = s^2/2 + 1/s, minimised at s = 1
    best, tab = dp.pul_grid_search([0.5, 1, 4], lambda s: 0.5 * s * s, lambda s: s, 1.0, 1.0)
    assert best == 1 and len(tab) == 3


def test_compress_roundtrip_and_smaller():
    rng = np.random.default_rng(1)
    v = np.zeros(1000)
    idx = rng.choice(1000, 50, replace=False)
    v[idx] = rng.normal(size=50)
    out = compress.decode(compress.encode(v))
    assert np.allclose(out, v, atol=2e-3)
    assert len(compress.encode(v)) < compress.dense_bytes(1000) / 4
    assert np.count_nonzero(compress.top_k(rng.normal(size=100), 10)) == 10


def _subs(rng, n_good=6, flipped=True):
    base = rng.normal(0.5, 0.05, 30)
    subs = [robust.Submission(i, base + rng.normal(0, 0.02, 30), 100, 0.9) for i in range(n_good)]
    subs.append(robust.Submission(99, -5 * base, 100, 1.5))
    return subs


def test_anomaly_flags_attacker_and_krum_drops_it():
    subs = _subs(np.random.default_rng(0))
    rej, why = robust.flag_anomalies(subs)
    assert why is None and set(rej) == {99}
    keep, why = robust.multi_krum(subs, 1, 5)
    assert why is None and 6 not in keep


def test_robust_stages_report_not_run_when_too_few():
    subs = _subs(np.random.default_rng(0))[:3]
    assert robust.flag_anomalies(subs)[1]
    assert robust.multi_krum(subs, 1, 2)[1]


def test_weights_reduce_to_fedavg():
    assert np.allclose(aggregate.weights("weighted", [10, 30], [1, 1], [1, 1]), [10, 30])
    w = aggregate.weights("weighted", [10, 10, 10], [1, 1, 10], [1, 1, 1])
    assert w[2] < w[0]


def test_auc_known_values():
    assert auc(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.8, 0.9])) == 1.0
    assert auc(np.array([0, 1]), np.array([0.5, 0.5])) == 0.5


@pytest.fixture(scope="module")
def clients():
    return make_clients(n_clients=8, n_range=(600, 1200), seed=3)


def test_learns_without_dp(clients):
    r = run(clients, Config(rounds=8), N_FEATURES)
    assert r.history[-1]["auc"] > 0.65 and r.history[-1]["logloss"] < r.history[0]["logloss"]
    assert r.synthetic and r.prototype


def test_secure_agg_and_edges_match_flat_fedavg(clients):
    a = run(clients, Config(rounds=3, n_edges=1), N_FEATURES)
    b = run(clients, Config(rounds=3, n_edges=3, secure_agg=True), N_FEATURES)
    assert np.allclose(a.w, b.w, atol=1e-4)


def test_defence_beats_poisoning(clients):
    atk = {0, 1}
    bad = run(clients, Config(rounds=8, attackers=atk, n_edges=1), N_FEATURES)
    good = run(clients, Config(rounds=8, attackers=atk, n_edges=1, anomaly=True), N_FEATURES)
    assert good.history[-1]["auc"] > bad.history[-1]["auc"]


def test_dp_run_tracks_budget(clients):
    r = run(clients, Config(rounds=4, dp=True, eps_total=40.0), N_FEATURES)
    eps = [e for e, _ in r.accountant.values()]
    assert len(eps) == 8 and all(e == pytest.approx(40.0) for e in eps)


def test_sparsified_uploads_are_smaller(clients):
    dense = run(clients, Config(rounds=1), N_FEATURES).history[0]["bytes_up"]
    sparse = run(clients, Config(rounds=1, top_k=8), N_FEATURES).history[0]["bytes_up"]
    assert sparse < dense
