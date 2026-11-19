# Seminar guide (CRCE Course Seminar Sem VII, ESE 21 Nov 2026, offline)

Rubric (50 marks) and where this repo gives evidence for each. Benchmark numbers: real Criteo click data, 20 simulated clients,
15 rounds, 5 seeds, mean and 95 percent CI. The live demo uses real phones (see `phone_demo.md`).

| Rubric item | Marks | Evidence |
|---|---|---|
| Relevance, industrial applications, future scope | 6 | Ad admin console: Campaign, Insights, Benefit tabs; DPDP Act 2023 / GDPR framing; "NOT IMPLEMENTED" list in README (future scope) |
| Analysis, critical evaluation, technical depth | 10 | Renyi vs basic accounting (`privacy/rdp.py`, cross-checked against Google `dp-accounting`); 5-seed CIs and paired differences; centralised baseline; honest-limits section; two paper claims checked (eq. 7 arithmetic, eq. 9 sign) |
| Modern tools, simulations, demos | 4 | Live phone demo (web app, real federated client, wire format tested against Python), Flower 1.44 runtime (parity-tested), FastAPI + React console, real Criteo data |
| Societal, ethical, environmental, SDGs | 6 | Consent screen on the phone; "Responsible AI" tab; section below |
| Completeness and quality of seminar work | 6 | 56 fast tests plus a slow Flower test; every paper section marked built or not built |
| Written report | 12 | Figures and tables in `backend/results/figures` and `tables`; chapter map below |
| Oral presentation and questions | 6 | Five-minute demo script in `phone_demo.md`; Q and A below |

## Results to quote (all from `backend/results/`)

- **No accuracy cost without noise.** Federated 0.693 +/- 0.014 AUC against 0.689 +/- 0.019 for pooling every raw impression.
  The centralised model is a plain regularised logistic regression, not a tuned ceiling, so say "no measurable cost", not "better".
- **Privacy costs accuracy, a lot, on real data.** Local DP, Renyi accounting: AUC 0.687 at total epsilon 10 000, 0.647 at 1 000,
  0.601 at 300, 0.563 at 100 (chance is 0.5). A useful AUC needs epsilon in the thousands, which is a weak formal guarantee. Say so
  before you are asked.
- **The tighter accountant helps.** For the same (epsilon, delta), Renyi needs 0.49 times the noise of basic composition at
  epsilon 100 and 0.75 at 1 000. Paired AUC gain: 0.022 +/- 0.004 at 100, 0.029 +/- 0.003 at 300, 0.019 +/- 0.003 at 1 000,
  shrinking to 0.001 at 10 000. Basic accounting at epsilon 10 000 is only epsilon 8 282 in Renyi terms: the sum was loose.
- **Secret sharing and Paillier HE do not change the model** (0.693, identical) but Paillier at 1024 bits costs about 5 times the
  time (26.7 s against 5.6 s per run).
- **Top-50 sparsification:** upload 0.834 to 0.189 KB (4.4 times smaller) for 0.008 AUC.
- **Async buffered training** is easier on slow clients but scores 0.649, about 0.04 below synchronous.
- **Flower and the native engine produce identical weights** (max absolute difference 0.0).
- **The phone client matches the backend**: wire bytes, local training (within 1e-9) and privacy accounting (within 1e-6) are
  checked by `backend/tests/test_phone_wire.py`.

## Report chapter map (template in Downloads: at least 15 pages, own words, cite everything)

1 Introduction: ad personalisation vs privacy; FL; DP. 2 Literature review: the arXiv 2507.12098 paper, FedAvg (McMahan 2017),
DP-SGD (Abadi 2016), analytic Gaussian (Balle and Wang 2018), RDP (Mironov 2017), secure aggregation (Bonawitz 2017), Paillier
(1999), FedBuff (Nguyen 2022), Flower (Beutel 2020), the Criteo dataset. 3 Gap: the paper gives no code or data; loose
composition; no cost of local DP on real CTR data. 4 Proposed approach: three-layer pipeline, `Client / Edge / Setup`, RDP
accounting, the phone client and admin console. 5 Comparative analysis: the techniques table and figures. 6 Advantages and
limits. 7 Applications, challenges, future scope. Appendix: reproduction commands.

Cite the real papers yourself and check each reference exists before it goes in. Do not paste text from this repo or the paper:
the report is plagiarism-checked. Cite Criteo (Criteo AI Lab, 1TB click logs, CC BY-NC-SA 4.0) wherever its results appear.

## Societal, ethical, environmental

- **Data minimisation, shown not claimed:** raw taps stay on the phone; the admin's activity feed shows only a device number, a
  byte count and a model version. Relevant to DPDP Act 2023 and GDPR Art. 5(1)(c).
- **Consent:** the phone app lists exactly what is recorded and what leaves before joining; the user can view, delete and leave.
- **What the guarantee does not cover:** the impression count and loss values sent with each update, who participates, one person
  on several devices. And the epsilon needed here is in the thousands.
- **Fairness:** clients differ (click rates, feature mix); DP noise hurts small clients more; not measured here.
- **Environment:** less upload with sparsification, but at this model size the absolute saving is a few KB; do not claim a carbon number.
- **SDGs, modestly:** SDG 9 (privacy-preserving infrastructure), SDG 16 (privacy as a right, accountable institutions), SDG 10
  (less concentration of personal data), SDG 12 (responsible use of personal data in commerce).
- **Dataset licence:** Criteo is non-commercial; this project is a course seminar.

## Likely viva questions

1. *Is this the paper's result?* No. The paper has no code or data; the README says so. This is a reference implementation plus
   measurements the paper does not have.
2. *Why is epsilon so large?* Local DP, 20 clients, 15 releases each, a 430-parameter model; noise cannot be averaged away. The
   curve shows where utility returns. Real data confirms it.
3. *Why does RDP help?* Basic composition adds epsilons; Renyi divergence of the Gaussian mechanism adds linearly in the order and
   converts to (epsilon, delta) more tightly. Same mechanism, better proof; no subsampling assumed.
4. *Is secret sharing needed with DP?* Different threats: DP bounds what an output reveals about one client; secret sharing hides
   individual updates from the cloud. Edges still see noised updates (trusted).
5. *Why Flower?* Standard runtime for the round lifecycle; the same client and edge code runs natively and under it, and the parity
   test proves they agree. A multi-machine Flower deployment is not done.
6. *Is Criteo federated?* No: the data are not partitioned by user. Clients are simulated by hashing an anonymised column; say so.
7. *Why a separate phone model?* Criteo's columns are anonymised hashes a phone cannot produce. The phone uses features it can
   measure; the benchmark evaluates the same method on real click data.
8. *What would you do next?* Real multi-user data, a membership-inference audit of empirical leakage, client subsampling,
   a native client, HTTPS and device attestation.

## Removed from scope on purpose

Poisoning, attackers and defence (Krum, anomaly filter) remain in the code (`aggregation/robust.py`, paper section 3.4) but are not
part of the experiments, figures or dashboard: this seminar's focus is privacy.
