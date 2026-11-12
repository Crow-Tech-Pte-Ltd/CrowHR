# sg-rules verification record

Last updated **31 Oct 2026**. This file records how the numbers in `src/tables/` and the test vectors were checked, every disagreement between the research (`research/sg-*.{md,json}`) and the independent verification (`research/verification/statutory-data-review.md`), and how each one was resolved. It is not legal advice.

## How the data was checked

| Check | Result |
| --- | --- |
| CPF rate Tables 1–5 for 2025, 2026, 2027 (15 tables × 5 age bands × 4 numbers) | Machine-compared against the text of the three CPF PDFs (employer-only rate, phase-in coefficient, total and employee rates). 0 mismatches. The 2025 Tables 2–5 were not in the research JSON; they were transcribed from the [2025 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2025_contributionandallocationrates.pdf) by the same script. |
| CPF internal consistency (test) | For every cell: employer-only rate + employee rate = total rate; phase-in coefficient = 3 × employee rate; the phase-in formula equals the full-rate formula at TW = $750. 2026 Table 1 OW maxima equal the PDF's "Max. of $2,960 … $1,000". |
| CPF AW ceiling | All **16** worked examples in CPF's [AW ceiling examples PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) are replayed month by month (≈150 months) with state carried between months as payroll will do. Every month's OW subject, AW subject, total and employee share match CPF to the dollar, including the rehire (Ex. 15), AW paid after leaving (Ex. 7, 8, 9, 13, 14), age-band changes (Ex. 10–14) and the mixed-rate shortfall (Ex. 14: $11,250 / $6,054). |
| Research test vectors | 91/91 pass to the cent (62 CPF, 12 SDL, 17 SHG), after the two fixture corrections below. |
| SDL | 0.25% × $800 = $2 minimum and 0.25% × $4,500 = $11.25 maximum are continuous (test). Start date 1 Oct 2008 from the [SSG SDL FAQ](https://file.go.gov.sg/sdl-generic-faq.pdf) A2–A3. |
| FWL | MOM's published daily rate = ceil(monthly × 12 / 365) for all 26 current rows (test). |
| Working-day calendar | Reproduces all 36 cells of MOM's 2026 incomplete-month table (5, 5.5 and 6-day weeks). |
| Effective ranges | Every rule family has contiguous `[effectiveFrom, effectiveTo)` rows from the engine coverage start (1 Jan 2025) with an `https` source, no gaps or overlaps (test). |

Coverage of `src/` (excluding tests and fixtures): **99.6% lines**, 97.9% branches (`bun run coverage:sg-rules`; `bun run check` fails below 95% lines).

## Disagreements and resolutions

| # | Item | Research said | Verifier said | Resolution in this package | Source |
| --- | --- | --- | --- | --- | --- |
| 1 | AW date semantics | AW regime keyed to the month AW is **paid**; SPR conversion: AW subject if paid on/after SPR date | Key to the **due and payable** date | Adopted the verifier's wording. `awCents` is "AW due and payable in the contribution month"; `CpfAwPayment.payableMonth` keys each AW's rate table and ceiling year. In an SPR conversion month the engine raises `CPF_SPR_CONVERSION_MONTH` telling the caller to pass only OW from the SPR date and AW payable on/after it. Whether AW *payable* in one year but *paid* late in the next changes the rate table is still unverified (see open questions). | [CPF AW examples p. 1](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE), [CPF SPR FAQ](https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status) |
| 2 | AW ceiling vs headroom | One formula: ceiling − OW − AW already subject | Separate the annual AW ceiling from remaining headroom; never negative newly subject AW; model excess/refund | Adopted. `awCeiling.annualAwCeilingCents` (= $102,000 − annual OW subject, floored at 0) is separate from `headroomBeforeCents`/`headroomAfterCents`. Earlier AW is re-allocated chronologically. A shrinking ceiling yields `priorAw.excess` + a `CPF_AW_EXCESS_REFUND` warning (refund on application to CPF, never netted or deducted); a growing ceiling yields `priorAw.shortfall` at the rates of the month each AW was payable. | [CPF wages page](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions) |
| 3 | Low-wage month with capped AW | Apply the phase-in formula to subject TW and warn | Can produce negative CPF; refuse | Adopted, and widened. When the pre-cap TW is in the "> $50 to $750" bands and part of the AW is above the ceiling, `computeCpf` returns `ok: false` with blocking issue `CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED` (for the current month and for re-subjecting AW of such a month). I re-read CPF's AW examples PDF: example 16 covers only TW > $750; no official rule exists for the low bands. | [CPF AW examples, ex. 16](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) |
| 4 | Vector AW-11 | June AW paid $40,000; SDL $11.25 | June AW paid is 0; the $40,000 is earlier AW re-subjected; SDL $3.75 | Agreed after re-reading example 7 (June row: AW paid "0", AW subject 40,000). **Fixture corrected** in `src/__fixtures__/sg-test-vectors.json`: `awPaidCents: 0`, real Feb–May AW history, `ytdOwSubjectCents: 4,000,000`, last month June. Expected CPF totals unchanged ($15,355 / $8,300 / $7,055), now split into current month ($555 / $300 / $255) and prior-AW shortfall ($14,800 / $8,000 / $6,800); SDL $3.75. The research copy is untouched. | [CPF AW examples, ex. 7](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) |
| 5 | Vector SPR-04 | Rate table "2028:T1" | 2028 tables are not published; it is 2027:T1 carried forward | **Fixture corrected** to `2027:T1` with `ratesAssumedCarriedForward: true`. For months from 1 Jan 2028 the engine uses the 2027 tables, sets `ratesAssumedCarriedForward` and raises warning `CPF_RATES_ASSUMED_CARRIED_FORWARD`. It never claims a 2028 table exists. | [2027 tables](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf) |
| 6 | SDL history, zero wages, exemptions | One row from 1 Jul 2026; minimum always applies; only domestic workers exempt | Row from 1 Oct 2008; zero SDL when no wages paid or payable; student exemptions | Adopted all three, after reading the SSG FAQ myself: rows `[2008-10-01, 2026-07-01)` (SSG) and `[2026-07-01, …)` (SWDA), same parameters. `totalWagesCents = 0` → not liable, $0 (FAQ D4). `SdlExemption` covers the domestic-worker exclusion, no service in Singapore, approved-institution training, overseas tertiary training ≤ 6 months, and school-holiday students (FAQ C1 / Exemption Order 2014). | [SSG SDL FAQ](https://file.go.gov.sg/sdl-generic-faq.pdf) |
| 7 | Overtime hourly rate | Exact $13.6364/h, round the final amount (gives $40.91) | Reproduce MOM's published $40.80 | Re-read the [MOM page](https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days): "capped at the salary level of $2,600, or an hourly rate of $13.60"; the only worked example is $13.60 × 1.5 × 2 = $40.80; no rounding rule. Default `MOM_PUBLISHED_CAP`: exact hourly basic rate, but non-workmen never above $13.60 (so $2,600 → $40.80, and $2,599 is not paid more than $2,600). Option `EXACT_FORMULA` ($40.91) is labelled an employer enhancement. Workmen are uncapped. Final amounts round half up to the cent (no published rule). | MOM (left) |
| 8 | Part-time leave pro-ration | Fixed 44 h/week, 8 h/day | Use the comparable full-timer's actual hours | Part-time **leave in hours is not implemented** here (handoff). `hourlyBasicRate` takes the employee's contractual `weeklyHours`. | [MOM part-time leave](https://www.mom.gov.sg/employment-practices/part-time-employment/leave) |
| 9 | Interval semantics | Inclusive `[from, to]` (work-pass rows exclusive) | Make one convention explicit | Every row in `src/tables/` is half-open `[effectiveFrom, effectiveTo)`. Tested at 31 Dec 2026 / 1 Jan 2027 (CPF tables, holidays), 31 Dec 2025 / 1 Jan 2026 (OW ceiling) and 30 Jun / 1 Jul 2026 (SDL). | — |
| 10 | Parental leave | Stillbirth branches, pre-2024 paternity history and eligibility predicates missing | Encode them | Out of this change's scope: only annual and sick leave are encoded. Listed as a handoff to the leave module with the verifier's sources. | see handoffs |
| 11 | $102,000 annual ceiling start date | "From memory (2016)" | 1 Jan 2016, CPF FAQ | Confirmed; row cites the [CPF OW ceiling FAQ](https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling). | — |

**Disagreement with my own test (not with a source):** CPF's leaver examples (6, 7, 8, 9, 12, 13, 14, 15) estimate the AW ceiling as if the departure were unknown until the last month. The engine projects the estimate only to `employment.lastMonth` when the caller supplies it, which follows the research's reading of Step 1 ("months of expected employment"). The official-example replay therefore reveals `lastMonth` only from the last month onwards. Both approaches converge at the Step 2 recomputation; the payroll design must decide when to record a known leaving month (see open questions).

## Vectors that need a human spot-check in CPF's calculator

These are `DERIVED_FROM_FORMULA` vectors whose arithmetic both the research and the verifier reproduced, but which no one has run through the [CPF contribution calculator](https://www.cpf.gov.sg/employer/tools-and-services/calculators). Each depends on an interpretation of CPF's wording:

| Vector | Why it needs a check |
| --- | --- |
| RD-03 (TW $1,001.34 → total $370) | Rounding on the exact amount ($370.4958) rather than after rounding to cents ($370.50 → $371). |
| RD-04 (age 65–70, TW $1,003 → total $165) | Same: exact $165.495. |
| WB-02, WB-04, WB-06 | Band boundaries at $50.01, $500.01 and exactly $750 (the $750 total of $277.50 rounds up to $278). |
| WB-08 (OW $7,999.99 → employer $1,361) | The employer share comes out a dollar above "17% × wage" because only the total and the employee share are rounded. |
| WB-13 (age 65–70 phase-in, TW $555.55) | Phase-in with fractional cents. |
| SPR-10 (conversion mid-March) | Wage band chosen on the post-conversion OW only. |
| SPR-04 (Feb 2028) | Conditional on the 2027 tables still applying in 2028. Re-check when CPF publishes 2028 rates (usually May). |
| PM-01 | Confirms CPF on a supplied pro-rated wage; the pro-ration method itself is MOM's. |

## Decisions recorded for the payroll design

- **Negative wages are rejected** (`SgRulesInputError`). A backpay reversal or correction recomputes the original month with corrected inputs and diffs the results (`diffCpf`). An overpayment is refunded by CPF on application.
- **Recovering an employee share from later wages** (read from the [CPF Act s 7](https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=pr7-) and CPF's [recovery FAQ](https://www.cpf.gov.sg/service/article/can-i-recover-the-employee-s-share-of-cpf-contributions-from-my-employee-s-salary-if-i-failed-to-deduct-it-earlier), per `research/verification/payroll-choices.md`): the only general route is the AW top-up after the year's AW is reconciled, s 7(9), recoverable until 30 June of the following year (`awTopUpRecoveryDeadline`). Arrears from the employer's own failure to deduct may not be recovered (s 7(6) and the FAQ), except under s 7(6A) for a non-negligent error, which payroll does not support.
- **Retrospective increments** that are decided later are AW of the month paid (CPF FAQ); increments paid late by administrative error are OW of the original months and need a recomputation of those months. The caller classifies; the engine computes.
- **A prior-AW shortfall is rounded separately** from the month's own contribution, as in CPF example 14. The employee share of a shortfall is emitted as its own line with warning `CPF_AW_SHORTFALL_EMPLOYEE_RECOVERY`.
- **SHG with total wages ≤ $50** applies the table and warns; SHG with $0 wages is $0.
- **Rows whose start date is not published** (CDAC, ECF and SINDA tables, the annual and sick leave scales, and several FWL rows) start at the engine coverage date, 1 Jan 2025, marked `effectiveFromBasis: "ENGINE_COVERAGE_START"`. No earlier history is claimed.

## Open legal and design questions

1. CPF calculator spot-check of the vectors above.
2. Whether delayed AW (payable in one year, paid in the next) changes the rate table as well as the ceiling year.
3. Whether a known leaving month should shorten the AW-ceiling projection before the last month.
4. When an approved SPR F/G or F/F election takes effect, and whether it can be reversed. It is stored as `option` + `optionFromMonth`, never inferred.
5. A mid-month SPR → SC change, or SC/SPR → foreigner: CPF tables are chosen per month from the residency passed in. Each AW payment can carry its own `residency` for re-subjection.
6. Low-wage months with capped AW (blocked; needs CPF Board confirmation).
7. OT rounding: no MOM rule; the default reproduces MOM's example.
8. "Days actually worked" for the incomplete-month formula: whether outpatient sick leave and childcare leave count is the caller's policy.
9. Annual leave: whether one unpaid day excludes a whole month of service (`excludedMonths` is the caller's decision).

## Employment Act salary payment, deductions and statutory lookups

Moved from `packages/core` (payroll `rules.ts`, organisation `statutory.ts`) on 31 Oct 2026, with the corrections from `research/verification/payroll-choices.md`. Effective from the engine coverage start (1 Jan 2025); the provisions have not changed since the 2019 amendments.

| Rule | Encoded as | Source |
| --- | --- | --- |
| Salary within 7 days after the salary period (day the period ends not counted) | `salaryDueBy` | [EA s 21(1)](https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr21-), [MOM paying salary](https://www.mom.gov.sg/employment-practices/salary/paying-salary) |
| OT within 14 days after the salary period **in which it was performed** | `overtimeDueBy(otPeriodEnd)` | EA s 21(2) |
| Employer ends the employment: final pay on the last day, or within 3 working days if not possible | `finalPayWorkingDaysWhenEmployerTerminates` (not checked by payroll yet) | MOM paying salary |
| Payment on a non-working day is allowed | not a check | EA s 25(2) |
| Damage or loss ≤ 25% of the period's salary | group `damage_loss` | [EA s 29](https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr29-), MOM salary deductions |
| Accommodation, amenities and services **together** ≤ 25% | group `accommodation_amenities` | [EA s 30(2)](https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr30-) |
| Advance and loan instalments ≤ 25% each | groups `advance`, `loan` | [MOM salary deductions](https://www.mom.gov.sg/employment-practices/salary/salary-deductions) |
| All deductions ≤ 50% of salary, except absence, advances, loans, unearned benefits, overpaid salary and co-operative payments (s 27(1)(a), (c), (f), (j) and loans); employee CPF counts; lifted on final pay | `checkDeductions` | [EA s 32](https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr32-) |
| CSN payment types PTE, AMS, VCT, MSE | `CSN_PAYMENT_TYPES` | [CPF submission number](https://www.cpf.gov.sg/employer/making-cpf-contributions/applying-for-a-cpf-submission-number) |
| One rest day per week | `REST_DAYS_PER_WEEK` | [MOM rest days](https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days) |
| Work pass types | `WORK_PASS_TYPES` (one MOM key-facts page each) | MOM passes and permits |

Not applied, recorded as limitations: Interpretation Act s 50 (a deadline on a Sunday or public holiday moves to the next working day); its interaction with s 21 is unsettled, so the checks may flag one day early.

## Handoffs to other modules (not implemented here)

- **Tax / IR21:** the notice period is **one calendar month** before cessation, not 30 days ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-%28ir21%29/tax-clearance-for-employees)). The S$21,000 exemption also needs its 183-day scenarios.
- **CPF submission:** late-payment interest is floored to whole dollars, minimum $5 ([CPF FAQ](https://www.cpf.gov.sg/service/article/how-does-cpf-board-calculate-interest-on-late-payment)).
- **Leave module:** ~~paternity leave for stillbirth (2 weeks), extra reimbursable paternity weeks only from 1 Jan 2024, SPL excluded for stillbirth, service and citizenship predicates for ECL, infant care and adoption, the NDR 2026 Singapore-citizen restriction, and part-time leave in hours based on the comparable full-timer's actual hours.~~ Encoded in `src/leave/` (see "Leave module rules (WS5)" below).
- **Work passes:** the work-pass salary rows use exclusive `effectiveTo` keyed to pass expiry. Normalise them to `[from, to)` when they are encoded.
- **Platform:** the root `.gitignore` ignores every `data/` directory, so the rule tables live in `src/tables/` rather than `src/data/`.

## CPF calculator check (automated, 31 Oct 2026)

On 31 Oct 2026 the vectors listed under "Vectors that need a human spot-check" and six extra cases were run through CPF Board's public [CPF contribution calculator](https://www.cpf.gov.sg/employer/tools-and-services/calculators/cpf-contribution-calculator) (page "Last updated 03 Aug 2026", includes the January 2027 rates). The runs used headless Playwright (Chromium), one case at a time with a few seconds between them. There was no login, captcha or bot block; the only gate is the Terms of Use checkbox. The calculator takes citizenship status (SC/3rd-year SPR, 1st-year SPR, 2nd-year SPR), birth month and year, contribution rates (G/G, F/G, F/F for SPR years 1–2), contribution month, OW and AW. Engine values come from `computeCpf` with the same inputs (birth date = 15th of the birth month, empty AW history). SPR-04 was skipped because the 2028 rates are not published. The scripts and a screenshot of each result were kept outside the repo.

**Result: 15 of 15 cases match the calculator to the dollar** on total, employee share and employer share. This closes open question 1 for these cases.

| Case | Calculator inputs | What it stresses | Calculator total / employee / employer | Engine total / employee / employer | Match |
| --- | --- | --- | --- | --- | --- |
| RD-03 | SC, born 01/1996, Apr 2026, OW $1,001.34 | $370.4958 rounds down (no pre-rounding to cents) | $370 / $200 / $170 | $370 / $200 / $170 | yes |
| RD-04 | SC, born 01/1959 (65–70), Apr 2026, OW $1,003.00 | $165.495 rounds down | $165 / $75 / $90 | $165 / $75 / $90 | yes |
| WB-02 | SC, born 01/1996, Mar 2026, OW $50.01 | Start of the employer-only band | $9 / $0 / $9 | $9 / $0 / $9 | yes |
| WB-04 | SC, born 01/1996, Mar 2026, OW $500.01 | Start of the phase-in band | $85 / $0 / $85 | $85 / $0 / $85 | yes |
| WB-06 | SC, born 01/1996, Mar 2026, OW $750.00 | Top of the phase-in band; $277.50 rounds up | $278 / $150 / $128 | $278 / $150 / $128 | yes |
| WB-08 | SC, born 01/1996, Mar 2026, OW $7,999.99 | Employer share = total − employee, so $1 above 17% | $2,960 / $1,599 / $1,361 | $2,960 / $1,599 / $1,361 | yes |
| WB-13 | SC, born 01/1959 (65–70), Mar 2026, OW $555.55 | Phase-in band with fractional cents | $62 / $12 / $50 | $62 / $12 / $50 | yes |
| SPR-10 | 1st-year SPR G/G, born 05/1990, Mar 2026, OW $1,700.00 (post-conversion OW only) | Band chosen on the post-conversion OW | $153 / $85 / $68 | $153 / $85 / $68 | yes |
| PM-01 | SC, born 01/1996, May 2026, OW $1,363.64 | Pro-rated wage | $505 / $272 / $233 | $505 / $272 / $233 | yes |
| X-01 | SC, born 01/1969 (55–60), Jun 2026, OW $1,025.00 | Total exactly $348.50 → $349; employee $184.50 → $184 | $349 / $184 / $165 | $349 / $184 / $165 | yes |
| X-02 | SC, born 01/1964 (60–65), Jun 2026, OW $1,002.00 | Total exactly $250.50 → $251; employee $125.25 → $125 | $251 / $125 / $126 | $251 / $125 / $126 | yes |
| X-03 | SC, born 01/1950 (above 70), Jun 2026, OW $633.33 | Phase-in total $67.49925 → $67 (pre-rounding to cents would give $68); employee $19.9995 → $19 | $67 / $19 / $48 | $67 / $19 / $48 | yes |
| X-04 | SC, born 01/1996, Dec 2026, OW $4,321.09, AW $2,345.67 | Bonus month: OW + AW with cents, TW $6,666.76 | $2,467 / $1,333 / $1,134 | $2,467 / $1,333 / $1,134 | yes |
| X-05 | 2nd-year SPR G/G (engine: SPR from 10 Feb 2025), born 01/1996, Jun 2026, OW $612.34 | SPR year-2 G/G phase-in band | $106 / $50 / $56 | $106 / $50 / $56 | yes |
| X-06 | SC, born 01/1970 (55–60), Feb 2027, OW $1,100.00 | 2027 table (35.5% / 19%); total exactly $390.50 → $391 | $391 / $209 / $182 | $391 / $209 / $182 | yes |

The calculator's working matches the engine's rules. It applies the rate to the exact wage, rounds the total to the nearest dollar (50 cents rounds up), drops the cents from the employee share, and sets the employer share to total − employee ("$2,960.00 − $1,599.00"). In the phase-in band it shows employer-only % × TW plus the coefficient × (TW − $500).

The calculator cannot check three things: it does not ask for the SPR date, so the SPR year and the OW pro-ration in a conversion month remain the caller's inputs. It also assumes the AW ceiling has already been applied, and it takes no year-to-date history.

## Leave module rules (WS5)

`src/leave/` encodes the parental, childcare and part-time rules the leave module needs, resolving the leave handoff above. Tables are in `src/leave/tables.ts`, half-open `[effectiveFrom, effectiveTo)`, each row cited and verified on 31 Oct 2026. The rule row is picked by the child's **reference date** (birth, expected delivery date or formal intent to adopt), never by the leave dates.

| Calculator | Encoded | Source |
| --- | --- | --- |
| `maternityLeave` | GPML 16 weeks for an SC child after 3 continuous months' service before the birth (no marriage condition); 1st/2nd child employer weeks 1–8, Government weeks 9–16 (cap $20,000, $2,500/week); 3rd+ all Government (cap $40,000). Non-SC child: EA 12 weeks, employer weeks 1–8 for birth order ≤ 2 (MOM: fewer than 2 living children) and the rest unpaid. | [MSF GPML](https://www.profamilyleave.msf.gov.sg/schemes/maternity-leave), [MOM](https://www.mom.gov.sg/employment-practices/leave/maternity-leave/eligibility-and-entitlement) |
| `paternityLeave` | Before 1 Jan 2024: 2 weeks. `[2024-01-01, 2025-04-01)`: 2 + 2 voluntary weeks (employer agreement, reimbursed). From 1 Apr 2025: 4 weeks. **Stillbirth: 2 weeks.** SC child, marriage condition, 3 months' service; ≤ 6 paid days a week; all Government, $2,500/week. | [MOM](https://www.mom.gov.sg/employment-practices/leave/paternity-leave), [MSF chronology](https://ask.gov.sg/msf/questions/cmtqu4elt00xr5l011wnf0543?from=topics), [MSF stillbirth](https://ask.gov.sg/msf/questions/cmknees5w001gpwb8u66r0wzy) |
| `sharedParentalLeave` | 6 weeks `[2025-04-01, 2026-04-01)`, 10 weeks from 1 Apr 2026, keyed to the **later** of birth and EDD (an EDD on/after 1 Apr 2026 keeps 10 weeks for an earlier birth). **Stillborn children excluded.** Shared between parents; father needs the marriage condition. | [MOM SPL](https://www.mom.gov.sg/employment-practices/leave/shared-parental-leave), [MSF stillbirth](https://ask.gov.sg/msf/questions/cls1lenm102ajjzsg30u2kssb?from=relatedquestions) |
| `adoptionLeave` | GPAL 12 weeks; child under 12 months at the formal intent to adopt, SC, 3 months' service; 1st/2nd employer weeks 1–4, Government 5–12 (cap $20,000); 3rd+ all (cap $30,000). | [MOM adoption](https://www.mom.gov.sg/employment-practices/leave/adoption-leave) |
| `childcareLeave` | Ages on 1 Jan. GPCL 6 days (SC child < 7), pro-rated below 12 months' service by MOM's table; employer days 1–3, Government 4–6 ($500/day incl. CPF). ECL 2 days (SC child 7–12, none < 7), Government-paid, not pro-rated, combined max 6. EA childcare 2 days (non-SC child < 7, no SC child < 7), employer-paid. All need 3 months' service. Lifetime limits 42 (GPCL) / 12 (ECL) per child are data only. | [MOM](https://www.mom.gov.sg/employment-practices/leave/childcare-leave/eligibility-and-entitlement), [pro-rated](https://www.mom.gov.sg/employment-practices/leave/childcare-leave/pro-rated-childcare-leave), [ECL](https://www.mom.gov.sg/employment-practices/leave/childcare-leave/extended-childcare-leave), [MSF notes](https://file.go.gov.sg/gpcl2notes.pdf) |
| `infantCareLeave` | Unpaid; 6 days a year before 1 Jan 2024, 12 from 1 Jan 2024; SC child under 2; 3 months' service; 24 days per child. | [MOM](https://www.mom.gov.sg/employment-practices/leave/unpaid-infant-care-leave) |
| `partTimeLeaveHours` | (PT h/yr ÷ FT h/yr) × FT days × FT h/day using the **comparable full-timer's actual hours** (the verifier's correction), exact rational, rounded half up to 0.1 h. Reproduces MOM's 25.5 / 50.9 / 218.2 h. | [MOM part-time leave](https://www.mom.gov.sg/employment-practices/part-time-employment/leave) |
| `NDR_2026_CHILDCARE` | Announced merged childcare scheme (8/10/12 days for 1/2/3+ **SC** children aged 12 and below), `effectiveFrom: null`: data only, never applied. | [gov.sg](https://www.gov.sg/ndr2026/families/), [CPF](https://www.cpf.gov.sg/member/infohub/educational-resources/baby-bonus-benefits-and-support-for-new-parents) |

History boundaries: the pre-2024 paternity (2 weeks) and infant-care (6 days) rows are encoded from `LEAVE_HISTORY_START` (1 Jan 2023) only; earlier children are not covered and the schemes' real start dates are not claimed. GPML, EA maternity, GPAL and childcare rows start at `ENGINE_COVERAGE_START` (amounts verified current; history not encoded), so a 2024 birth throws `RulesNotAvailableError`.

Still unverified:
- **Part-time rounding**: 1 decimal place half up matches MOM's examples only; the Part-Time Employees Regulations could not be read. Every result carries warning `PT_LEAVE_ROUNDING_UNVERIFIED`.
- **NDR 2026 childcare changes**: no implementation date or full conditions published.
- EA maternity "fewer than 2 living children" is approximated by the declared birth order; GPCL funding numbering (days 1–3 employer) is kept for pro-rated entitlements.
- Service is counted to the day before the reference date ("3 continuous months before the birth"); the child's age for adoption is whole months on the intent date.
