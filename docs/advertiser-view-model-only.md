# Advertiser view when only the global model exists

Question: the extension no longer sends an email or an interest profile, only a clipped, locally noised model update to
`POST /v1/updates`. What can the advertiser console legitimately show? Written 2026-11-20. External claims carry a URL;
anything not confirmed from a primary source is marked "unconfirmed". Repo facts were read from the code on branch `admin-ui`.

## Short answer

- Yes, a model-only advertiser console is coherent and defensible, as long as it is described as what it is: **model-level
  results (predicted click rate by category, hour, device, placement), not matched people and not measured lift**.
- Without the email join there is no conversion-to-impression linkage, so there is **no measured conversion, no lift, and no
  split-model training**. "Predicted conversion by interest segment" cannot be produced any more.
- The numbers that remain are a **predicted CTR** from the horizontal model. They are post-processing of a model whose only formal
  guarantee is the per-device local DP on each update (README: epsilon in the thousands). Reading the model many times costs no
  extra privacy budget; the budget is spent at upload time.
- Real systems that keep identity out (Attribution Reporting, DAP, Mozilla/W3C Privacy-Preserving Attribution) all give the
  advertiser **aggregate histograms with noise and a minimum batch size**, never rows. That matches the model-only design.
- Do not describe the min-cohort threshold as protecting people in a model-only console: there is no cohort of people any more.
  The honest threshold is "number of contributing devices".

## What the repo depends on today

| Item | File and name | What it needs | State now |
|---|---|---|---|
| Profile intake | `backend/src/fedad/web/vertical_api.py`, `POST /v1/platform/profile` (`post_profile`, `ProfileBody`) | Bearer device token, `email` plus 14-number noised profile; stored in in-memory `PROFILES` keyed by device id | **No caller.** `grep` finds no `platform/profile` in `extension/src` or `frontend/src`. Only `backend/tests/test_vertical_api.py` posts to it. The endpoint is still open to any registered device and still accepts emails. |
| Profile policy | `GET /v1/platform/policy` (`policy`, `PROFILE_SIGMA=0.3`) | none | Unused by the extension. |
| Profile builder | `extension/src/features.ts`, `buildProfile` | events | Dead code (defined, never imported elsewhere). |
| Advertiser labels | `vertical_api._advertiser_table` | `shop.USERS` (emails, `orders`) from the phone shop `web/shop.py` | Still filled if someone uses the phone shop. In memory only. |
| PSI | `vertical/psi.py` `psi.run(emails_a, emails_b)` (Diffie-Hellman PSI) | two email lists | `emails_a` is always empty, so it never runs. |
| Split model | `vertical/split.py` `split.train` | aligned rows `Xa` (profile) and `y` (order) | Never reached. |
| Run | `POST /api/b/vertical/run` (`run_vertical`, `_run`) | `PROFILES` and shop table | Returns `status: "waiting"` with the note "Needs people who ... sent their interest profile ..." (`_run`, first branch). |
| Status | `GET /api/b/vertical` (`get_vertical`) | `PROFILES`, shop table | Returns `platform_profiles: 0`, `last: null` or the waiting note. |
| Min cohort | `FEDAD_MIN_COHORT` (default 10; `.env.example`, `render.yaml`), read as `MIN_COHORT` in `vertical_api.py` | Used in three places: overlap < MIN_COHORT gives `too_small`; segment with n < MIN_COHORT gives `people: null`; echoed to the console. | Affects only the vertical path. **Nothing in `live.py` uses it**, so the horizontal `insights()` has no threshold. |
| Segment output | `_run`, `_laplace_rate` (eps 1.0 per rate, counts rounded to 5) | per-person scores inside `_run` | Unreachable. |
| Console | `frontend/src/advertiser.tsx` (`Console`), `frontend/advertiser.html` | calls only `/api/b/vertical` (5 s poll) and `/api/b/vertical/run`; header notice says "match the two groups by private set intersection" | Permanently shows counts and the waiting notice. Cards "Matched (overlap)", "Train across both parties", "Predicted conversion by platform interest segment" can never fill. |
| Access control | `web/app.py` (lines near 159-175): `/api/b/*` allowed for admin, role `advertiser`, or `FEDAD_OPEN_ADMIN=1`; `/api/live` is admin only (test: advertiser gets 403 on `/api/live`) | | Still correct. |
| Global model | `web/live.py`: `GET /v1/model` (no token check), `Campaign.insights()` (predicted CTR from weights alone: `by_category`, `by_hour`, `by_device`, `by_placement`, `grid`), `Campaign.ledger()` (per-device epsilon spent) | | **Works**, but only reachable by admin through `/api/live`. The advertiser role cannot call it. |

