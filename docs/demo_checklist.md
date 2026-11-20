# Demo checklist for reviewers

What this shows: a browser extension learns what a person is interested in, on their own device, and sends only a clipped, noised
model update to a server. The admin sees the shared (global) model change. The advertiser sees only predicted click rate from that
privacy-protected model (not people, not measured results).

Addresses
- Server (backend): https://fedad.onrender.com
- Sign in: https://fed-ad.vercel.app/login.html (admin and advertiser accounts are in Supabase Auth)
- Admin console: https://fed-ad.vercel.app/
- Advertiser console: https://fed-ad.vercel.app/advertiser.html

## A. Before the demo (presenter, 10 minutes ahead)

- [ ] Open https://fedad.onrender.com/healthz. The free server sleeps, so the first load can take about a minute. Expect `{"ok":true}`.
- [ ] Render logs show `PERSIST on` (the model is saved to Supabase and survives restarts).
- [ ] Admin console, Campaign page, start a new campaign (clears old test devices). Model version reads 0.
- [ ] Build and load the extension: `cd extension; npm install; npm run build`, then `chrome://extensions`, Developer mode, Load unpacked, pick `extension/dist`.
- [ ] Pin the extension. Do one practice run of section B in a separate browser profile, then start a new campaign again.

## B. Live walkthrough (about 10 minutes)

1. **Install and join, no code.** Open the extension popup and tick "I agree". There is no prompt for the server.
   - Expect: the popup shows "Connected". Admin Campaign page shows "Devices joined" go up by one.
2. **Say what it reads.** The extension runs on every page (Chrome's install prompt says it can read data on all websites; that is the
   permission it needs to read each page's title and headings on the device). Pages with a password or card field are skipped, and the
   demo's own admin and server pages are excluded. A site can be blocked in Chrome: `chrome://extensions`, Details, Site access.
3. **Browse like a normal person.** Open pages from the list below, stay on each for 3 seconds, then click an article or link. Repeat on several pages.
   - A page open for 2.5 seconds, whose topic is recognised, is one view. A click on a link, button or anything clickable is one tap
     (one per page). You need **20 views and 2 taps** in total.
   - Expect: the popup shows the page and click counts, kept on this computer.
4. **Show the local model.** DevTools for the extension: `chrome://extensions`, click "service worker" under the extension, Application tab,
   Extension storage, Local. `events` is the local cache of what was seen. After step 5, `localModel` holds the local weights next to
   the server weights it started from.
5. **The update is sent by itself.** There is no button. Once there are 20 views and 2 taps, the extension trains on the device and
   sends an update, then again after every 5 new views (at most once a minute). Keep the service worker DevTools open on the Network tab
   (tick Preserve log) to watch it.
   - `GET /v1/model`: the global model comes down.
   - `POST /v1/updates`: the update goes up. The body has `base_version`, `n`, `loss_before`, `loss_after` and `blob`. No page, no site name, no list of what was viewed.
   - Response: `accepted`, `version`, `model_stepped`. The popup's "updates sent" count goes up.
6. **Show the same update arriving at the server.** Admin console, Model tab: the update appears, the global model version went up and the
   before/after bars show how far the shared weights moved.
7. **Private by design.** Show that the admin never receives events or sites, only: device number, size, checksum, model version.
   **Advertiser page.** Sign in as the advertiser account and open `/advertiser.html`. It shows only predicted click rate by ad category and
   by time of day, read from the shared model, with the number of contributing devices and the privacy setting. It says "early estimate"
   below 10 devices. It never shows a person, a device, a page or a site.
8. **Survives a restart (optional).** Render, Manual Deploy. After it is back, the Model tab still shows the update and the same version.
9. **Delete.** Popup, "Delete my data": the local events and the local model are gone from Extension storage and every site is dropped.

## C. Sites to browse (checked against the extension's topic guess)

The topic guess reads the page title, heading, description and host name. These sites were checked by running the extension's classifier on
each home page. Article pages on the same site usually give the same topic. A fresh browser may differ, so confirm in the popup that
views go up.

| Topic | Sites that were guessed correctly |
|---|---|
| Sports | espncricinfo.com, bbc.com/sport, skysports.com |
| Tech | gadgets360.com, techcrunch.com, wired.com |
| Food | bbcgoodfood.com, epicurious.com, zomato.com |
| Travel | lonelyplanet.com, tripadvisor.in |
| Fashion | vogue.com, myntra.com, nykaa.com |
| Finance | moneycontrol.com, nerdwallet.com, bankbazaar.com |
| Games | pcgamer.com, polygon.com, gamesradar.com, eurogamer.net, store.steampowered.com |
| Health | healthline.com, webmd.com, mayoclinic.org |

Not guessed (the page title is too generic, or the site blocked the check): gsmarena.com, theverge.com, cnet.com, xda-developers.com,
ign.com, gamespot.com, fifa.com, espn.in, booking.com, makemytrip.com, investopedia.com, allrecipes.com, seriouseats.com.

Quick route to 20 views: open 4 or 5 sites from different topics, open 4 article pages on each, hold each page 3 seconds, click one
link on at least two of them.

## D. If something does not work

| Symptom | Likely cause and fix |
|---|---|
| Popup stays on "Connecting..." | The server is asleep or redeploying. Open `/healthz`, wait, press "Try again". |
| No update is sent | Needs 20 views and 2 taps first, then 5 new views and a minute between updates. Keep browsing. |
| Views stay at 0 on a site | Reload the page once after installing. The page may not be guessable (see the "not guessed" list), or it has a password field. |
| Model tab says "Waiting for an update" | No device has contributed since the last restart or new campaign. |
| Admin console is empty after a restart | `DATABASE_URL` is not set on Render, so nothing was saved. |
| Phone | Chrome on Android cannot run extensions. Use Firefox for Android (see `docs/android-extension-browsers.md`). Untested. |

## E. Known limits to state honestly

- The topic guess is a simple keyword match and skips pages it cannot place.
- Registration is open and rate-limited per address (30 per hour). There is no stronger protection against a flood of junk updates.
- The server accepts at most 60 devices in total.
- The advertiser page shows predicted click rate from the model only. There is no identity join, so no conversion or lift is measured.
  Below 10 contributing devices it is labelled an early estimate.
- The phone path (Firefox for Android) has not been tested on a device.
- Privacy numbers (epsilon, noise) are for a demonstration and are not a formal guarantee for production use.
