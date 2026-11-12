# Independent Singapore payroll verification

> **Historical record.** An independent review of the statutory research data before the rules were coded, on 31 Oct 2026. Every finding below was resolved; how is recorded in [`packages/sg-rules/VERIFICATION.md`](../../packages/sg-rules/VERIFICATION.md). The current rules live in `packages/sg-rules`.

Audit date: **31 October 2026**. Scope: the four supplied research files, read-only. All work products are in this directory.

**The rule tables are not yet safe as an executable specification.** Most numeric transcriptions are correct, but payment-date semantics, SDL exceptions, historical AW adjustments, parental-leave conditions and several implementation recommendations need correction.

## Method and reproducible results

I searched and read primary CPF Board, MOM, IRAS and SDL-authority material independently. MSF material supplements MOM for parental leave. I did not use the research prose as the calculation authority. The standalone [recompute.py](recompute.py) uses Python standard-library integer arithmetic and `Decimal`, with separately transcribed official rates. It reads the supplied expectations only for comparison. It makes no network requests and changes no input files.

Run:

```sh
python research/verification/recompute.py
```

The run completed successfully and wrote [recomputation-results.json](recomputation-results.json), including input SHA-256 hashes, every recomputed expected field, differences, individual table checks and an exhaustive inventory of JSON numeric literals.

| Check | Result |
| --- | --- |
| Supplied vectors recalculated | 91: 62 CPF, 12 SDL, 17 SHG |
| `DERIVED_FROM_FORMULA` vectors | All 39 recalculated; all monetary results match the supplied inputs |
| Official-labelled vectors recalculated | All 52; direct primary-source spot-checks listed below |
| Table comparisons, including null bounds and some strings | 1,328; one disagreement: IR21 notice period |
| JSON numeric literals | 1,192: 1,188 matching, one disagreement, two illustrative full-time reference values, one schema version |
| Vector metadata mismatch | `SPR-04`: unpublished `2028:T1` |
| Incorrect representation of an official scenario | `AW-11`: historical AW adjustment treated as new wages; SDL consequently wrong |

These are comparisons with an independently assembled reference, not a live scrape or certification by the agencies. Dates, percentage strings, formula strings, eligibility and missing branches were reviewed separately; the numeric-literal inventory does not certify those semantics. No repo build was required.

## Disagreements and implementation gaps

“High” means the primary source explicitly supports the correction, or the inconsistency is directly reproducible. “Medium” identifies an unsafe inference or incomplete representation where the complete agency treatment still needs confirmation. Missing conditions are identified as omissions, not falsely described as numbers the original author explicitly rejected.

