# Settlement Recovery Sizing — Credit.com / Lexington Law Base

Working draft for the credit.com report, 2026-06-10. All cohort counts are measured
against the corrected (rederive v2) data — either the production casepeople sharded
index or direct creditor-pattern scans of cr_db (135.9M LEX + 18.4M CCOM tradelines).
Counts are **matchable ceilings** (people with the qualifying creditor relationship),
not confirmed class members; each class definition narrows by date window, product,
state, or an event (call received, breach notice, theft) per the tier label.

Tier 1 = our fields directly satisfy the class-definition elements.
Tier 2 = our fields establish the plausible pool; the gating fact needs attestation
or an administrator/defendant-records match.

## Bucket A — already settled, frictionless path to payment

| Defendant | Case / fund | Pay mechanics | Cohort in file | Tier | Report angle |
|---|---|---|---|---|---|
| Capital One | 360 Savings interest, $425M | Automatic, checks/electronic ~Jul 21 2026 | 1,712,966 (any Cap One relationship; deposit accounts invisible to credit data) | 2 | Tell members: payment comes automatically; verify address. Outreach = service touch, zero filing cost |
| Navient | CFPB redress, $120M | Checks mailing since Feb 13 2026, no claim | 451,340 (servicer tradelines) | 1 | Same — address-currency campaign to a directly identified cohort |
| Bank of America | 7-Eleven/FCTI ATM fees, $2.25M | Current customers auto-credited; former must file by 6/29/26 | 333,611 (BofA relationship) | 2 | Event (double balance-inquiry fee 2018-2021) not in file; alert + simple attestation claim for former customers |
| Midland Credit Mgmt | Leedeman (CA), automatic | No claim form; optional digital-pay election | 241,303 national; CA subset ≈ 9% of file → ~22K | 1 | CA members with MCM collections get paid without acting |
| National Credit Adjusters | Blackburn (VA) | Automatic debt cancellation + tradeline deletion | NCA collections cohort (indexed) ∩ VA | 1 | Relief shows up on the credit report itself — natural credit.com story |

Bucket A summary for the report: roughly **2.7M+ people in the file hold a relationship
with a defendant whose settlement is paying out with no claim form**. The product here
is awareness + address verification, not intake.

## Bucket B — open claim window, filing workflow we run

| Defendant | Fund / per-claimant | Deadline | Cohort ceiling (measured) | Tier | Notes |
|---|---|---|---|---|---|
| PHH (Munoz, RESPA captive-reinsurance) | **$875/loan fixed, no pro-rata cut** | 2026-08-11 | **4,180 LEX + 1,624 CCOM with PHH mortgage opened 2007-2009** (29.7K LEX + 14.6K CCOM any vintage) | **1** | Cleanest case in the sweep: ~$5.1M claim ceiling; captive-reinsurance element confirmed by administrator list. Highest priority |
| Flagstar (2021 breaches, $31.5M) | ~$60 base up to $599; $25K documented; +$100 CA | 2026-08-11 | 24,158 LEX + 14,260 CCOM Flagstar tradelines | 2 | Claim ID from notice required — workflow includes administrator lookup. ~38K pool vs 2.19M class |
| Comcast/Xfinity (2023 breach, $117.5M) | $50 base; $10K documented | 2026-08-14 (poss. 9/14) | Creditor match negligible (5.5K); play = national incidence ~31.6M/260M adults ≈ 12% of any base | 2 | Email-base campaign with attestation; Kroll admin, no-proof base tier |
| Hyundai/Kia theft (multistate $4.5M + $9M) | $375–$4,500 | 2027-03-31 | 44,385+15,530 Hyundai; 54,466+15,386 Kia finance relationships (~130K gross) | 2 | Needs 2011-2022 turn-key model + theft/attempt after 4/29/25 (police/insurance docs). Long window — durable pipeline item |
| Hy Cite / Royal Prestige TCPA ($4.75M) | **$600–$1,000 est. per claimant** | 2026-07-08 | No creditor signal (non-customer class) — phone-number base enables admin dialer matching | 2 | Highest per-claimant cash in the sweep; pure attestation claim |
| LastPass (2022 incident, $24.45M) | $25–$10,400 (+crypto pool) | 2026-07-02 | No credit-data signal; email-base play | 2 | Notice-gated |
| Genesis/Concora (Ford, MD) | varies | 2026-06-29 | milestone genesis cohort ∩ MD | 1 | Mailed PIN required |
| Athena Bitcoin TCPA ($4.5M) | share of fund | 2026-06-30 | Phone-base play | 2 | Class Member ID gated |
| Amazon Prime FTC redress | up to $51 | 2026-07-27 | Universal email-base play | 2 | No-proof claim |
| Lakeview Loan Servicing ($26M) | pro rata + $5K documented | 2026-06-22 | **~200 — name collisions only; subservices via LoanCare so not a reporting creditor** | 2 | Deprioritize: tiny window, no matchable signal |
| Register.com TCPA (~$2,130/number) | ~$2,130 | 2026-06-15 | Reassigned-number class — would need phone-number xref vs FCC RND | 2 | 5 days out; skip unless trivial |

## Bucket C — mass arbitration (rolling)

Exeter Finance: 235,993 people with Exeter auto tradelines (Tier 1 relationship match);
undisclosed-fee theories pursued per person, no deadline.

## Bucket D — structural / recurring defendants (origination, not settlement-chasing)

Corrected v2 cohorts (replaces the inflated numbers in the earlier HTML draft, which
came from the pre-audit data and must not be reused):

| Defendant | v2 cohort | Old HTML figure | Basis |
|---|---|---|---|
| Capital One | 1,712,966 | — | all case types |
| Santander Consumer | 556,939 | — | subprime auto / repo practices |
| Synchrony Bank | 549,694 | 1,760,880 | TCPA collection calls |
| Navient | 451,340 | 493,042 | servicer misconduct + TCPA |
| Credit One Bank | 403,156 | 1,340,202 | TCPA + FDCPA recurring |
| Wells Fargo | 392,187 | 801,003 | TCPA collection robocalls |
| Bank of America | 333,611 | — | fees / TCPA history |
| Midland Credit | 241,303 | ~250,000 (w/ ERC) | FDCPA perennial |
| Exeter Finance | 235,993 | — | mass arb |
| Westlake Financial | 200,689 | — | FDCPA/repo (Klare closed 5/18/26) |

## Honest-numbers funnel (carry into the report)

Ceiling (creditor relationship) → contactable (99% LEX have phone/email + consent,
minus ~800K DNC and ~200K email opt-outs) → class-window fit (dates/state/product)
→ gating event (call/notice/theft, Tier 2 only) → filed claim. Size the channel on
screened conversion, not the ceiling. The CCOM book (1.4M, currently open customers,
consent + phone-auth flags) is the live outreach channel; the LEX book (8.85M, 98.5%
closed accounts) is reach with consent timestamps but needs suppression-list scrubbing
and a re-permission pass for anything telemarketing-shaped — note the PGX entities'
10-year telemarketing-credit-repair ban context when designing outreach.
