# What is one training example? Real CTR data, federated systems, and this extension

Question: the user objected that "each page view is one training example, like one ad impression, with a yes/no label (clicked or
not) - that's not how actual data works, right?" Written 2026-11-20. External claims carry a URL; anything not confirmed from a
primary source is marked "unconfirmed". Repo facts were read from the code on branch `admin-ui`. Papers were read as PDFs
(arXiv or the authors' host), not from memory; the Criteo pages were fetched live on 2026-11-20.

## Short answer

- **The format is real; the meaning is not.** Real CTR systems do use "one impression = one row, label = clicked yes/no, logistic
  loss" (Criteo, Facebook, Google ads, Google Play). The repo's row shape and loss are the standard ones.
- **But in those systems an impression is an ad that was actually shown to a person.** Here no ad is shown. A row is a page the
  person viewed, the "category" is a guessed topic of that page, and y = "clicked anything on the page". That is a **page-engagement**
  model, not an ad-CTR model. The user is right about that, and the schema text (`ad_category`, "tapped the ad") is misleading.
- **The user is wrong that this is not how real data works.** The label shape (0/1 per logged event) is exactly what Criteo and
  production systems use, and federated systems (Gboard, Google's FL system) build their local examples from logged on-device
  interactions in the same way, with labels "inferred from user activity (e.g., clicks or typed words)".
- **The server and model do not care what a row means.** They need a fixed-length vector of `n_features` numbers and a 0/1 (or 0..1) y.
  Everything else (one row per page, first click only, topic guess) is a convention in the extension and can be changed without a
  server change, as long as the 'phone-ctr-v1' layout stays.
- **Weak spots that matter more than the objection:** a label that is 1 for any click anywhere (nav links, menus, "accept cookies"),
  a feature (`visible_ms`) that leaks the label, and a constant placement. These are fixable inside the extension.

## How real systems define an example

| System | One row is | Label | Repeats / duplicates | Features | Source |
|---|---|---|---|---|---|
| Criteo 1TB click logs | One display ad served by Criteo | First column: whether the ad was clicked | Rows are ad displays in chronological order, 24 daily files; click and non-click rows were both subsampled, at different rates | 13 integer (mostly counts) and 26 categorical (hashed to 32 bits, meaning undisclosed); missing values allowed | https://ailab.criteo.com/download-criteo-1tb-click-logs-dataset/ (fetched 2026-11-20) |
| Criteo Kaggle Display Advertising Challenge | Same family; DLRM paper describes about 45 million samples over 7 days, 13 continuous and 26 categorical features | Click or not | Not confirmed from the Kaggle page itself (page returned only its title to my fetch) | Same 13 + 26 | Kaggle page https://www.kaggle.com/c/criteo-display-ad-challenge could not be read: **unconfirmed on the Kaggle page**; the DLRM paper (https://arxiv.org/abs/1906.00091, section 4.3) describes it |
| Google ads (McMahan 2013) | A (query, ad) shown to a user; the model estimates P(click given the query and ad) "if it is shown" | Click or non-click, streamed as they are observed | Subsampling is done at the **query** level: keep every query with at least one click, keep a fraction r of queries with no click, and give each kept example importance weight 1/r if it comes from a no-click query (section 4.6) | Very sparse, mostly categorical | https://research.google.com/pubs/archive/41159.pdf (section 2, section 4.6) |
| Facebook ads (He 2014) | One labeled ad impression (x, y) | y in {+1, -1} for click / no click. "No click" is not a user action, so an impression is labeled negative if there is no click after a fixed waiting window | Click arrives later than the impression: the "online joiner" buffers impressions; too short a window loses clicks and biases CTR low, too long delays training (section 4.1, "click coverage") | Ad, user, context, history | https://quinonero.net/Publications/predicting-clicks-facebook.pdf |
| Wide & Deep (Google Play) | "Each example corresponds to one impression" | 1 if the impressed app was installed, else 0 | Not discussed | Context, impression, user features | https://arxiv.org/abs/1606.07792 (section 4.1) |
| DLRM | A data point x with label y; CTR case: +1 click, -1 no click | Click | Not discussed | Criteo 13 dense + 26 sparse | https://arxiv.org/abs/1906.00091 (sections 2, 4.3) |
| YouTube ranking (Covington 2016) | A video impression scored for a user | Click = positive, no click = negative; **positives are weighted by watch time**, negatives get weight 1, so the odds learned approximate expected watch time | Training examples come from all watches; they also generate a **fixed number of examples per user** so heavy users do not dominate the loss | Video ID, watch history, user language, device, example age | https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45530.pdf (sections 3 and 4.2) |
| YouTube multitask (Zhao 2019) | A ranking impression | Several labels per impression: engagement (clicks, time spent) and satisfaction (likes, ratings); binary ones use cross entropy, time-like ones use squared loss | Position bias handled with a shallow side tower | Many | https://dl.acm.org/doi/10.1145/3298689.3346997 (section 4.1 as read from the authors' PDF) |
| Gboard FL (Hard 2018) | A sentence of typed text in the device's **on-device cache** (a device averages about 400 example sentences per training epoch) | Self-labeled: the typed text is the label for next-word prediction; live metrics also use "prediction CTR" and impression recall | n/a | Text plus decoder candidates | https://arxiv.org/abs/1811.03604 (section 5.2 and live experiments) |
| Google FL system (Bonawitz 2019) | Whatever the app puts in its **example store**: "an SQLite database recording action suggestions shown to the user and whether or not those suggestions were accepted" | "Labels inferred from user activity (e.g., clicks or typed words)"; for on-device ranking "each user interaction with the ranking feature can become a labeled data point" | Apps should cap the store and expire old data | App defined | https://arxiv.org/abs/1902.01046 (system design, example store; applications section) |
| FedAvg (McMahan 2017) | Not defined by the algorithm: each client "has a local training dataset" that never leaves it; datasets are non-IID and unbalanced (some users make much heavier use) | App defined | n/a | n/a | https://arxiv.org/abs/1602.05629 (sections 1 and 2) |
| Advances and Open Problems (Kairouz 2021) | Cross-device: data "partitioned by examples" across devices; one user may contribute many records, which is why user-level DP is stronger than record-level | n/a | n/a | n/a | https://arxiv.org/abs/1912.04977 (tables in section 1, section on privacy) |

Points that follow from these sources:

1. **Impression level is the default unit** for CTR models (Criteo, Facebook, Wide & Deep, Covington). The row exists because
   something was *shown*, and the negative label means "shown and not clicked". Without a shown item there is no denominator.
2. **Delayed or missing clicks are a labeling problem, not a model problem.** Facebook handles it with a waiting window and notes
   the bias it creates. A browser extension has the click and the page in the same place, so this problem is smaller here; the
   only delay is that a click can arrive after the row is recorded, which the code already handles by updating `y`.
3. **Subsampling and calibration are tied together.** Google reweights (section 4.6, above); Facebook down-samples negatives and
   then re-calibrates (section 6.2 and 6.3 of He 2014; their best negative rate was 0.025 in their setup). If this repo ever drops
   negative rows, the predicted CTR in `Campaign.insights()` would be too high unless corrected.
4. **Not every example counts equally.** Covington uses watch time as a weight and a fixed number of examples per user. Both are
   changes to the loss or the sampler, not to the model family.
5. **Non-click signals.** Covington trains the *ranking* stage on click vs watch time and explains why: ranking by CTR "often
   promotes deceptive videos" ("clickbait"), whereas watch time reflects engagement (section 4.2). The **candidate generation**
   stage instead uses completed watches as implicit positives, because implicit data is orders of magnitude more plentiful than
   explicit feedback (section 3). Zhao 2019 treats engagement (clicks, time spent) and satisfaction (likes, ratings) as separate
   tasks with separate heads. I found no source that settles scroll depth as a label; **scroll depth as a label is unconfirmed**.
6. **Aggregation level (impression vs session vs user)** is a choice with a privacy side: FL papers say one user contributes many
   records and that DP can be defined per record or per user (Kairouz). Covington equalizes users with a per-user example cap.
   I found no primary source recommending session-level rows for CTR; **session-level CTR rows are unconfirmed as a standard**.

## What the repo does today

### One row

Flow: `content.ts` observes a page, builds an `Ev`, `background.ts` stores it, `features.ts` encodes it, `train.ts` trains on it.

- **When a row exists (`extension/src/content.ts`).** One row per page path (path plus query; single-page apps re-count when the
  path changes, checked every second). A row is created when the page has been open and visible for `DWELL_MS = 2500`, a topic
  could be guessed on the device by `classifyPage()`, and the page has no password or card field. If the person clicks something
  clickable before 2.5 s, the row is created at the click with `y = 1`.
- **What y means.** `y = 1` if there was **one or more trusted clicks on anything clickable** (links, buttons, role=button/link/tab/menuitem,
  submit, summary, `[onclick]`, or any element with `cursor: pointer`) on that page after the row's page was classified. Additional
  clicks on the same page are ignored (`if (pageEv.y === 1) return`). Otherwise y = 0. y says nothing about an ad; there is no ad.
- **The "ad" columns.** `ad_category` = the guessed topic of the page (one of the 8 categories). `placement` is hard-coded to
  `"feed-middle"` for every row, so that one-hot is a constant (it is indistinguishable from the bias).
- **`encodeRow` (`extension/src/features.ts`).** `n_features` numbers: one-hot for `device` (3), `hour_bucket` (6), `ad_category`
  (8), `placement` (4) = 21, then 10 numeric features, each as `clamp((raw - center) / scale, -3, 3)` with the fixed constants from
  `backend/src/fedad/ml/schema.py`. So `n_features = 31` and `n_params = 32` with the bias. (31 computed from `schema.py`; I did not run the server.)
- **Numeric features today (`content.ts`, `record`).** `recency_min` (minutes since last tap, 60 if none), `taps_24h`,
  `prev_dwell_s` (`lastDwell` is never updated, so it is always 3, which encodes to 0), `scroll_speed`, `position` and
  `session_min` (both come from the content script, which restarts on every full page load, so for ordinary multi-page browsing
  `position` is about 0 and `session_min` is the time on this page load, not a real session; single-page apps behave differently),
  `weekday`, `screen_w`, `net_quality`, `visible_ms`. The doc strings in `schema.py` still describe ads ("seconds the previous ad
  stayed in view").
- **Label leak.** Rows created by a click before the dwell time have `visible_ms < 2500`; rows created by the timer always have
  `visible_ms >= 2500`. So a small `visible_ms` almost perfectly means y = 1. The logistic model can learn this. It is not a
  behavior pattern; it is an artifact of how rows are created. This is a real weakness, independent of the user's objection.
- **When a row is sent (`extension/src/background.ts`).** Rows are kept on the device (last `MAX_EVENTS = 2000`). `maybeContribute`
  trains and uploads only when there are at least `MIN_VIEWS = 20` rows **and** at least `MIN_TAPS = 2` rows with y = 1, at least
  `MIN_NEW_EVENTS = 5` new rows since the last upload, and at least `MIN_GAP_MS = 60000` since the last attempt. Uploads are
  capped by the server-set policy (`max_uploads`) and the device's own epsilon `CEILING = 150` per upload. Each upload trains on **all stored rows**
  (all 2000 at most), not just the new ones, then clips and noises the update (`frontend/src/phone/client.ts`, `train.ts`).
- **What the model needs from a row (`backend/src/fedad/ml/model.py`, `frontend/src/phone/train.ts`).** A length-`n_features` vector
  and a number y. Prediction is `sigmoid(x . w + bias)`. The loss is binary cross entropy `-(y log p + (1-y) log(1-p))`, averaged
  over a minibatch, plus L2 `1e-4`. The gradient is `x * (p - y)`. Nothing requires y to be exactly 0 or 1; any y in [0, 1]
  works, and the code has no per-example weights today. The client rejects the model if the spec is not `phone-ctr-v1` or
  `n_params` differs (`client.ts`, `attempt`).
- **What the server does with rows.** Nothing: it receives only the clipped, noised, compressed update. It never sees rows, counts of
  rows, or labels (`web/live.py`; `insights()` reads only weights).

### Convention versus required

| Part | Required by the model/server? | Notes |
|---|---|---|
| Vector length `n_features`, group order and offsets, numeric centers and scales | **Required** (the weights are positional; spec hash is checked) | Changing any of it means a new spec, not 'phone-ctr-v1' |
| Numeric clamp at 3 | Required for stable training and the clipping bound design | Fixed constants, shared by all devices |
| y in [0, 1] and BCE loss | Required by `train.ts` / `model.py` | Per-example weights or soft y are not supported yet, but are a small change (see alternatives) |
| One row per page | **Convention** | Any unit that yields one feature vector would train |
| y = any click once per page | **Convention** | Defined only in `content.ts` |
| Topic as the "ad category" | **Convention** (and the weakest naming) | Only 8 values are allowed by the one-hot |
| `MIN_VIEWS`, `MIN_TAPS`, gap, ceiling | **Convention** for training stability and spam control | `MIN_TAPS = 2` is a floor so the update is not all negatives; it is not a statistical test |
| Rows stay on device | Design choice | Matches the FL papers: the local dataset is never uploaded (McMahan 2017) |

## Where the user is right and where not

Right:

- A page view is **not** an ad impression. No ad was shown or measured; the label is "the person clicked something on the page".
  The correct name for the model today is "page-click propensity by topic, hour, device".
- The label is weak: one click anywhere counts, including navigation, menus and consent buttons; extra clicks, scrolling, reading time and
  closing the page quickly all collapse into 0 or 1. The advertiser console's "predicted click rate by category" therefore
  reads as ad CTR but is page-click rate. The repo should say so.
- `visible_ms` leaks the label; `placement` is constant; `position` and `session_min` do not mean what the schema says.

Not right (or only partly):

- "One example per event with a 0/1 label" **is** how the public data (Criteo) and the production systems above work. A row per event
  and a binary click label is standard; what differs is that their events are impressions of ads.
- A federated client's local dataset is, by definition, whatever the app logs locally (Bonawitz: the app's example store of
  actions and whether they were accepted; Hard: the on-device cache; McMahan 2017: non-IID, unbalanced local datasets). A per-user
  log of page views with a click flag is a legitimate local dataset.
- A single yes/no per page is not "wrong data"; it is a coarse label. Production systems also start there (Covington's click
  label is the base, watch time is a weight added on top).

## Alternatives, with cost

All options below keep 'phone-ctr-v1' unless a schema change is stated. The server needs no change for options that keep the
vector length: it only aggregates weight updates. Server code that reads the schema (`ml/schema.py`, `/v1/schema`, `live.py`
insights, the admin and advertiser UIs, the phone page in `frontend/src/phone`) changes only when the layout changes.

| Option | What it changes | Schema | Server and admin | Cost / risk |
|---|---|---|---|---|
| 0. Keep binary click per page (today) | Nothing | none | none | Cheap. Rename text to "page click" in `schema.py` docs, `README`, and console labels so no one reads it as ad CTR. Fix the `visible_ms` leak (below). |
| 1. Fix leaks and naming only | In `content.ts`, create the row at a fixed moment for all pages (or clip `visible_ms` so click-before-dwell rows do not differ), set `placement` to something meaningful or drop it, restart `position`/`session_min` per browser session via `chrome.storage.session`, rewrite doc strings | none (strings only; optionally a new spec if the placement group is dropped) | none | Low. Highest value for the least work. |
| 2. Each click is its own row | New row per trusted click, y = 1; a page-view row y = 0 only if no click | none | none | Rows are no longer independent per page: the same page contributes several positives and one negative. Inflates the positive rate; the model would then predict "clicks per view" in a way that mixes definitions. Also breaks the "one tap per page" counter that `MIN_TAPS` uses. |
| 3. Click-count or capped count label | y = min(clicks, K) / K in [0, 1] (soft label), or repeat rows | none (BCE already accepts soft y) | none | Small edit in `Ev` and `markTap`. Semantics: "fraction of the click cap", not a probability. Not a standard CTR definition; no primary source found for it; **unconfirmed**. |
| 4. Dwell-weighted label, Covington style | Keep y as click; weight each positive row by dwell time and each negative by 1 (weights in the loss) so the odds approximate expected dwell | none; add an example weight to `localTrain` in `train.ts` and the Python `model.py` mirror | none (server never sees rows) | Moderate: one new array, tests for the Python and TypeScript mirrors, and the interpretation changes: predictions become "expected dwell per page", and Covington notes exp(logit) is used at inference. Needs a cap on weights because the update is clipped and noised (heavy-tailed weights dominate the clip). |
| 5. Per-link or per-element impressions | Row per link or card that was visible on screen (IntersectionObserver), y = clicked that element | Probably yes: needs element features (position, size, type), at least a new `placement` meaning | Insights/UI labels change | Real impression semantics (an element was shown and clicked or not), closest to Criteo/Facebook. Highest cost: many rows per page (storage and CPU), more tracking code, privacy review (element text must not be kept), and a click-through of links is still not an *ad* click. |
| 6. Per-session rows | One row per browsing session: features aggregated, y = any click or number of clicks | New numeric features (pages, minutes, topic mix) | Insights UI changes | Fewer, more independent rows, which fits "one user contributes many records" concerns (Kairouz) but gives far fewer rows per device, so `MIN_VIEWS` would need to change. No primary source found as a standard CTR design: **unconfirmed**. |
| 7. Multi-task labels | Two heads: click (BCE) and dwell (regression), as in Zhao 2019 | Model changes (second output); not 'phone-ctr-v1' | Server aggregates a bigger vector | Largest change; out of scope for a logistic regression prototype. |

## Recommendation

1. Keep one row per page and keep BCE and the schema. Rename the concept in all text: "page view" instead of "ad impression";
   "page click" instead of "ad click"; keep the field names (`ad_category`, `placement`) for compatibility but say so in `schema.py`.
2. Fix the label leak first: the same row-creation rule for clicked and unclicked pages (for example, record `visible_ms` as the
   time at row creation capped to the dwell threshold, or create click rows only after DWELL_MS and count earlier clicks into
   the already-pending row). Stop placement being a constant and make `position` / `session_min` real session values.
3. Only then consider a Covington-style dwell weight (option 4) if the product needs "engagement" instead of "click": it is a
   small, local change, backed by a primary source, and does not touch the server.
4. If the advertiser claim must be "ad CTR", the extension must record real ad elements (option 5). Until then, state in the
   console that values are predicted page-click rates.

## Sources (primary)

- Criteo 1TB click logs, dataset page: https://ailab.criteo.com/download-criteo-1tb-click-logs-dataset/ (row, label, 13 + 26 features, subsampling at different rates; fetched 2026-11-20). The index https://ailab.criteo.com/ressources/ and https://ailab.criteo.com/criteo-1tb-click-logs-dataset/ did not describe the schema. The Kaggle page https://www.kaggle.com/c/criteo-display-ad-challenge/data returned only its title to my fetch: **unconfirmed on the page**. The old labs.criteo.com URL now redirects to the tech blog.
- McMahan et al., "Ad Click Prediction: a View from the Trenches", KDD 2013: https://research.google.com/pubs/archive/41159.pdf. I found **no statement on delayed or duplicate clicks** in it (that is in He 2014); calibration is section 7, progressive validation section 5.1.
- He et al., "Practical Lessons from Predicting Clicks on Ads at Facebook", ADKDD 2014: https://quinonero.net/Publications/predicting-clicks-facebook.pdf. The exact re-calibration formula was not extracted cleanly from the PDF text; see section 6.3.
- Cheng et al., Wide & Deep, 2016: https://arxiv.org/abs/1606.07792
- Naumov et al., DLRM, 2019: https://arxiv.org/abs/1906.00091
- Covington, Adams, Sargin, "Deep Neural Networks for YouTube Recommendations", RecSys 2016: https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/45530.pdf
- Zhao et al., "Recommending What Video to Watch Next: A Multitask Ranking System", RecSys 2019: https://dl.acm.org/doi/10.1145/3298689.3346997 (read from an author-hosted PDF copy, not from the ACM page)
- Hard et al., "Federated Learning for Mobile Keyboard Prediction", 2018: https://arxiv.org/abs/1811.03604
- Bonawitz et al., "Towards Federated Learning at Scale: System Design", 2019: https://arxiv.org/abs/1902.01046
- McMahan et al., "Communication-Efficient Learning of Deep Networks from Decentralized Data", AISTATS 2017: https://arxiv.org/abs/1602.05629
- Kairouz et al., "Advances and Open Problems in Federated Learning", 2021: https://arxiv.org/abs/1912.04977

Repo files read: `extension/src/content.ts`, `extension/src/background.ts`, `extension/src/features.ts`,
`backend/src/fedad/ml/schema.py`, `backend/src/fedad/ml/model.py`, `frontend/src/phone/client.ts`, `frontend/src/phone/train.ts`,
`backend/src/fedad/web/live.py`.

## Summary

1. A row of "event, 0/1 click label, logistic loss" is the standard format; Criteo, Facebook, Google and YouTube all use it.
2. The user is right that a page view is not an ad impression: no ad is shown, so this models page-click rate by topic, hour and device, not ad CTR.
3. The model and server only need a fixed-length vector and a y in [0, 1]; "one row per page, first click wins" is a convention in `content.ts`.
4. Real defects to fix: `visible_ms` leaks the label, `placement` is constant, `position`/`session_min` reset on page load, schema text says "ad".
5. Cheapest path: rename the concept, fix the leak, then optionally add a Covington-style dwell weight; true ad CTR needs per-element impressions.