What breaks now: everything on the advertiser page except the two counts. `advertiser_customers` still counts shop accounts;
`platform_profiles` is permanently 0.

What still works with only the global model: `Campaign.insights()` (predicted CTR by category, hour, device, placement and the
category by hour grid), model `version`, `n_updates`, the noise level `noise_sigma_per_upload`, and the privacy ledger. None of it
needs identity.

Stale text found:

- `README.md` line 44: "Vertical FL (PSI plus split model): `backend/src/fedad/vertical/`, service in `web/vertical_api.py`" reads as a working feature.
  The README extension section (lines 49-55) is already correct (clipped, noised update only).
- `README.md` line 43 and `docs/demo_checklist.md` line 4: "The advertiser sees only group results." True, but the group
  results now do not exist.
- `docs/demo_checklist.md` line 84: "The advertiser-matching profiles and shop accounts are not saved ..." refers to profiles the extension no longer sends.
- `vertical_api.py` module docstring: "Party A side, called by the browser extension" is no longer true.
- `advertiser.tsx` notice and `released` text describe PSI matching.
- `backend/.env.example` and `render.yaml`: `FEDAD_MIN_COHORT` only affects dead code.
- The README "What is built" table does not list the vertical module at all, so it is neither claimed nor marked "not working".

## What primary sources say

### 1. Which aggregate outputs are defensible

- Every deployed or specified privacy-preserving measurement system releases a **noised aggregate histogram and refuses small
  batches**. The W3C Privacy-Preserving Attribution draft (Working Draft, 9 November 2026) says the aggregation service "adds the
  histograms, including sufficient noise, to produce a differentially-private aggregate histogram"; reports are histogram
  contributions; each site has a per-epoch budget and the default epsilon per conversion report is 1.0.
  https://www.w3.org/TR/privacy-preserving-attribution/ (the numeric minimum-batch value was not in the part read: unconfirmed).
- DAP: collection is refused when a batch has too few reports ("MUST NOT fulfill any jobs with an insufficient number of
  validated reports"), and a batch can be collected once. https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/ (section 4.6).
  Noise is added by the Aggregators, not clients or collector (section 8.5, same URL).
- Google Attribution Reporting summary reports: "Noise is added to most data points". The recipient is the ad tech, who gets
  aggregated figures. https://privacysandbox.google.com/private-advertising/attribution-reporting/summary-reports
- Private Join and Compute (the PSI route) reveals only intersection size and intersection-sum; its README warns that very small
  intersections and outlier values leak, and lists thresholds, outlier pruning and DP noise as mitigations it does **not**
  implement. https://github.com/google/private-join-and-compute

Applied here:

- Per-category predicted CTR from the global model: meaningful as a **model property**. It is a function of the released weights.
  It says "the model, trained on contributing devices, predicts X for this category", not "X percent of people click".
- Cohort-level lift: **not defensible** without exposed-versus-unexposed outcome linkage (see 2).
- k-thresholds: DAP and PPA enforce them on batches of **reports**. The analogue here is the number of distinct contributing
  devices and uploads behind the current model (`n_updates`, devices with `uploads > 0`). Show "not enough contributors yet"
  below a floor.
- Noise on aggregates: for model outputs it is not needed for privacy (post-processing, see 3) and would only add error. The
  noise that matters is already inside each update (`noise_sigma_per_upload`).

### 2. What is lost without the email join, and what remains

Lost:

- **Conversion-to-impression linkage.** The shop holds `orders` per email; the platform side holds exposure and interest.
  Only the join connects them. This is exactly the problem PJC and the Google deployment paper solve with PSI: two parties
  hold identifiers, one holds values, they learn the intersection size and the sum of values for shared users.
  https://eprint.iacr.org/2019/723 (Ion et al.) and https://github.com/google/private-join-and-compute
- **Lift measurement.** Needs exposed and control groups with outcomes. No outcomes reach the model-only pipeline.
- **Split-model training** (`vertical/split.py`): needs aligned rows (PSI output) so that party A's embedding and party B's label
  refer to the same person.

Still works:

- Horizontal FL: FedAvg-style training from on-device data, with the data staying on the device.
  https://arxiv.org/abs/1602.05629 (McMahan et al. 2017).
- Predicted CTR by feature group, because the model is trained on the click label that the device itself observes. No second
  party is needed. This is the design of `Campaign.insights()`.
- Browser-mediated alternatives exist for conversion measurement without email: the browser links click and conversion on-device
  and emits a limited report. Apple Private Click Measurement allows an 8-bit source ID and a 4-bit trigger value, reports
  delayed 24-48 hours, no cookies. https://webkit.org/blog/11529/introducing-private-click-measurement-pcm/ This would need a
  different client (a site-integrated one), not the current extension.

### 3. Is a global-model-only console coherent? Caveats for reviewers

Coherent: the server holds only the noised updates and the global model (`live.py` docstring), and `insights()` is "computed from
the model weights alone".

Caveats to say out loud:

- **Local DP, per device, on the update only.** The formal guarantee is per-device (epsilon, delta) for the noised update, Renyi
  accounting (README "Honest limits"). Local DP is the strong-trust-model option; the cost is utility. The theory of what local
  algorithms can learn is in Kasiviswanathan et al., https://arxiv.org/abs/0803.0924 . Central DP on aggregated updates (user-level DP
  federated averaging) loses far less accuracy but needs a trusted aggregator:
  https://arxiv.org/abs/1710.06963 (McMahan et al. 2018). Here the server sees each noised update before aggregation
  (`Campaign.submit` keeps `uploads` with the vector, last 40, visible to admin), so it is local DP, not secure aggregation.
