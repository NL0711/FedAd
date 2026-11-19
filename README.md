# FedAd

Federated, differentially private click-through-rate (CTR) prediction for digital advertising. A reference implementation
of Li, Lin, Zhang, *A Privacy-Preserving Framework for Advertising Personalization Incorporating Federated Learning and
Differential Privacy*, AIFM '25 (arXiv 2507.12098). **Prototype. Simulation plus a localhost HTTP service. Synthetic data
only. Not a privacy or security product.** Separate from DataMend.

```
backend/    Python: federated coordinator, privacy, aggregation, simulation, HTTP API, tests   (see backend/README.md)
frontend/   Flutter app (to be built; contract in frontend/README.md)
```

## Run

```
cd backend
pip install -e ".[dev]"           # add ,deep for the PyTorch encoder
python -m pytest                  # 34 tests, synthetic data
python -m fedad.demo --deep       # experiment table -> results/demo.json
FEDAD_TOKENS="<token>:0,<token>:1" python -m fedad.api --port 8080     # coordinator
```

## What is built, per paper section

| Paper | Where (`backend/src/fedad/`) | Status |
|---|---|---|
| 2.1 horizontal FL, FedAvg | `federation/pipeline.py` | built |
| 2.1 asynchronous updates | `federation/async_runner.py`, `coordinator.py` | built: buffered async with staleness discount, virtual clock in simulation, real async mode in the service |
| 2.2 conv + attention encoder (eq. 1) | `ml/encoder.py` | built (PyTorch): 2 conv layers over the behaviour history, attention keyed by the shown ad. Layer sizes `assumed` |
| 2.3 additive secret sharing (eq. 2) | `privacy/secagg.py` | built, simulated, k servers, mod 2^64 fixed point |
| 2.3 homomorphic encryption | `privacy/he.py` | built: Paillier with slot packing, separate key-holder and aggregator roles. Pure Python, small models only |
| 2.3 HE and secret sharing combined | | NOT IMPLEMENTED as one layered protocol; they are alternatives (`he` or `secure_agg`) |
| 2.4 weighted aggregation (eq. 3) | `aggregation/aggregate.py` | built; the paper gives no weight formula, ours is `n_i * h_i * m_i` |
| 3.1 Gaussian noise (eq. 4) | `privacy/dp.py` | built; analytic Gaussian calibration, clip bound C, sensitivity 2C |
| 3.2 budget split (eqs. 5, 6) | `privacy/dp.py` | built (`paper` and `uniform`), per-client accountant (basic composition) |
| 3.3 Privacy-Utility Loss (eq. 8) | `privacy/dp.py`, `tuning/pul.py` | built: grid search and Bayesian optimisation (`tuning/bayes.py`, GP + expected improvement) |
| 3.4 anomaly score (eq. 9), Krum | `aggregation/robust.py` | built (multi-Krum) |
| 4.1 client / edge / cloud | `federation/pipeline.py` | built |
| 4.2 sparsification, differential coding, entropy coding | `aggregation/compress.py` | built, two differences (index-gap coding, DEFLATE) |
| 4.3 client pruning, quantisation, edge scheduling | | NOT IMPLEMENTED (float16 wire values are the only quantisation) |
| 4.4 transport encryption | `api/server.py` | optional TLS on the server (`--certfile/--keyfile`); NOT tested against real certificates; key rotation NOT IMPLEMENTED |
| network layer | `api/` | built: stdlib HTTP service, bearer-token allowlist, size limits, per-client upload budget; persistence NOT IMPLEMENTED |

The paper's equation (6) is read from the PDF; its worked example (eq. 7) prints 0.012 by dividing by 10000 x 1.0 although
the sum includes the 1.2 client. The correct value is 0.01176 (tested).

## Measured on synthetic data (10 clients, 20 rounds, one seed; AUC on held-out test impressions)

| Experiment | AUC |
|---|---|
| FedAvg / weighted / secret sharing / Paillier HE | 0.827 (all four equal: they must be) |
| Async buffered (K=4) | 0.806 |
| Local DP, total epsilon 1000 / 100 | 0.819 / 0.678 |
| 2 sign-flip attackers, no defence / anomaly filter | 0.483 / 0.834 |
| Encoder vs logistic, same schedule (12 rounds) | 0.867 vs 0.827 |
| PUL-tuned epsilon (alpha 1, beta 100) | chose 5000, the upper bound of the search: at these weights utility dominates |

## Honest limits

- **The paper's results are not reproduced.** Its tables (MNIST on 10 clients, ad-attack defence rates, a 58 percent
  communication saving) have no data or code behind them in the text. Treat them as claims. Weighted FedAvg does not beat
  FedAvg here.
- **Privacy.** The only formal guarantee is a per-client (epsilon, delta) for the noised update, under local DP and basic
  composition. It does not cover the loss values clients report for the anomaly score, who participates, or a user across
  several installs. With few clients a useful epsilon is in the hundreds, which is a weak guarantee.
- **Trust.** Anomaly filtering and Krum need individual updates, which secret sharing and HE hide, so edge nodes see their
  clients' noised updates and are trusted. Secret sharing protects against fewer than k colluding servers; Paillier only
  if the aggregator and the key holder do not collude. Neither stops a client sending a bad update.
- **HE size.** `he_bits=512` is for tests and NOT SECURE; use 2048 or more, and expect it to be slow for the encoder.
- **Service.** Static token allowlist (a stolen token allows impersonation), no attestation, in-memory state, plain HTTP
  unless TLS is configured. Do not expose it beyond localhost as is.
- **Eq. (9) sign.** The paper writes `+ l2 cos(...)`; the default `l2` is negative so a high score means anomalous.
- **PUL.** alpha and beta are the operator's preference, not learned; the tuner optimises epsilon, validated on the
  validation split, with the test split scored once.
- **Metrics.** AUC and log loss, not accuracy. Single seed.
