# Phone demo: run it, and what to say

The phone runs a small feed app in its browser (a web page, no install). It is a real federated client: it records your taps
on the phone, trains a model on the phone, clips and noises the update, and sends only that. The laptop is the ad admin.

## Run it

1. Laptop and phone on the same Wi-Fi (a phone hotspot works too; some guest or college Wi-Fi blocks device-to-device traffic,
   in which case use the hotspot).
2. In `backend/`:
   ```
   .\.venv\Scripts\python -m fedad.web --lan
   ```
   Allow Python through the Windows firewall for **private** networks when asked.
3. On the laptop open **http://localhost:8000** (the admin console; it only answers on the laptop).
4. On the Campaign tab, scan the QR code with the phone camera, or type the shown address into the phone browser.
5. On the phone: read the consent screen, tap *I agree*, scroll the feed for a minute, tap the ads you genuinely like (at least
   20 seen and 2 tapped), press **Contribute**, then watch the numbers in each step.
6. Back on the laptop: Insights tab. Repeat contributions (up to the per-device limit) and see the heatmap sharpen.

If the QR address is wrong (several network adapters), type `http://<laptop Wi-Fi IP>:8000/phone.html?code=<code>` by hand.
`ipconfig` shows the Wi-Fi address.

Rebuild the pages after editing the frontend: `cd frontend && npm run build`.

## Five-minute demo script

1. **Problem (30 s).** To learn which ads work, an ad admin normally collects every user's impressions and clicks. That is the
   privacy risk and the compliance burden.
2. **Join (30 s).** Show the Campaign tab: QR code, join code, privacy policy slider. Phone joins. Point at the consent screen:
   what stays, what leaves.
3. **Use (60 s).** Scroll, tap a few Tech ads. The counter on the phone says the events stay on the phone.
4. **Contribute (60 s).** Press Contribute. Read out the steps: train here, clip, add noise, upload 148 bytes. Show the
   phone refusing if you lower its ceiling in Settings (the phone enforces its own privacy limit, not the server's).
5. **Admin view (60 s).** Insights tab: heatmap of predicted click rate by category and time. Activity feed: the server received
   a device number and a byte count, nothing else.
6. **Trade-off (60 s).** Start a new campaign with ε = 50: the picture turns to noise. With ε = 1000: it is clear. That is the
   privacy-utility trade-off, live.
7. **Benefit tab (30 s).** On real Criteo data the federated model without noise scored 0.693 AUC against 0.689 for pooling
   everyone's raw data (within noise), while the admin stores zero impressions. Noise is what costs accuracy: AUC 0.687 at
   total epsilon 10 000, 0.647 at 1 000, 0.563 at 100 (Renyi accounting).

## What to say if asked

- *Is this the same data as the benchmark?* No. Criteo's columns are anonymised, so a phone cannot produce them. The phone uses a
  small feature set it can measure itself (`backend/src/fedad/ml/schema.py`). The Criteo benchmark is a separate, offline
  evaluation of the same federated method on real click data, with a simulated federation.
- *Is one phone enough?* It is enough to show the mechanism, not to learn a reliable model: noise dominates with few
  contributions. Friends' phones joining the same code make the heatmap meaningful.
- *Why do ads in the feed not come from the internet?* They are made up; nothing is loaded from the network.
- *Is the transport secure?* No. Plain HTTP on a local network; a token could be sniffed on shared Wi-Fi. Fine for a demo.
- *What does the guarantee cover?* The noised update, per phone, with the epsilon shown. It does not cover the impression
  count and loss values sent alongside, who joins, or one person on several devices.

## Proving it with the server logs (Render: service, Logs tab)

Every event is one line. Filter the log view with the word in capitals.

| Claim | Show | Match it with |
|---|---|---|
| Phone trained a local model and sent weights | phone: Me, Private learning, Contribute, Proof (local model, the update that left, `148 B 0x2BEB2336`) | log line `UPDATE ... adler32=0x2BEB2336`: the same bytes arrived |
| The weights are noised | `UPDATE ... received[0:6]=[...]` is the noised vector; Proof on the phone shows clipped vs sent | |
| Server model updated | same `UPDATE` line: `model v1->v2 \|dw\|=0.94 top_moved=...` | admin Model tab shows the same step |
| Privacy budget enforced | `REGISTER ... sigma=0.157`; phone refuses over its own limit | |
| Guest vs signed in | `SHOP GUEST GET /v1/shop/products` has no user; `SHOP LOGIN` shows email and a redacted password; `SHOP ACCOUNT user=... POST /cart` | phone eye icon lists the same requests |
| Server never sees taps | no `SHOP` or `UPDATE` line carries a tap or timestamp | |

The password is never logged and tokens are never logged.

## Limits (state them yourself before the examiner does)

Web page, not a native app, so no background training and no install without HTTPS. Browser storage holds the events (cleared
by the Settings button or by clearing site data). The wire format and training step are checked against the Python backend by
`backend/tests/test_phone_wire.py`; the UI was exercised in headless Edge with a phone viewport, not on a physical phone by me.
