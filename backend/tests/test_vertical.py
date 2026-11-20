import numpy as np

from fedad.ml.model import auc
from fedad.vertical import psi, split


def test_psi_finds_exactly_the_overlap_and_aligns_rows():
    a = [f"user{i}@x.com" for i in range(0, 40)]
    b = [f"user{i}@x.com" for i in range(25, 70)][::-1]            # different order and size
    ia, ib = psi.run(a, b)
    assert len(ia) == len(ib) == 15
    assert [a[i] for i in ia] == [b[j] for j in ib]                # aligned pairwise
    assert {a[i] for i in ia} == {f"user{i}@x.com" for i in range(25, 40)}


def test_psi_is_case_insensitive_and_handles_empty_overlap():
    assert len(psi.run(["A@x.com"], ["a@x.com"])[0]) == 1
    assert psi.run(["a@x.com"], ["b@x.com"]) == ([], [])


def test_psi_rejects_non_group_elements():
    p = psi.Party(["a"])
    bad = next(x for x in range(3, 100) if pow(x, psi.Q, psi.P) != 1)      # a quadratic non-residue
    try:
        p.blind_other([bad])
    except ValueError:
        return
    raise AssertionError("accepted a non-subgroup value")


def _data(n=600, seed=1):
    r = np.random.default_rng(seed)
    Xa = r.normal(size=(n, 6))
    Xb = r.normal(size=(n, 2))
    z = 1.6 * Xa[:, 0] - 1.2 * Xa[:, 1] + 0.8 * Xb[:, 0]
    y = (r.random(n) < 1 / (1 + np.exp(-z))).astype(float)
    return Xa, Xb, y


def test_vertical_beats_either_party_alone_and_noise_costs_accuracy():
    Xa, Xb, y = _data()
    both = split.train(Xa, Xb, y, split.VConfig(epochs=40, seed=0))["test_auc"]
    b_only = split.train(np.zeros((len(y), 1)), Xb, y, split.VConfig(epochs=40, seed=0))["test_auc"]
    noisy = split.train(Xa, Xb, y, split.VConfig(epochs=40, seed=0, sigma_e=3.0, sigma_g=3.0))["test_auc"]
    assert both > b_only + 0.05                                    # A's columns add real signal
    assert noisy < both                                            # privacy has a price
    assert both > 0.7


def test_privacy_report():
    p = split.privacy_spent(split.VConfig(sigma_e=2.0, sigma_g=2.0, epochs=10))
    assert p["eps_embedding"] > 0 and p["eps_total"] > p["eps_gradient"]
    assert split.privacy_spent(split.VConfig())["eps_total"] is None