- **Epsilon in the thousands.** README measures useful AUC only at total epsilon of roughly 1 000 to 10 000. State it. A
  large epsilon bounds membership inference only weakly.
- **Model inversion and membership inference.** Models can leak training records to black-box queries:
  https://arxiv.org/abs/1610.05820 (Shokri et al. 2017). With DP the leakage is bounded by epsilon; with a weak epsilon the bound is
  weak. The model here is a 430-parameter logistic model over category, hour, device and placement features, which is low capacity,
  but `GET /v1/model` is unauthenticated, so anyone, not only the advertiser, can read the weights. Reviewers should know that the
  advertiser view adds no exposure beyond what is already public.
- **Small cohorts.** With `MAX_DEVICES = 60` and few uploads per device, a category's weight can be dominated by one device's
  noised update. The threshold must be on contributors, not on category names. DAP's min batch size is the same idea.
- **Post-processing and repeated queries.** DP is closed under post-processing: any function of the released model has the same
  guarantee (Dwork and Roth, "The Algorithmic Foundations of Differential Privacy", section 2.3, https://www.cis.upenn.edu/~aaroth/Papers/privacybook.pdf;
  the exact statement was not re-read in this session, unconfirmed). So refreshing the console costs no budget, and the budget is
  consumed only by uploads (`ledger()`: `eps_spent` against `eps_total`, `max_uploads`). The risk is the opposite one: the advertiser
  can watch the model **between** uploads and difference consecutive versions to isolate one device's update. With `buffer_k = 1`
  (the default) every upload moves the model. Raise `buffer_k`, or publish only at version steps with at least k new devices.
- **Per device is not per person.** One user on several installs spends several budgets (README states this). Registration is open
  (30 per hour per address), so Sybil updates can also steer the model.
- **Predicted is not measured.** A CTR from a model trained on noised updates is a modelled estimate with large error when few
  devices contributed. The console must not show it as an observed rate.

### 4. Comparison with real systems (status checked 2026-11-20)

