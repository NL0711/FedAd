# Android browsers that can run the FedAd Contributor extension

Researched 2026-11-20 from primary sources only (Mozilla, MDN and its browser-compat-data repo, Microsoft Learn, Chrome and
Samsung developer docs, the browsers' own repos and issue trackers). Anything I could not confirm from a primary source is marked
**unconfirmed**. Community forum posts are not treated as sources.

What the extension needs (`extension/manifest.json`, `extension/dist-firefox/manifest.json`): Manifest V3, `scripting`
(`registerContentScripts` / `unregisterContentScripts` with `persistAcrossSessions`), `optional_host_permissions`
(`https://*/*`, `http://*/*`) with `permissions.request / contains / remove`, `activeTab`, `storage.local`, an `action`
popup, and a background service worker (Chrome build) or background scripts / event page (Firefox build, with
`browser_specific_settings.gecko` and an empty `gecko_android`).

## Short answer

- **Firefox for Android is the only mainstream option that is both officially supported and installable by ordinary users.**
  Release, Beta and Nightly all run extensions; developers get an official USB workflow (`web-ext run -t firefox-android`).
- **Kiwi Browser is dead** (archived, no updates after January 2025). Do not build the plan around it.
- **Yandex Browser for Android** has the only documented "upload unpacked extension" flow among Chromium browsers, but it is
  a Russian-market browser and MV3 support is unconfirmed.
- **Edge Android, Brave Android, Chrome Android, Samsung Internet, Opera, DuckDuckGo**: no confirmed route for a custom MV3
  extension today (details below).

## Comparison table

| Browser | Installs extensions? | Sideload an unpacked or dev build | MV3 `scripting.registerContentScripts` | `optional_host_permissions` + `permissions.request` | Toolbar popup |
|---|---|---|---|---|---|
| **Firefox for Android (release)** | Yes, from AMO (Android-compatible add-ons) | Yes: `web-ext run -t firefox-android` over adb (temporary). Signed unlisted XPI via "Install Extension from File" (debug menu). Unsigned XPI from file: not allowed on release | API available from Firefox 102 (same as desktop per BCD). Android-specific persistence behaviour: unconfirmed | `optional_host_permissions` from Firefox 128; `permissions.request` on Android from Firefox 120 (BCD). Android has no UI to view or edit host grants (bugs open) | Yes, but shown as an overlay opened from the Add-ons menu item, not a toolbar button |
| **Firefox Beta / Nightly** | Yes, plus custom AMO collection (documented for Nightly; Beta documented as supported for persistent loading) | Same as release; Nightly also accepts unsigned zipped add-ons from file per a Mozilla developer (not recommended) | Same as release | Same as release | Same as release |
| **Kiwi Browser** | Chromium-based, had extension support, **archived** | Last build only (GitHub release 2025-04-07); no more updates | n/a (no maintenance) | n/a | n/a |
| **Microsoft Edge Android** | Edge Canary has extension code (per Kiwi's README); stable status unconfirmed | Canary: "Extension install by id" in Developer options, by extension ID from Edge Add-ons. No documented unpacked or file install | Docs list `scripting` as MV3, Android-supported | Docs list `permissions` as Android-supported; behaviour unconfirmed | Docs list `action` as Android-supported; UI unconfirmed |
| **Samsung Internet** | Only approved extensions through Galaxy Store; developer program is a closed beta | No documented sideload | Unconfirmed | Unconfirmed | Unconfirmed |
| **Opera Android** | No primary statement that it supports extensions | None found | Unconfirmed | Unconfirmed | Unconfirmed |
| **Yandex Browser Android** | Yes, from Yandex, Chrome Web Store and Opera Add-ons catalogs | **Yes, documented**: `browser://extensions`, Developer Mode, "Upload unpacked extension" | Unconfirmed (no MV3 statement found) | Unconfirmed | Unconfirmed |
| **Brave Android** | Not in released builds (only a flagged build was being added; see below) | Per the Brave issue: unpacked or .crx behind `brave://flags/#brave-android-extensions`. Release status unconfirmed | Issue says MV3 and MV2 supported once enabled | Unconfirmed | Phones: "no UI entry point" per the issue (tablets and foldables only) |
| **DuckDuckGo Android** | No primary statement of any extension support | None found | n/a | n/a | n/a |
| **Chrome Android** | No primary statement that it supports extensions; only an experimental Chromium work item | None | n/a | n/a | n/a |

## Per-browser notes and sources

### Firefox for Android (release, Beta, Nightly)

- **Editions** for `web-ext`: Nightly `org.mozilla.fenix`, Beta `org.mozilla.firefox_beta`, Release `org.mozilla.firefox`. "You can use
  any edition of Firefox"; same version as desktop is recommended. web-ext 7.12.0 or later.
  https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- **Open ecosystem on AMO** launched 2023-12-14 (450+ Android extensions at launch) and passed 1,000 in May 2024. Only add-ons
  that AMO marks Android-compatible are offered. I did not find a Mozilla page that states the "only AMO-listed" rule for release in so
  many words; treat it as likely, not confirmed.
  https://blog.mozilla.org/addons/2023/12/14/a-new-world-of-open-extensions-on-firefox-for-android-has-arrived/
  https://blog.mozilla.org/addons/2024/05/02/1000-firefox-for-android-extensions-now-available/
- **Custom AMO collection** (Nightly, 2020 post, may be dated): create a collection on AMO (no spaces in the name), tap the logo in
  Settings > About five times, then Settings > Custom Add-on collection, enter user ID and collection name; app restarts. Only
  AMO-listed add-ons can be in it. Mozilla's 2023 posts still point developers to this for pre-release testing on Nightly.
  https://blog.mozilla.org/addons/2020/09/29/expanded-extension-support-in-firefox-for-android-nightly/
  https://blog.mozilla.org/addons/2023/09/27/test-firefox-android-extensions-and-help-developers-prepare-for-an-open-mobile-ecosystem-in-december/
  Whether this setting still exists in current Beta and release builds: **unconfirmed** (I found no 2026 Mozilla page).
- **Install a signed XPI from a file** (self-distributed or unlisted): download the file, Settings > About Firefox, tap the logo five
  times, Settings > "Install Extension from File", pick the file, tap Add. The page names no version or channel.
  https://extensionworkshop.com/documentation/publish/install-self-distributed/
  Bugzilla 1814123 (fixed in Firefox 123) says the entry is under Settings > Advanced and that it needs Android 10 or later.
  https://bugzilla.mozilla.org/show_bug.cgi?id=1814123
- **Unsigned XPI on release: not possible.** A Mozilla add-ons developer relations reply: "No, you can't install an unsigned add-on from a file
  in Firefox for Android"; `web-ext` "will temporarily install an add-on in all versions of Firefox on Android"; unsigned zip works on
  Nightly but not recommended; Mozilla does not let developers self-sign.
  https://discourse.mozilla.org/t/is-add-on-loading-from-file-possible-in-firefox-for-android-139-0-4/144353
  (A later poster claims a `chrome://geckoview/` settings route; unverified, ignore.)
- **Unlisted signing**: `web-ext sign` version 8+ supports initial submissions and updates of self-distributed add-ons.
  https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- **API support**: `scripting.registerContentScripts` / `unregisterContentScripts` from Firefox 102 on Android (BCD value is
  "mirror" of desktop). `permissions.request` on Android from 120, `contains` and `remove` from 79. `optional_host_permissions`
  from 128 on Android. `action.openPopup` 109 (before Firefox 149 it needs a user gesture).
  https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/scripting.json
  https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/permissions.json
  https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/optional_host_permissions.json
  (BCD has no separate Android entry for `persistAcrossSessions`; it mirrors desktop, Firefox 105 made the option accept any
  boolean.)
- **Popup**: action, browserAction and pageAction buttons appear under the "Add-ons item in the Firefox for Android browser
  menu", not the toolbar, and popups "open as an overlay, covering the browser window until the user closes the overlay".
  https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/
- **Background**: background service workers are not supported (bug 1573659, still NEW as of 2026-11-04); use event pages. Android
  can kill idle extension processes, so keep state in `storage` and register listeners at top level.
  https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
  https://bugzilla.mozilla.org/show_bug.cgi?id=1573659
- **Host permission UI gaps** (both still open in July 2026): no visual indicator for a pending `host_permissions` grant (bug
  1820867), users cannot edit host grants in the Add-ons Manager (bug 1812125).
  https://bugzilla.mozilla.org/show_bug.cgi?id=1820867
  https://bugzilla.mozilla.org/show_bug.cgi?id=1812125
- **Mozilla's own advice**: the Android page recommends Manifest V2 for Android targets. It lists the three known MV3 gaps above.
  https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- **Debug**: Inspector cannot show the markup of a popup page (bug 1637616); workaround is to temporarily open the popup as a tab.
  Keep at least one tab open or the extension will not load. Use desktop `about:debugging`, select the device, Inspect the Main
  Process.
- **Permissions request rule**: `permissions.request` can only be called inside a user-action handler; the browser may prompt.
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request
  Whether the permission prompt for an origin renders correctly on Android: **unconfirmed**; test on a device.

### Kiwi Browser

Archived. The README of `kiwibrowser/src.next` says: "Kiwi Browser is now archived. It will no longer be maintained after January 2025."
The last GitHub release is 14310011181 (Version 137.0.7337.0, 2025-04-07), and the author states Kiwi "will no longer receive
engine updates". It points users to Edge Canary, Vivaldi or Firefox. The older `kiwibrowser/src` repo is flagged archived on GitHub.
https://github.com/kiwibrowser/src.next (branch `kiwi`, README)
https://github.com/kiwibrowser/src.next/releases/tag/14310011181
Using it means running an unpatched Chromium; do not recommend it to end users.

### Microsoft Edge Android

- Kiwi's README says Kiwi's extension code was integrated into **Edge Canary**, and that extensions there can be installed by ID:
  Settings > About Microsoft Edge, tap the build number 5 times, Developer options > "Extension install by id", paste the ID from the
  Edge Add-ons store URL. That is a secondary route for store-listed extensions only. No unpacked or file-based option is
  documented.
  https://github.com/kiwibrowser/src.next (README)
- Microsoft's API table marks `scripting` (MV3), `permissions`, `storage`, `action` (MV3), `runtime` and `tabs` as available on
  Android (page updated 2026-08-12). It does not say the feature is on by default in stable.
  https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support
- Stable mobile release notes (to 2026-11-16) mention an `ExtensionInstallForcelist` policy for iOS and Android in 6 July 2026 (version 150) and
  an `EdgeDisabledFeatures` extension fix. They announce no general consumer extension launch. So: whether stable Edge
  Android lets users install extensions: **unconfirmed**. Whether a developer can publish an Android-targeted listing: **unconfirmed**.
  https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-mobile-stable-channel
- Desktop "Load unpacked" docs exist; none for Android.
  https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading

### Samsung Internet

Extensions (called add-ons) exist, but third-party development is "in a closed beta phase": approved developers only, validated and
approved by Samsung, distributed through the Galaxy Store. No sideload or public test process is documented. The Android release-note
page lists "Extensions (Android M OS and above, Galaxy Store Required)" in 11.0 (Feb 2020) and add-ons in Secret Mode in 19.0.1.2
(Nov 2022); its newest entry is 25.0.0.41 from May 2024, so that page may not be current. MV3 and API coverage: **unconfirmed**.
https://developer.samsung.com/internet/android/extension-guide.html
https://developer.samsung.com/internet/release-note/android-release-note.html

### Opera, DuckDuckGo, Chrome Android

- **Opera Android**: Opera's Android help page does not mention extensions or add-ons (only a footer link to addons.opera.com).
  Forum posts say it does not support them, but those are community posts. **Unconfirmed**.
  https://help.opera.com/en/mobile/android/
- **DuckDuckGo Android**: its help pages describe built-in tracker protection and the desktop extensions for Firefox, Chrome, Edge
  and Opera. I found no page saying the Android browser can install extensions. **Unconfirmed**.
  https://duckduckgo.com/duckduckgo-help-pages/
- **Chrome Android**: I found no Chrome developer or Web Store page that says extensions run on Chrome for Android phones. The Chrome Web
  Store install help only describes starting an install from a phone for desktop Chrome. Chromium's tracker has issue 356905053,
  "Support extensions on experimental desktop android builds" (experimental, not a shipped feature; I could not read its latest
  state). Treat Chrome Android as not usable. **Unconfirmed** beyond that.
  https://support.google.com/chrome_webstore/answer/2664769
  https://issues.chromium.org/issues/356905053

### Yandex Browser Android

Yandex's own help page says mobile users can install extensions "created by the developers of Yandex Browser or from the third-party
catalogs" (Chrome Web Store, Opera Add-ons). For development: open `browser://extensions` in the SmartBox, turn on Developer Mode
(top right), tap "Upload unpacked extension", and pick the `manifest.json` file in the file dialog (dialog varies by Android
version). MV3 support, `scripting` and `permissions` behaviour are not documented there: **unconfirmed**. The browser is mainly
used in Russia and neighbouring markets; confirm it is acceptable before relying on it.
https://yandex.com/support/browser-mobile-android-phone/en/personal-settings/extensions

### Brave Android

Not released with extensions as far as primary sources show. Brave issue 59354 ("Enable extensions on Android behind the
BraveAndroidExtensions flag", opened 2026-09-25, closed as completed 2026-11-19, priority P3) describes: Chromium's extension system
built in, off by default behind `brave://flags/#brave-android-extensions`, install from the Chrome Web Store or load unpacked or
.crx, MV3 and MV2 supported; "phase 1" has toolbar UI for tablets and foldables only, phones "get working extensions but no UI
entry point". The issue gives no release number, so **which Brave version ships it is unconfirmed**. Issue 49525 (a feature request,
open as of 2026-11-16) still says only desktop Brave has full extension support.
https://github.com/brave/brave-browser/issues/59354
https://github.com/brave/brave-browser/issues/49525
A phone with no popup entry point makes it useless for our popup-driven consent flow regardless.

## Step-by-step: Firefox for Android

### Option A (best for developers): `web-ext run` over USB

Source: https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/

1. Install web-ext 7.12.0 or later (`npm i -g web-ext`) and Android platform-tools so `adb` is on your `PATH`.
2. Install Firefox Nightly, Beta or Release on the phone (`org.mozilla.fenix`, `org.mozilla.firefox_beta`, `org.mozilla.firefox`).
3. Phone: enable Developer options and **USB debugging**; plug in by USB and accept the prompt.
4. Firefox on the phone: Settings, enable **Remote debugging via USB**.
5. On the PC run `adb devices` and confirm the phone is listed.
6. From the built Firefox extension folder, `extension/dist-firefox`:
   ```
   web-ext run -t firefox-android --adb-device <DEVICE_ID> --firefox-apk org.mozilla.firefox
   ```
   (use `org.mozilla.fenix` for Nightly). Without flags, web-ext prompts for the device and APK.
7. Keep at least one tab open in the phone's Firefox or the extension will not load. Open the Add-ons item in the browser menu
   to reach the popup.
8. Debug: desktop Firefox, `about:debugging`, enable USB devices, select the phone, Inspect the Main Process. For manifest errors:
   `adb logcat | grep @<addon-id>`.
9. Run `web-ext lint` first; it reports Android incompatibilities (`ANDROID_INCOMPATIBLE_API`,
   `PERMISSION_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`).

This is a temporary install: it does not survive browser restarts the way a signed add-on does. Testers other than you cannot use it.

### Option B (for testers and end users): signed unlisted XPI, installed from file

Sources: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/ and
https://extensionworkshop.com/documentation/publish/install-self-distributed/

1. Sign through AMO as **unlisted** (self-distributed): `web-ext sign --channel=unlisted` (web-ext 8 or later, with AMO API
   keys from the AMO Developer Hub) or upload on the Developer Hub. The result is a signed `.xpi`. Unsigned cannot be installed on
   release Firefox.
2. Put the `.xpi` where the phone can download it (HTTPS URL served as `application/x-xpinstall`, or copy by USB).
3. On the phone in Firefox: Settings, About Firefox, tap the logo five times ("Debug menu enabled").
4. Back in Settings, tap **Install Extension from File** (Bugzilla says Settings > Advanced; Android 10 or later required).
5. Pick the `.xpi` and tap **Add**.
6. The extension appears under Add-ons in the browser menu.

The listed route (AMO listing with Android compatibility, installed straight from the store) is the easiest for ordinary users but
needs AMO review, and the "install from file" route needs the hidden debug menu, so it suits testers, not the public.

### Option C: Yandex Browser (only if you need a Chromium engine)

Source: https://yandex.com/support/browser-mobile-android-phone/en/personal-settings/extensions
Copy the unzipped `extension/` folder to the phone, open `browser://extensions`, enable Developer Mode, tap "Upload unpacked
extension", select `manifest.json`. Nothing is documented about MV3 service workers, so test before committing.

## What changes how we build

1. **Firefox build is MV3 with `background.scripts`, which matches Firefox's event-page model; keep it.** Mozilla still recommends MV2 for Android, but
   the three listed MV3 gaps (service worker, host-grant indicator, host-grant editing) do not break a design that uses event pages and
   `permissions.request`.
2. **Add `strict_min_version` to the Firefox manifest.** It currently declares none. The MDN data gives 128 for `optional_host_permissions`
   and 120 for Android `permissions.request`, so I would set at least 128 for both `gecko` and `gecko_android`. Also note that the
   manifest currently has a placeholder id (`fedad-contributor@example.org`) that must become a real, unique id before AMO signing.
3. **Host permission prompts**: we depend on `permissions.request` for each site the user allows. It must run inside a user gesture
   (MDN). Android has no place to see or revoke granted hosts (bugs 1820867 and 1812125), so the extension's own popup must list the
   granted sites and call `permissions.remove` itself. Whether Firefox Android actually shows its grant prompt for origins is
   **unconfirmed**; test this first on a device.
4. **Popup is an overlay under the Add-ons menu.** A permission prompt triggered from a popup that is dismissed can race with the
   overlay. Inference, not a documented fact: offer a second entry point that opens `popup.html` as a tab (`browser.tabs.create`), which
   Mozilla itself suggests as a debugging workaround, and call `permissions.request` from a click there.
5. **Idle process kill**: keep registered content scripts in `scripting.registerContentScripts` (persisted) and re-register on
   `runtime.onStartup` and `onInstalled`, and keep all state in `storage.local`, not in module variables. Whether `persistAcrossSessions: true` survives an
   Android process restart in practice: **unconfirmed**, test it.
6. **Chrome build on Android is not testable today.** Chrome Android has no documented extension support, Kiwi is archived, and Edge,
   Brave and Samsung are gated or unconfirmed. Keep the Chrome build desktop-only until a primary source says otherwise.
7. Run `web-ext lint` as a CI step on `dist-firefox`.

## Recommendation

1. Target **Firefox for Android only** for mobile. It is the only browser with documented, supported extension install and a
   developer workflow, and our Firefox build already matches its event-page model.
2. Developers: Option A (`web-ext run -t firefox-android` over USB). Testers: sign an unlisted XPI and use "Install Extension from File".
   End users: list on AMO with Android compatibility.
3. Before building more, run a one-hour device test of three unconfirmed items: the `permissions.request` prompt, the popup overlay
   flow, and `registerContentScripts` persistence after Android kills the process.
4. Add `strict_min_version` (128 or higher) and a real add-on id to the Firefox manifest.
5. Treat Yandex as an optional Chromium test target and Edge Canary or Brave as watch items. Do not use Kiwi.
