"""The phone app's TypeScript (frontend/src/phone/*.ts) must agree with the Python backend, bit for bit where it matters:
the wire format, the local training step and the privacy accounting. Runs the real TS through Node (skipped if absent)."""

import base64
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from fedad.aggregation import compress
from fedad.ml.model import Model
from fedad.privacy import rdp

NODE = shutil.which("node")
SCRIPT = Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "phone_parity.mjs"
pytestmark = pytest.mark.skipif(NODE is None or not SCRIPT.exists(), reason="node or the phone app is not available")


class _ScriptedRng:
    def __init__(self, perms):
        self.perms, self.i = perms, 0

    def permutation(self, n):
        p = np.array(self.perms[self.i])
        self.i += 1
        return p


@pytest.fixture(scope="module")
def js(tmp_path_factory):
    rng = np.random.default_rng(7)
    dense = rng.normal(0, 0.4, 32)
    sparse = np.zeros(32)
    sparse[[3, 9, 30]] = [0.5, -1.25, 3e-6]
    edge = np.array([0.0, 65504.0, 70000.0, -1e-9, 6.1e-5, 5.96e-8, 2.98e-8, 1.0004882812, 0.1, -0.1, 1e5, 1e-300])
    cases = {"encode": [dense.tolist(), sparse.tolist(), edge.tolist(), np.zeros(5).tolist(), rng.normal(0, 1, 70000).tolist()]}
    n, f = 37, 6
    X = rng.normal(0, 1, (n, f))
    y = (rng.random(n) < 0.4).astype(float)
    w = rng.normal(0, 0.2, f + 1)
    perms = [rng.permutation(n).tolist() for _ in range(3)]
    cases["train"] = {"X": X.tolist(), "y": y.tolist(), "w": w.tolist(), "epochs": 3, "lr": 0.2, "batch": 8, "perms": perms}
    cases["rdp"] = [[2.0, 2.0, 20, 1e-5], [0.5, 2.0, 1, 5e-7], [10.0, 2.0, 7, 1e-5], [0.05, 2.0, 3, 1e-6]]
    d = tmp_path_factory.mktemp("parity")
    f_in = d / "cases.json"
    f_in.write_text(json.dumps(cases))
    out = subprocess.run([NODE, str(SCRIPT), str(f_in)], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return cases, json.loads(out.stdout), (X, y, w, perms)


def test_encode_is_decodable_and_matches_python_float16(js):
    cases, out, _ = js
    for vec, b64 in zip(cases["encode"], out["encode"]):
        v = np.array(vec)
        got = compress.decode(base64.b64decode(b64))             # Python's zlib must accept the stored-block stream
        want = np.zeros(v.size)
        nz = np.flatnonzero(v)
        want[nz] = v[nz].astype(np.float16).astype(np.float64)
        with np.errstate(over="ignore"):
            np.testing.assert_array_equal(got, want)


def test_local_training_matches_python_model(js):
    cases, out, (X, y, w, perms) = js
    t = cases["train"]
    delta, before, after = Model(X.shape[1]).local_train(w, X, y, t["epochs"], t["lr"], t["batch"], _ScriptedRng(perms))
    np.testing.assert_allclose(out["train"]["delta"], delta, atol=1e-9)
    assert out["train"]["before"] == pytest.approx(before, abs=1e-12)
    assert out["train"]["after"] == pytest.approx(after, abs=1e-12)


def test_rdp_epsilon_matches_python(js):
    cases, out, _ = js
    for (sigma, sens, releases, delta), eps in zip(cases["rdp"], out["rdp"]):
        assert eps == pytest.approx(rdp.eps_after(sigma, sens, releases, delta), abs=1e-6)