| System | What the advertiser or ad tech gets | Identity join? | Noise and thresholds | Status |
|---|---|---|---|---|
| Google Attribution Reporting and Aggregation Service | Event-level reports and aggregated summary reports | No cross-site id; browser links on-device | Noise on summary reports, https://privacysandbox.google.com/private-advertising/attribution-reporting/summary-reports | Retired. Announcement 2025-10-17 (https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies). Status page updated 2026-11-18: Attribution Reporting web, Aggregation Service, Private Aggregation and Topics web "Deprecated and removed from Chrome"; Android "Scheduled for phaseout" (https://privacysandbox.google.com/overview/status). Some docs pages still read as live. |
| W3C Privacy-Preserving Attribution (successor of IPA) | Differentially private aggregate histogram | No; browser holds impression and conversion | DP noise by aggregation service; weekly epochs, per-site budgets, epsilon 1.0 default | Working Draft 9 November 2026 (https://www.w3.org/TR/privacy-preserving-attribution/). The IPA repo says IPA "has been superseded" by it (https://github.com/patcg-individual-drafts/ipa). Not a Recommendation. |
| IETF DAP | Aggregate of many reports, two non-colluding aggregators | No | Min batch size; batch collected once; aggregators add noise (8.5) | draft-ietf-ppm-dap-20, 21 October 2026, Internet-Draft, WG state "Waiting for Write-Up", not an RFC (https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/). |
| Mozilla PPA in Firefox | Single bounded histogram, DP noise, via DAP and Divvi Up | No | DP noise per share | Origin-trial prototype, August 2024 (https://blog.mozilla.org/netpolicy/2024/08/22/ppa-update/). A search summary said Mozilla's support page now describes it as removed; the page would not load here: **unconfirmed** (https://support.mozilla.org/kb/privacy-preserving-attribution). |
| Apple Private Click Measurement | One tiny report per click-conversion pair | No | Bit limits, 24-48 h random delay, 7-day expiry; the post does not mention noise thresholds or DP | Shipped in WebKit (https://webkit.org/blog/11529/introducing-private-click-measurement-pcm/). Current status not rechecked. |
| Private Join and Compute | Intersection size and intersection-sum | Yes, by PSI | Not implemented: README says thresholds and noise are optional mitigations | Not an officially supported Google product (https://github.com/google/private-join-and-compute); deployment paper https://eprint.iacr.org/2019/723 |
| Federated learning in general | A model, not records | No | Per-system | https://arxiv.org/abs/1602.05629 (FedAvg); https://arxiv.org/abs/1912.04977 (Kairouz et al., survey; the abstract fetched says FL "embodies the principles of focused data collection and minimization", I did not read its DP and attack chapters in this session) |
| FLoC | Cohort id per user | | | Not rechecked: unconfirmed |

Reading it: the real systems have the **opposite** shape to FedAd. They keep a conversion signal (browser-side linkage) and
release only a noised histogram. FedAd's model-only mode keeps the model and has no conversion signal. FedAd's remaining output
is closer to a federated model audit than to attribution; it should not borrow the word "attribution" or "lift". Flower is not
relevant to this question and was not consulted.

## Recommendation: what the advertiser console should show in a model-only design

1. **Add one advertiser endpoint**, for example `GET /api/b/model`, returning a reduced copy of `Campaign.insights()`: predicted CTR by
   category, hour, device, placement, plus `version`, contributor count, and noise level. Keep `/api/live` admin-only. Do not
   return `uploads`, `vec`, per-device ledger rows or weights.
2. **Gate it on contributors.** Show "not enough contributors yet" until a floor (reuse `FEDAD_MIN_COHORT`, now meaning distinct
   contributing devices, and move the read into the new endpoint) and publish a new version only after at least that many new
   devices (`buffer_k`), to blunt differencing between versions.
3. **Label the numbers honestly:** "predicted click rate from a privately trained model", with the epsilon, delta, and
   `noise_sigma_per_upload`, and the number of contributors. Show a wide uncertainty note while contributors are few.
4. **Remove, or hide behind a flag, everything that implies matching:** the overlap metric, the "Train across both parties" card,
   the segment-conversion card and the PSI notice in `advertiser.tsx`; stop mounting `vertical_api.router` or at least
   `/v1/platform/*`, since `post_profile` collects emails and has no client. Keep `vertical/` and its tests as a documented
   offline demonstration of vertical FL if the seminar needs it, labelled "not wired to the extension".
5. **Do not add** noise on top of model outputs (no privacy gain, post-processing), per-person or per-email views, or any lift
   figure.
6. **Update the text:** README line 44, `demo_checklist.md` lines 4 and 84, `vertical_api.py` docstring, and say in the README
   honest limits that the advertiser sees a model, not outcomes.
7. If conversion measurement is wanted later, the primary-source route is browser-side linkage with a noised histogram (PPA
   or PCM style), or PSI with thresholds and noise (PJC style) between two consenting organisations; both need new client or
   data inputs.

## Summary

1. A model-only advertiser console is coherent and defensible if framed as predicted CTR from a DP model, not matched people or lift.
2. Without the email join there is no conversion linkage, no lift, and no split-model training; `vertical_api.py` and `advertiser.tsx` now only ever show "waiting".
3. Real systems (W3C PPA, DAP, PCM, Attribution Reporting) release noised aggregates with minimum batch sizes; Attribution Reporting and Aggregation Service are deprecated and removed from Chrome as of 2026-11-18.
4. Reviewer caveats: local DP at epsilon in the thousands, public `GET /v1/model`, tiny contributor counts, differencing between model versions, per-device not per-person budget.
5. Build a reduced `/api/b/model` from `Campaign.insights()` gated on contributor count, hide the PSI cards, and fix the stale README, checklist and docstring lines.
