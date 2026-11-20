# FedAd

Federated, differentially private click-through-rate (CTR) prediction for digital advertising. A reference implementation
of Li, Lin, Zhang, *A Privacy-Preserving Framework for Advertising Personalization Incorporating Federated Learning and
Differential Privacy*, AIFM '25 (arXiv 2507.12098). **Prototype. Benchmarked on real Criteo click data with a simulated
federation, plus a live demo with real phones on a local network. Not a privacy or security product.** Separate from DataMend.

```
backend/    Python: federated runtime (Flower), privacy (DP, Renyi accounting, secret sharing, HE), experiments, FastAPI API, tests
frontend/   Ad admin console (React) and the phone app (a web page that is a real federated client)
docs/       seminar_guide.md (rubric map, viva questions), phone_demo.md (run it, demo script)
```

Two data sources, kept apart on purpose. **Benchmark:** a 300,000-impression sample of the Criteo click logs (real, anonymised,
CC BY-NC-SA 4.0), federated across 20 simulated publisher clients, for the accuracy and privacy measurements. **Live demo:** a phone
feed whose taps are your own, with a small feature set the phone can measure itself (Criteo's anonymised columns cannot be produced
on a phone). The synthetic generator (`ml/data.py`) remains only for fast offline unit tests; no result in this README uses it.

## Run

```
cd backend
pip install -e ".[all]"                 # core + Flower/Ray + FastAPI + matplotlib + PyTorch encoder + test extras
python -m fedad.ml.criteo download      # 47 MB, one Criteo day-part from Hugging Face (non-commercial licence)
python -m fedad.ml.criteo prepare       # hashes it into a compact sample under backend/data/ (not committed)
python -m pytest                        # fast tests (python -m pytest -m slow: Flower parity, starts Ray)
python -m fedad.experiments --flower    # 5-seed Criteo experiments, figures, CSV tables -> results/   (about 30 minutes)
cd ../frontend && npm install && npm run build      # both web pages -> frontend/dist
cd ../backend && python -m fedad.web --lan          # admin console http://localhost:8000, phones join via /phone.html (docs/phone_demo.md)
FEDAD_TOKENS="<token>:0,<token>:1" python -m fedad.api --port 8080     # HTTP coordinator for the device contract
python -m fedad.demo --deep             # older single-seed table -> results/demo.json
```

## Deploy on Render (backend and both web pages in one service)

