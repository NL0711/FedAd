# frontend

Two web pages, one build (Vite + TypeScript):

- **Ad admin console** (`index.html`, React + Recharts): the laptop side. Campaign, Insights and Benefit for the ad admin, plus the research views.
- **Phone app** (`phone.html`, plain TypeScript, about 10 kB gzipped): a real federated client that runs in the phone's browser. See `src/phone/README.md`.

A native Flutter client is not built; the phone page replaces it for the demo (web view instead of a store app).

```
# terminal 1: API (needs the backend venv: pip install -e ".[all]")
cd backend && python -m fedad.ml.criteo download && python -m fedad.ml.criteo prepare     # once, real Criteo sample
cd backend && python -m fedad.experiments --flower                                          # once, about 30 min: results/
cd backend && python -m fedad.web --lan        # --lan lets a phone on the same Wi-Fi join; admin stays localhost-only

# build once; the API then serves both pages: http://localhost:8000/  and  /phone.html
cd frontend && npm install && npm run build    # tsc type-check, then vite build into dist/

# or hot reload at http://localhost:5173 (proxies /api and /v1 to :8000)
cd frontend && npm run dev
```

## Admin console tabs (`#campaign`, `#insights`, `#benefit`, `#pipeline`, `#live`, `#pu`, `#blocks`, `#resp`)

| Tab | Shows | Uses |
|---|---|---|
| Campaign | QR code and join code for phones, privacy policy (epsilon, contributions per device, uploads per step) and Start new campaign, joined devices with a per-device epsilon ledger, activity feed of everything the server receives | `GET /api/live`, `POST /api/live/reset` |
| Insights | predicted click rate by category and time (heatmap), by device and placement, reliability reading, actions the model suggests, what the admin did not receive | `GET /api/live` |
| Benefit | centralised vs federated vs federated plus DP accuracy on real Criteo data, what the admin stores with and without federated learning | `GET /api/experiments` |
| Pipeline | client, edge, cloud round diagram; who sees what | static |
| Benchmark run | configurable federated run on Criteo (Flower or native engine, DP, accountant, secure aggregation, top-k), live charts, compare table | `POST /api/runs`, SSE `/api/runs/{id}/events` |
| Privacy vs utility | AUC against total epsilon with 95% CI (basic vs Renyi), paired gain, noise needed, calibrator | `GET /api/experiments`, `/api/privacy/calibrate` |
| Building blocks | techniques table, top-k compression, Flower vs native parity | `GET /api/experiments` |
| Responsible AI | data minimisation, DPDP Act 2023 and GDPR context, limits of the guarantee, SDG mapping | `GET /api/experiments` |

Phone-facing endpoints (`/v1/schema`, `/v1/model`, `/v1/register`, `/v1/updates`, `/v1/status`) are documented in `backend/src/fedad/web/live.py`.

## Checks

- `backend/tests/test_phone_wire.py` runs the phone's TypeScript (wire format, local training, privacy accounting) through Node and compares it with the Python backend.
- `node scripts/phone_e2e.mjs http://127.0.0.1:8000 <join code> 10` drives the phone's real client code against a running server (register, train, noise, upload) with no browser.

**NOT IMPLEMENTED:** a native app, background training, HTTPS (so no service worker or install-to-home-screen), an admin login (admin endpoints simply answer to localhost).
