"""Run the coordinator: ``FEDAD_TOKENS="tokA:0,tokB:1" python -m fedad.api --port 8080``.

Tokens come from the environment only (never a tracked file, never logged). Generate them with
``python -c "import secrets; print(secrets.token_urlsafe(32))"``. Plain HTTP unless --certfile/--keyfile are given;
do not expose plain HTTP beyond localhost. Prototype: in-memory state, a restart loses the model.
"""

from __future__ import annotations

import argparse
import os
import sys

from ..federation.coordinator import Coordinator
from ..federation.pipeline import Config
from ..ml.data import N_FEATURES
from ..ml.model import Model
from .server import make_server


def parse_tokens(s: str) -> dict:
    out = {}
    for pair in s.split(","):
        tok, _, cid = pair.partition(":")
        if len(tok) < 16 or not cid.isdigit():
            raise SystemExit("FEDAD_TOKENS entries must be <token of >= 16 chars>:<client id>")
        out[tok] = int(cid)
    return out


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="fedad.api")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--mode", choices=["sync", "async"], default="sync")
    p.add_argument("--buffer-k", type=int, default=3)
    p.add_argument("--rounds", type=int, default=20, help="max uploads per client (the privacy budget is split over them)")
    p.add_argument("--model", choices=["logistic", "seq"], default="logistic")
    p.add_argument("--dp", action="store_true")
    p.add_argument("--eps-total", type=float, default=2.0)
    p.add_argument("--secure-agg", action="store_true")
    p.add_argument("--he", action="store_true")
    p.add_argument("--he-bits", type=int, default=2048)
    p.add_argument("--anomaly", action="store_true")
    p.add_argument("--certfile")
    p.add_argument("--keyfile")
    a = p.parse_args(argv)
    raw = os.environ.get("FEDAD_TOKENS")
    if not raw:
        raise SystemExit("set FEDAD_TOKENS (see --help); refusing to start without client tokens")
    if a.model == "seq":
        from ..ml.encoder import SeqModel
        model, spec = SeqModel(), "seq-ctr-v1"
    else:
        model, spec = Model(N_FEATURES), "logistic-ctr-v1"
    cfg = Config(rounds=a.rounds, dp=a.dp, eps_total=a.eps_total, secure_agg=a.secure_agg, he=a.he, he_bits=a.he_bits,
                 anomaly=a.anomaly)
    srv = make_server(Coordinator(cfg, model.init(), spec, a.buffer_k, a.mode), parse_tokens(raw), a.host, a.port,
                      a.certfile, a.keyfile)
    scheme = "https" if a.certfile else "http"
    print(f"FedAd coordinator (PROTOTYPE) on {scheme}://{a.host}:{srv.server_address[1]}  mode={a.mode} model={spec}",
          file=sys.stderr)
    srv.serve_forever()


if __name__ == "__main__":
    main()