1. Commit and push this repo to GitHub (the Criteo data stays out; `deploy/results/` ships the aggregate results the console shows).
2. Render: New, Blueprint, pick the repo. `render.yaml` and the `Dockerfile` do the rest (builds the React pages, runs FastAPI).
3. Sign-in: `render.yaml` sets two accounts (`platform`, `advertiser`) and makes Render generate their passwords (`FEDAD_ADMIN_PASSWORD`, `FEDAD_B_PASSWORD`; read them in the service's Environment tab, give the advertiser only theirs). `/login.html` signs in and sends each account to its console; the advertiser account can only reach the aggregate-only endpoints. Localhost needs no sign-in. (`FEDAD_OPEN_ADMIN=1` opens just the advertiser endpoints, for a login-free demo.)
4. Platform console: `https://<service>.onrender.com/`. Advertiser (Party B) console: `/advertiser.html`. Phone shop: `/phone.html`. Browser extension: `extension/` (`npm run build`, load `dist` unpacked in Chrome or Edge). Vertical FL (PSI plus split model): `backend/src/fedad/vertical/`, service in `web/vertical_api.py`.

Free instances sleep after idle time and lose all state on restart (campaign, accounts, model): wake it before the demo. The shop keeps
emails and passwords in memory: use throwaway ones. Benchmark runs (Criteo) are not available on the deployed service, only the saved results.

## Android app (`mobile/`)

A Flutter shell around the phone shop, signed with a release key. `cd mobile && flutter build apk --release` writes
`build/app/outputs/flutter-apk/app-release.apk`. First launch asks for the server address (the Render URL, or `192.168.x.x:8000` on
the same Wi-Fi); triple-tap the top-left corner to change it. Keep `mobile/android/app/perks-release.jks` and `key.properties`: they
are not committed, and a lost key means a new APK cannot update an installed one.

## Federated runtime: Flower, and what this repo adds to it

`fedad/flower_engine.py` runs the pipeline on **Flower 1.44** (ServerApp / ClientApp, Simulation Runtime on Ray). Flower
owns node sampling, messaging and the round lifecycle; FedAd supplies what happens inside a round: the `ClientApp` calls
`Client.make_upload` (local SGD, clip, Gaussian noise, top-k, encode) and the `Strategy` calls `Edge.aggregate` then
`Setup.combine` (plain, secret sharing or Paillier HE). Only the already noised, compressed blob crosses the Flower message
boundary. The same Client / Edge / Setup code also runs in a fast in-process loop (`engine="native"`) used for many-seed
sweeps; `python -m pytest -m slow` checks the two agree weight for weight. Flower's built-in DP wrappers are not used: they
implement server-side or fixed-clipping DP, a different threat model from this project's local DP.

## Tighter privacy accounting (Renyi DP)

`privacy/rdp.py` composes the T Gaussian releases with Renyi DP instead of summing epsilons. For the same noise it reports a
smaller total epsilon, and for a target total epsilon it needs less noise per round, so utility improves at the same
guarantee. It matches Google's `dp-accounting` library to about 0.1 percent (tested). Select it with `Config(accountant="rdp")`.
It claims no subsampling amplification: every client releases in every round it takes part in.

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
| 3.2 budget split (eqs. 5, 6) | `privacy/dp.py`, `privacy/rdp.py` | built (`paper` and `uniform`), per-client accountant: basic composition, or Renyi (RDP) accounting (addition beyond the paper) |
| 3.3 Privacy-Utility Loss (eq. 8) | `privacy/dp.py`, `tuning/pul.py` | built: grid search and Bayesian optimisation (`tuning/bayes.py`, GP + expected improvement) |
| 3.4 anomaly score (eq. 9), Krum | `aggregation/robust.py` | built (multi-Krum) |
| 4.1 client / edge / cloud | `federation/pipeline.py` | built |
| 4.2 sparsification, differential coding, entropy coding | `aggregation/compress.py` | built, two differences (index-gap coding, DEFLATE) |
| 4.3 client pruning, quantisation, edge scheduling | | NOT IMPLEMENTED (float16 wire values are the only quantisation) |
| 4.4 transport encryption | `api/server.py` | optional TLS on the server (`--certfile/--keyfile`); NOT tested against real certificates; key rotation NOT IMPLEMENTED |
| network layer | `api/` | built: stdlib HTTP service, bearer-token allowlist, size limits, per-client upload budget; persistence NOT IMPLEMENTED |
| federated runtime | `flower_engine.py` | built: Flower 1.44 simulation (Ray), parity-tested against the native engine; real multi-machine Flower deployment NOT IMPLEMENTED |
| experiments, figures | `experiments.py`, `figures.py` | built: multi-seed runs with 95 percent CIs, report figures and CSV tables |
| dashboard | `web/app.py`, `../frontend/` | built: FastAPI (runs, SSE stream, results, calibrator) and React; no authentication, localhost only |

The paper's equation (6) is read from the PDF; its worked example (eq. 7) prints 0.012 by dividing by 10000 x 1.0 although
the sum includes the 1.2 client. The correct value is 0.01176 (tested).

## Measured on real Criteo data (20 simulated clients, 15 rounds, 60,000 impressions per run, 5 seeds, mean and 95 percent CI)

AUC on held-out test impressions; click rate 3.2 percent; logistic model, 430 parameters. Full tables:
`backend/results/tables/*.csv`, figures: `backend/results/figures/*.png` (regenerate with `python -m fedad.experiments`).

| Experiment | AUC |
|---|---|
| Centralised: all raw impressions pooled (scikit-learn logistic regression) | 0.689 +/- 0.019 |
| Federated, no privacy noise (FedAvg; weighted, secret sharing and Paillier HE give the identical number) | 0.693 +/- 0.014 |
| Top-50 sparsification (0.834 to 0.189 KB per upload, 4.4x smaller) | 0.685 +/- 0.016 |
| Asynchronous buffered (K=4) | 0.649 +/- 0.023 |
| Local DP, total epsilon 10 000: basic / RDP accounting | 0.685 / 0.687 |
| Local DP, total epsilon 1 000: basic / RDP accounting | 0.628 / 0.647 (paired gain 0.019 +/- 0.003) |
| Local DP, total epsilon 300: basic / RDP accounting | 0.572 / 0.601 (paired gain 0.029 +/- 0.003) |
| Local DP, total epsilon 100: basic / RDP accounting | 0.541 / 0.563 (paired gain 0.022 +/- 0.004) |
| Flower engine vs native engine (2 configs, seed 0) | identical weights (max abs difference 0.0) |

Reading it. Without noise, federated training matched pooling the raw data (0.693 vs 0.689, within noise; the centralised
model is a plain regularised regression, not a tuned ceiling). Differential privacy is what costs accuracy, and on real CTR
data it costs a lot: a useful AUC needs total epsilon in the thousands, a weak formal guarantee. The Renyi accountant needs
0.49 times the noise of basic composition at epsilon 100 (0.75 at 1 000) for the same guarantee, a small but consistent
paired AUC gain; basic accounting at epsilon 10 000 is, in Renyi terms, only epsilon 8 282, so the sum was a loose bound.
Attacker and defence experiments are not part of this suite.

## Honest limits

- **The paper's results are not reproduced.** Its tables (MNIST on 10 clients, ad-attack defence rates, a 58 percent
  communication saving) have no data or code behind them in the text. Treat them as claims. Weighted FedAvg does not beat
  FedAvg here.
