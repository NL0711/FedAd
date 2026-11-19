# frontend

The Flutter app lives here (to be created by the project owner: `flutter create .` in this folder).

It is the **client** of the federated system. Contract with `../backend`:

- Fetch the current global model: `GET /v1/model` (version, weights, model spec hash).
- Train locally on the device's own impressions; nothing but the clipped, noised, compressed update leaves the device.
- Upload: `POST /v1/updates` with the blob produced the same way as `backend/src/fedad/federation/pipeline.py: Client.make_upload`.
- The feature layout and its fixed scaling constants are in `backend/src/fedad/ml/data.py` (`feature_names()`).

See `../backend/README.md` for the endpoints and the privacy limits the app UI must not overstate.

**NOT IMPLEMENTED:** the app itself, on-device training in Dart, and a Dart port of `compress.py` and the noise step.
