# backend

Standard federated layout: devices train locally, edge nodes screen and pre-aggregate, a cloud coordinator combines and
steps the global model.

```
src/fedad/
  ml/            data.py (SYNTHETIC generator, row layout), model.py (logistic CTR), encoder.py (conv + attention, PyTorch)
  privacy/       dp.py (clip, noise, calibration, budget split, accountant), secagg.py, he.py (Paillier)
  aggregation/   aggregate.py (weights), robust.py (anomaly score, multi-Krum), compress.py (wire format)
  federation/    pipeline.py (Client, Edge, sync simulation), async_runner.py, coordinator.py (service state machine)
  api/           server.py (HTTP), client.py (reference client for the app), __main__.py (run it)
  tuning/        bayes.py (GP + expected improvement), pul.py (epsilon tuning on validation data)
  demo.py        experiment table
tests/           34 tests, generated data only
```

## HTTP contract (for the Flutter app)

| Call | Body | Reply |
|---|---|---|
| `GET /v1/model` | | `version`, `weights[]`, `n_params`, `spec_hash`, `mode`, `policy{clip_c, top_k, dp, eps_per_upload, delta_per_upload, max_uploads, local_epochs, lr, batch}`, `prototype` |
| `POST /v1/updates` (`Authorization: Bearer <token>`) | `{base_version, n, loss_before, loss_after, blob}` (`blob` = base64 of `compress.encode(noised update)`) | `{accepted, version, model_stepped}`; 400 malformed, 401 token, 409 stale or duplicate, 413 too large, 429 upload budget used |
| `GET /v1/status` | | `version`, `buffered`, `buffer_k`, `mode`, `rounds_done` |

The client id comes from the token. The app must: fetch the model, train on its own impressions, clip to `clip_c`, add
Gaussian noise calibrated from `eps_per_upload` and `delta_per_upload` (`dp.calibrate_sigma`, sensitivity `2 * clip_c`),
optionally keep the top-k entries, encode, upload. `api/client.py` does exactly this and refuses a policy whose epsilon is
above its own ceiling. A Dart port of the noise and `compress.py` is NOT IMPLEMENTED.

The row layout the model expects (tabular features, then the behaviour history of ad-category ids) is documented at the top
of `ml/data.py`. Numeric features need fixed shared scaling constants, never per-device statistics.
