# Publishing the extension

The extension builds into two folders (`npm run build` in `extension/`) and two store packages (`npm run pack`):

| File | For |
|---|---|
| `extension/release/fedad-contributor-1.0.0-chrome.zip` | Chrome Web Store (also Edge Add-ons, Brave, Opera) |
| `extension/release/fedad-contributor-1.0.0-firefox.zip` | Firefox (desktop and Android), through addons.mozilla.org |

Both use the deployed backend `https://fedad.onrender.com`. `npm run pack` refuses to build against a non-https address. Only a store (or
Mozilla's signing) can make an extension installable for other people without developer mode; those steps need your own accounts.

## Before you submit

- Fill in the contact email in `frontend/public/privacy.html` (it is a placeholder), push, and check that
  `https://fed-ad.vercel.app/privacy.html` loads. Both stores want that address as the privacy policy.
- Take two or three screenshots (Chrome wants 1280x800 or 640x400): the popup, and the admin Insights page.

## Chrome Web Store

1. Open the developer dashboard (chrome.google.com/webstore/devconsole), sign in, and pay the one-time registration fee.
2. **Add new item**, upload the Chrome zip.
3. Listing text (suggested):
   - Name: FedAd Contributor
   - Summary (132 characters): Learns which topics you click on, on your device only, and shares just a noised model update.
   - Description: FedAd Contributor takes part in a federated learning demonstration. It reads the pages you open on your device to guess a
     topic, notes which links you click, trains a small model locally, and sends only a clipped, noised update to the FedAd server. No pages,
     addresses or site names leave your device. You can delete everything stored on the device from the popup.
4. **Privacy** tab:
   - Single purpose: "Learn, on the user's device, which topics the user clicks on, and contribute a privacy-protected model update to the
     FedAd federated learning campaign."
   - Permission justification, `storage`: "Keeps the locally recorded examples, the local model and the random device token."
   - Permission justification, host access (all sites): "Needed to read each page's title, headings and links on the user's device to pick a
     topic. The text and addresses are not stored or transmitted."
   - Remote code: none (all code is in the package).
   - Data usage: declare what you handle and say it is not sold, not used for unrelated purposes, and not used for creditworthiness. Be
     accurate: it handles website content and user activity on the device, and sends only a noised update.
   - Privacy policy URL: `https://fed-ad.vercel.app/privacy.html`
5. Submit for review. Expect a longer, stricter review because it asks for access to all sites and handles browsing data; a vague
   justification is the usual reason for rejection. Reviews can take days to weeks.

## Firefox (desktop and Android)

The add-on id is `fedad-contributor@fedad.onrender.com` and it needs Firefox 142 or newer (set in `extension/build.mjs`). Mozilla's checker
reports no errors or warnings on `dist-firefox`.

**Option A, signed but not listed (free, fastest).** Gives you a signed `.xpi` you can install from a file.
1. Make an account at addons.mozilla.org and create API credentials (Developer Hub, Manage API Keys).
2. In PowerShell, with your own values (do not paste them into chat or commit them):
   ```powershell
   cd extension
   node node_modules/web-ext/bin/web-ext.js sign --source-dir dist-firefox --channel unlisted --api-key $env:AMO_KEY --api-secret $env:AMO_SECRET
   ```
3. The signed file appears in `extension/web-ext-artifacts/`. Install it on desktop by dragging it into Firefox.
4. On Android: in Firefox, Settings, About Firefox, tap the logo five times to turn on the debug menu, then Settings, **Install add-on
   from file**, and pick the `.xpi` (copy it to the phone first).

**Option B, listed on addons.mozilla.org.** Submit the Firefox zip as a public add-on. Everyone can then install it from the store, including
on Android. Mozilla reviews it and may ask for the source; keep `extension/` as it is in this repo.

## Edge, Brave, Opera

Edge Add-ons accepts the Chrome zip (partner.microsoft.com, free). Brave and Opera run Chrome Web Store extensions once it is listed.

## Phone

Chrome on Android cannot run extensions. Use Firefox for Android with option A or B above. For development, plug the phone in with USB
debugging on and run `node node_modules/web-ext/bin/web-ext.js run -t firefox-android --android-device <id> --source-dir dist-firefox`
(`adb devices` shows the id).

## Updating

Raise `version` in `extension/manifest.json`, run `npm run pack`, and upload the new zip. Firefox updates need a higher version too.