- **Privacy.** The only formal guarantee is a per-client (epsilon, delta) for the noised update, under local DP with basic or
  Renyi composition and no subsampling amplification. It does not cover the impression count and loss values clients report
  alongside, who participates, or a user across several installs. On real data a useful epsilon is in the thousands.
- **Criteo is a simulated federation.** It has no user or publisher ids; clients come from hashing one anonymised column
  (documented in `ml/criteo.py`). One day-part of 24, subsampled by Criteo, so absolute AUCs are not a forecast for an ad system.
- **Phone demo.** A web page on plain HTTP over a LAN; a token can be sniffed on shared Wi-Fi; one phone gives a noisy model
  (that is the demo of the trade-off); the UI was exercised in headless Edge with a phone viewport, not on a physical phone.
- **Trust.** Anomaly filtering and Krum need individual updates, which secret sharing and HE hide, so edge nodes see their
  clients' noised updates and are trusted. Secret sharing protects against fewer than k colluding servers; Paillier only
  if the aggregator and the key holder do not collude. Neither stops a client sending a bad update.
- **HE size.** `he_bits=512` is for tests and NOT SECURE; use 2048 or more, and expect it to be slow for the encoder.
- **Service.** Static token allowlist (a stolen token allows impersonation), no attestation, in-memory state, plain HTTP
  unless TLS is configured. Do not expose it beyond localhost as is.
- **Eq. (9) sign.** The paper writes `+ l2 cos(...)`; the default `l2` is negative so a high score means anomalous.
- **PUL.** alpha and beta are the operator's preference, not learned; the tuner optimises epsilon, validated on the
  validation split, with the test split scored once.
- **Metrics.** AUC and log loss, not accuracy. Five seeds with 95 percent intervals; the interval is wide because each seed
  redraws the impressions and the client split, so compare configurations by their paired differences.