| Item | Their value / instruction | Verified value / required correction | Primary source URL | Confidence |
| --- | --- | --- | --- | --- |
| `cpf.sprYearRule.conversionMonth` | AW subject only if **paid** on/after SPR date | Use when AW is **payable**. AW payable before conversion remains outside CPF even if cash is transferred later. | [CPF SPR conversion FAQ](https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status) | High |
| `conventions.effectiveDating`, AW payment-date wording | Select AW regime using cash payment date | Preserve the AW **due-and-payable** date. It determines the applicable ceiling year; delayed cash settlement must not silently move the liability to another year. | [CPF AW examples, p. 1](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) | High for ceiling year; rate treatment of delayed AW needs further verification |
| `cpf.awCeilingRule.formula` | Annual cap minus annual OW, then minus AW previously subjected, called the ceiling | The annual AW ceiling is `10200000 - annualOwSubjectCents`. Subtracting prior AW gives **remaining headroom**, a separate quantity. A negative balance requires an excess/refund path, not negative newly subject wages. | [CPF wage ceilings](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions) | High distinction; implementation gap |
| `cpf.wageBandBasis` / notes, low-wage capped-AW case | Apply phase-in formula to subject TW and warn, although pre-cap TW chooses the band | This extension is unverified and can yield negative contributions. Example: OW S$300 + wholly non-subject AW S$300 selects phase-in; substituting S$300 produces employee **−S$120**, total **−S$69** before rounding. Block this unsupported branch pending confirmation; do not present a guessed legal value. | [CPF rate tables](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf) | High defect demonstration; legal result unresolved |
| `AW-11` | `awPaidCents=4000000`; June SDL S$11.25 | Official June AW paid is **zero**. S$40,000 is prior AW newly subjected on reconciliation. June SDL is **S$3.75**, assuming the published S$1,500 OW is its only June wages. CPF figures remain correct for the reconciliation. | [CPF AW examples, example 7](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) | High |
| `SPR-04.expected.rateTable` | `2028:T1` | `2027:T1` if deliberately carrying forward the latest published table. The 2028 result is conditional, not an independently verified 2028 statutory expectation. | [Published 2027 tables](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf) | High |
| `sdl.rates[0].effectiveFrom` and missing earlier row | Only row starts 1 July 2026; earlier parameter start “not verified” | Current parameters began **1 October 2008**. Retain 1 July 2026 for the agency change if desired, but supply the earlier rate interval. Otherwise January–June 2026 vectors have no matching SDL row. | [SSG FAQ A2–A3](https://file.go.gov.sg/sdl-generic-faq.pdf), [MOM SWDA establishment](https://www.mom.gov.sg/newsroom/press-releases/2026/0624-appointment-of-inaugural-board-for-swda) | High |
| `sdl.rates[0].rounding` unconditional clamp | Minimum S$2 even when wage input is zero | **Zero SDL** for full no-pay leave when no wages are paid or payable. Apply liability/exemption checks before the minimum. | [SSG FAQ D4, p. 7](https://file.go.gov.sg/sdl-generic-faq.pdf) | High |
| SDL coverage / research §2 exemptions | Only household domestic staff excluded explicitly; student exemptions “unverified” | Add the authority's specified approved local-student training, qualifying overseas-tertiary training of **at most six months** with institutional letter, and qualifying school-holiday student exemptions. Ordinary part-time status alone is not exempt. | [SSG FAQ C1, p. 5](https://file.go.gov.sg/sdl-generic-faq.pdf), [current Exemption Order §2](https://sso.agc.gov.sg/SL/SDLA1979-S258-2014?DocDate=20260626) | High; 2026 amendment changes agency name |
| `employmentAct.overtime[0].note` | Recommend exact S$13.636… hourly base instead of published S$13.60 | Reproduce MOM's statutory guidance example: **S$40.80** for two OT hours at S$2,600 basic. Exact-formula S$40.91 may be an employer enhancement, but must not be labelled the verified MOM example or statutory rounding rule. | [MOM overtime guidance](https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days) | High discrepancy; universal rounding method unresolved |
| `employmentAct.partTime.ftReference` | Fixed 44 hours/week and 8 hours/day | Those are MOM's **example**, not universal reference constants. Use the actual comparable full-time employee's annual/daily hours and entitlement. | [MOM part-time leave](https://www.mom.gov.sg/employment-practices/part-time-employment/leave) | High |
| `leave.paternity[0]` stillbirth branch omitted | Four-week rule without birth-outcome exception | Eligible fathers of stillborn children receive **two weeks**, subject to the specified conditions. | [MOM paternity leave](https://www.mom.gov.sg/employment-practices/leave/paternity-leave), [MSF eligibility footnote](https://ask.gov.sg/msf/questions/cmknees5w001gpwb8u66r0wzy) | High |
| `leave.sharedParental` stillbirth branch omitted | Six/ten-week date rows without live-birth condition | Stillborn children do **not** qualify for the new SPL scheme. | [MSF explanation](https://ask.gov.sg/msf/questions/cls1lenm102ajjzsg30u2kssb?from=relatedquestions) | High |
| `leave.paternity[1]` historical interval | `effectiveFrom=null`, two mandatory plus two voluntary weeks for unspecified past period | The reimbursable optional extra two weeks began **1 January 2024**. Before then, the mandatory scheme was two weeks. Do not back-apply the extra reimbursable weeks indefinitely. | [MSF entitlement chronology](https://ask.gov.sg/msf/questions/cmtqu4elt00xr5l011wnf0543?from=topics) | High |
| Parental-leave eligibility omitted from several JSON rows | Numeric entitlements without complete eligibility predicates | Add service/citizenship predicates: e.g. **three continuous months** for ECL and unpaid infant care; GPPL also has marriage conditions; adoption has infant-age and adoption-order conditions. Prose elsewhere is not executable gating. | [MOM ECL](https://www.mom.gov.sg/employment-practices/leave/childcare-leave/extended-childcare-leave), [infant care](https://www.mom.gov.sg/employment-practices/leave/unpaid-infant-care-leave), [adoption](https://www.mom.gov.sg/employment-practices/leave/adoption-leave) | High omission |
| `leave.childcareLeave[3].note` | Citizenship rules not published | The announcement explicitly counts **Singapore Citizen children aged 12 and below**. Store that known restriction; implementation date and further conditions remain unpublished. | [CPF explanation of announced changes](https://www.cpf.gov.sg/member/infohub/educational-resources/baby-bonus-benefits-and-support-for-new-parents) | High |
| `tax.ir21FileAtLeastDaysBefore` | `30` | **One calendar month**, not a fixed number of days. For cessation on 31 March 2027, calendar-month subtraction gives 28 February; subtracting 30 days gives 1 March. | [IRAS tax clearance](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-%28ir21%29/tax-clearance-for-employees) | High |
| `tax.ir21ExemptionIncomeBelowCents` applicability omitted | S$21,000 scalar without qualifying scenario | Amount is correct; low income alone is insufficient. Encode the qualifying **183-day** scenarios, annual income test and relevant exclusions/other-employer conditions. | [IRAS tax clearance scenarios](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-%28ir21%29/tax-clearance-for-employees) | High omission |
| `cpfSubmission.lateInterest` | Day-count labelled secondary; no final rounding instruction | Primary CPF FAQ gives the method, stopping at the fourth decimal for the stated ratio, then **flooring final interest to dollars**, minimum S$5. Its example's S$28.50 becomes **S$28**. Multi-month handling still needs confirmation. | [CPF interest FAQ](https://www.cpf.gov.sg/service/article/how-does-cpf-board-calculate-interest-on-late-payment) | High |
| Global effective interval vs work-pass intervals | Global inclusive `[from,to]`; work-pass `effectiveTo` is next regime's start, exclusive | Make interval semantics explicit per dataset or normalise them. Inclusive selection makes both old/new salary rows match **1 January 2027**. Work-pass renewal transitions are keyed to **pass expiry**, as their local note correctly says. | [MOM EP salary tables](https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility), [S Pass tables](https://www.mom.gov.sg/passes-and-permits/s-pass/eligibility) | High internal inconsistency |

The overtime recommendation overpays MOM's example; this is not an accusation of employee underpayment. The defect is claiming an unverified computation as the statutory result.

## Numeric coverage against primary sources

| Rule-table area | Audit finding and source |
| --- | --- |
| CPF 2025 Table 1 | All five age rows, thresholds, coefficients, rates and OW maxima match the [official 2025 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2025_contributionandallocationrates.pdf). |
| CPF 2026 Tables 1–5 | Every numeric cell matches the [official 2026 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf). This includes all G/G and F/G rows and repeated above-65 G/G rows. Formula strings agree with the numerical fields. |
| CPF 2027 Tables 1–5 | Every numeric cell matches the [published 2027 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf). The changed full-rate phase-in coefficients and F/G employer portions are correct; G/G remains unchanged. |
| CPF ceilings | S$7,400 for 2025, S$8,000 from 2026 and S$102,000 annual are confirmed. The supposedly unverified **1 January 2016** annual-ceiling date is also supported by the [CPF historical-ceiling FAQ](https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling). Its parenthetical “+S$600” beside 2026 is an apparent source typo; the level S$8,000 is consistent across official tables. |
| SDL | All five numerical rate/minimum/maximum/threshold fields match [CPF's SDL page](https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy). Coverage, zero wages and dating require the corrections above. |
| SHG | All **28 bands**, their upper bounds and contributions match the [CPF SHG tables](https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups). Eligibility by race/religion and SINDA EP coverage also match. MBMF's 1 June 2016 start is confirmed by [MUIS](https://www.muis.gov.sg/give-back/mbmf/employer-information/). |
| Annual/sick leave | All service-year and completed-month entries, three-month gate and 48-hour notification figure match [MOM annual leave](https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement) and [sick leave](https://www.mom.gov.sg/employment-practices/leave/sick-leave/eligibility-and-entitlement). The 12-month statutory carry-forward is confirmed by [MOM special situations](https://www.mom.gov.sg/employment-practices/leave/annual-leave/special-situations). |
| Other leave numbers | Childcare proration matches [MOM's complete table](https://www.mom.gov.sg/employment-practices/leave/childcare-leave/pro-rated-childcare-leave). The 42/12 lifetime childcare/ECL limits are explicitly in [MSF explanatory notes](https://file.go.gov.sg/gpcl2notes.pdf). Maternity and adoption weeks, funding splits and caps match [MSF GPML](https://www.profamilyleave.msf.gov.sg/schemes/maternity-leave) and [MOM adoption](https://www.mom.gov.sg/employment-practices/leave/adoption-leave). Current GPPL/SPL figures match [MOM GPPL](https://www.mom.gov.sg/employment-practices/leave/paternity-leave) and [SPL](https://www.mom.gov.sg/employment-practices/leave/shared-parental-leave), subject to the omitted conditions above. |
| Employment Act | Numerical payment deadlines and deduction caps match [MOM salary payment](https://www.mom.gov.sg/employment-practices/salary/paying-salary) and [deductions](https://www.mom.gov.sg/employment-practices/salary/salary-deductions). OT thresholds, multiplier, hours and rest-day multipliers match [MOM hours guidance](https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days); the [2019 guide](https://www.mom.gov.sg/-/media/mom/documents/speeches/2018/guide-to-employment-act-changes-1-april-2019.pdf) confirms the threshold transition. All 36 working-day fixture cells recompute correctly from the calendar under [MOM's salary definitions](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary). |
| Public holidays | All 22 holiday dates and four Monday observations match [MOM 2026](https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026) and [MOM 2027](https://www.mom.gov.sg/newsroom/press-releases/2026/0618-public-holidays-for-2027). The Saturday/rest-day distinction matches the [MOM substitution FAQ](https://www.mom.gov.sg/faq/public-holidays/is-an-employee-entitled-to-another-day-off-if-a-public-holiday-falls-on-a-rest-day-or-non-working-day). |
| FWL and quotas | All 37 monthly/daily rows match the [services](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements), [manufacturing](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements), [construction](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements), [process](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements), [marine](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/marine-sector-requirements) and [S Pass](https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements) sources. Daily rates independently reproduce using integer ceiling division. Announced rows match [COS 2026](https://www.mom.gov.sg/-/media/mom/documents/press-releases/2026/factsheet-on-foreign-workforce-policies-03032026.pdf); no exact 2028 start should be invented. |
| Work-pass salaries | All **184 age-specific salary values** match the [EP](https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility) and [S Pass](https://www.mom.gov.sg/passes-and-permits/s-pass/eligibility) tables. Dates also match [COS 2025](https://www.mom.gov.sg/-/media/mom/documents/budget2025/cos-2025-factsheet-on-foreign-workforce-policies.pdf) and COS 2026. Other thresholds match [PEP](https://www.mom.gov.sg/passes-and-permits/personalised-employment-pass/eligibility), [ONE Pass](https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/eligibility), [TEP](https://www.mom.gov.sg/passes-and-permits/training-employment-pass/eligibility), [DP](https://www.mom.gov.sg/passes-and-permits/dependants-pass/eligibility), [NTS occupations](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/non-traditional-sources-occupation-list) and [LQS](https://www.mom.gov.sg/employment-practices/progressive-wage-model/local-qualifying-salary). LQS overtime requirements need the linked wage schedule; S$1,800 is not an unlimited-hours floor. |
| CPF submission / tax | All eight payment-code mappings and 16 January 2025 file-spec start match the [CPF FTP specification](https://www.cpf.gov.sg/content/dam/web/employer/making-cpf-contributions/documents/CPFEZPayFTPSpecifications.pdf). The five-employee AIS threshold from YA2022 matches [IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/join-the-auto-inclusion-scheme-(ais)-for-employment-income). IR8S discontinuation from YA2026 and 1 March reporting deadline match [IRAS explanatory notes](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-form-ir8a-and-appendix-8a-for-ya2027.pdf). IR21 corrections are above. |

## Findings on the five requested claims

**(a) CPF rounding: supported.** Compute total CPF, round half-up directly to whole dollars, floor employee CPF to dollars, and obtain employer CPF by subtraction. Sum OW/AW contributions before rounding. No intermediate rounding to cents is prescribed. `RD-03` therefore gives S$370 from exact S$370.4958; `RD-04` gives S$165 from exact S$165.495. This follows the [official calculation instructions](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay). I could not independently exercise the live calculator: browser control was unavailable. Those two sub-cent cases are confirmed by the published mathematical rule, not by an observed calculator result.

**(b) SDL aggregation: supported, after liability checks.** Calculate each liable employee's amount, add them, then floor the employer aggregate to dollars. The [CPF example](https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy) confirms the ordering. Neither it nor the authority FAQ prescribes an intermediate employee rounding step for fractional cents; retaining exact precision is the defensible interpretation. The unconditional minimum and `AW-11` remain defects.

**(c) Wage band: supported for the capped-AW full-rate case.** [CPF example 16](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) explicitly selects using pre-cap monthly wages. It does not resolve the negative phase-in example above. Nor should pre-SPR remuneration automatically be treated as CPF wages.

**(d) Age change: confirmed.** The new band begins in the following month, including birthdays on the first/last day. The [CPF rates page](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay) explicitly states this. The input algorithm also yields March for leap-day milestones.

**(e) AW reconciliation: confirmed in principle; fixture model incomplete.** Use actual annual OW at cessation or December, whichever occurs first; reconcile earlier AW, preserve its historical applicable rates, and process later AW/rehires appropriately. [CPF examples](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) support these requirements. A historical CPF adjustment is not a new wage payment for SDL or SHG. Keep wage-payment history and contribution adjustments as separate data.

## Vectors confirmed and corrected

All expected fields were recalculated, including SDL and SHG fields embedded in CPF vectors. Absence of `shgFund` is interpreted as no applicable/elected fund in the fixture; it does not prove that the employee is legally exempt.

**Derived vectors confirmed:** `WB-01` through `WB-14`; `RD-01` through `RD-04`; `SPR-09`, `SPR-10`; `AGE-T3` through `AGE-T8`; `Y27-03`, `Y27-04`, `Y27-06`; `PM-01`, `PM-02`; `SDL-06` through `SDL-10`; `SDL-RUN-02`; `SHG-17`. These are **38 unconditional arithmetic confirmations**. `SPR-04` is the 39th: monetary arithmetic matches only under its declared carry-forward assumption. `SPR-10` confirms CPF on the supplied S$1,700 subject OW, not the salary-proration method that produced it. `PM-01` similarly supplies its prorated wage as an input.

**Official-labelled vectors confirmed against their stated inputs:** `AGE-01` through `AGE-05`; `SPR-01`, `SPR-02`, `SPR-03`, `SPR-05` through `SPR-08`; `FOR-01`; `AW-01` through `AW-10`; `AGE-T1`, `AGE-T2`; `Y27-01`, `Y27-02`, `Y27-05`; `PM-03`; `SDL-01` through `SDL-05`; `SDL-RUN-01`; `SHG-01` through `SHG-16`. `AW-11` passes synthetic-input arithmetic but fails faithful representation of the official scenario.

Ten explicit primary-source spot-checks, beyond recalculation of the full dataset:

| ID | Independently confirmed expected result | Source |
| --- | --- | --- |
| `AGE-02` | CPF total/employee/employer S$1,020 / S$540 / S$480 | [2026 Table 1](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf) |
| `AGE-03` | S$750 / S$375 / S$375 | [2026 Table 1](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf) |
| `SPR-01` | S$270 / S$150 / S$120 | [2026 Table 2](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf) |
| `SPR-05` | S$660 / S$150 / S$510 | [2026 Table 4](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf) |
| `SPR-06` | S$960 / S$450 / S$510 | [2026 Table 5](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf) |
| `Y27-01` | S$2,840 / S$1,520 / S$1,320 | [2027 Table 1](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf) |
| `Y27-05` | S$1,720 / S$400 / S$1,320 | [2027 Table 4](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf) |
| `AW-08` | S$222 / S$120 / S$102, using pre-cap wage band | [AW example 16](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) |
| `SDL-RUN-01` | Exact S$40.75; remittance S$40 | [CPF SDL worked example](https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy) |
| `SHG-10` | MBMF S$15 for S$3,000.01 | [CPF SHG table](https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups) |

Corrections to retain for engineers:

```json
{
  "AW-11": {
    "correctedInputs": {
      "awPaidCents": 0,
      "priorAwNowSubjectOnReconciliationCents": 4000000
    },
    "correctedExpected": {
      "awCeilingCents": 6050000,
      "totalCpfCents": 1535500,
      "employeeCpfCents": 830000,
      "employerCpfCents": 705500,
      "sdlUnits1e4Cent": 3750000,
      "sdlExactDollars": "3.75"
    }
  },
  "SPR-04": {
    "conditionalExpected": {
      "rateTable": "2027:T1",
      "totalCpfCents": 111000,
      "employeeCpfCents": 60000,
      "employerCpfCents": 51000
    }
  }
}
```

`priorAwNowSubjectOnReconciliationCents` is a proposed separation of inputs, not a pre-existing field. The old single `awSubjectToCpfCents` field should not conceal whether it means newly paid AW or an adjustment. For `AW-11`, the subject adjustment remains S$40,000 but new June AW subject is zero. Its per-employee S$3.75 is exact SDL before employer aggregation; if this is the only employee, remittance is S$3.

The script also adds a zero-wages SDL probe: original clamp produces `2000000` units; correct liability is `0` when nothing is paid or payable. No supplied zero-wage vector tests this.

## Not verified / limits of this audit

- A live CPF-calculator result for `RD-03`/`RD-04`; browser control was unavailable. The published rounding rule supports the recomputed amounts.
- The complete official phase-in calculation when pre-cap wages select S$500–S$750 but subject wages fall below that range. The script refuses that unverified combination instead of generating negative CPF.
- A universal rule for rounding the OT hourly base or part-time leave hours. MOM's examples do not establish a general rounding algorithm.
- Whether SDL fractional employee amounts are rounded to cents in an authority system before aggregation; no such instruction was found. The audit uses exact formula amounts.
- Historic start dates that remain explicitly unknown for CDAC, ECF, SINDA and several long-standing leave/levy rows. Their current amounts were verified. Current-only rows must not be advertised as complete historical coverage.
- Exact implementation dates for announced 2028 FWL changes and the NDR 2026 leave changes. The latter's Singapore-citizen restriction is known, contrary to the note.
- 2028 CPF rates; `SPR-04` remains conditional. No evidence justifies calling a 2028 table published.
- Effective/reversal conditions for SPR F/G and F/F approvals; approval records remain necessary. Also, delayed AW across rate changes and unusual conversion-month low-wage combinations need explicit cases beyond these fixtures.
- CPF interest spanning multiple months and the complete operational refund/recovery workflow. The primary FAQ resolves the single-month example and final flooring, not every calendar case.
- SHG treatment for very low/zero wages, and complete intern/opt-out eligibility. Table lookups are verified; legal applicability is not established merely by supplying a fund name.
- Some SSO pages returned 403. This report relies on readable agency guidance and identifies unresolved legal edge cases rather than inventing answers. The four inputs do not contain calculation vectors for leave, OT, FWL or tax, so vector success says nothing about implementation correctness in those areas.

**Verdict:** Do not implement directly against these files unchanged. Their CPF rate matrices, SHG bands, core leave scales, wage ceilings and holiday calendars are substantially reliable, and the derived-vector arithmetic is consistent. The files still encode a wrong IR21 period, incorrect paid/payable semantics, an SDL minimum without a zero-liability branch, missing SDL history/exemptions, an AW reconciliation fixture that overstates SDL, incomplete parental-leave conditions and unsafe extrapolations. Correct these items, distinguish conditional fixtures from verified rules, and resolve or explicitly exclude the remaining edge cases before treating the tables as production payroll requirements.
