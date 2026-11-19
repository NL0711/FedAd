# Phone app (`phone.html`)

A demo ad feed that is also a federated client. Open `http://<laptop-ip>:8000/phone.html?code=<join code>` on a phone.

**Recorded on the phone only** (browser localStorage, capped at 2000 events): per ad shown, its category and placement, the hour
bucket, device type, whether it was tapped, scroll speed, dwell, position in the session, screen width, connection quality, and
tap counts. Ads are made up and loaded from nothing but the page itself.

**Leaves the phone only when you press Contribute:** one model update (clipped to L2 norm `clip_c`, Gaussian noise added with the
browser's crypto random generator, optionally top-k, encoded like `backend/src/fedad/aggregation/compress.py`), the number of
impressions, and two loss values. The count and loss values are not covered by the DP guarantee.

**The phone enforces its own ceiling** (Settings, default epsilon 150 per upload): it converts the server's noise level to the epsilon
one upload costs (Renyi accounting, `rdp.ts`) and refuses to upload if that is higher, or if the campaign adds no noise.

Files: `wire.ts` (zlib stream with stored blocks, float16, gap coding), `train.ts` (local SGD, clip, noise, top-k), `rdp.ts`,
`client.ts` (the contribution protocol, no DOM), `feed.ts` (ad content), `main.ts` (UI), `phone.css`.

Limits: plain HTTP on a LAN, so a token can be sniffed on shared Wi-Fi; no service worker, so not installable; one browser profile is
one device; the join code is the only gate on registration.
