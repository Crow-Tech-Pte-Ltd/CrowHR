---
title: How we verify statutory calculations
description: How Crow HR's CPF, SDL, SHG, FWL and Employment Act rules were checked - cited tables, CPF's worked examples, an independent recomputation and 15 cases confirmed in CPF's online calculator.
---

Singapore's statutory numbers live in one package, `packages/sg-rules`: pure, dependency-free TypeScript with effective-dated rule tables and calculators. This page summarises how they were checked. The full record, including every disagreement and how it was resolved, is [`packages/sg-rules/VERIFICATION.md`](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/blob/main/packages/sg-rules/VERIFICATION.md) in the repository.

:::note[What this does and does not mean]
These checks show that the engine reproduces the official sources and examples listed below. They are not an approval: CPF Board, IRAS and MOM have not reviewed or endorsed Crow HR. You remain responsible for your payroll and filings.
:::

## Every number has a source

Each constant (CPF rates and ceilings, SDL, SHG tables, FWL rates, Employment Act thresholds, public holidays) carries an effective date range and a source URL in the code. Every rule family has contiguous, non-overlapping date ranges from 1 January 2025, the engine's coverage start, which a test enforces. Where an agency does not publish a start date (CDAC, ECF and SINDA tables, some leave and levy rows), the row starts at 1 January 2025 and is marked as such: no earlier history is claimed.

## Checks against official material

| Check | Result |
| --- | --- |
| CPF rate tables 1–5 for 2025, 2026 and 2027 (15 tables, 5 age bands each) | Machine-compared against the text of CPF's three rate PDFs: 0 mismatches. |
| CPF internal consistency | For every cell: employer rate + employee rate = total rate; phase-in coefficient = 3 × employee rate; the phase-in formula meets the full-rate formula at S$750. |
| CPF AW ceiling | All **16** worked examples in CPF's AW ceiling guide replayed month by month (about 150 months) with state carried between months as payroll does. Every month's OW subject, AW subject, total and employee share match CPF to the dollar, including rehires, AW paid after leaving, age-band changes and shortfalls. |
| SDL | The S$2 minimum and S$11.25 maximum are continuous with 0.25%; start date and exemptions from SSG's SDL FAQ. |
| FWL | MOM's published daily rates equal ceil(monthly × 12 / 365) for all 26 current rows. |
| Working-day calendar | Reproduces all 36 cells of MOM's 2026 incomplete-month salary table (5, 5.5 and 6-day weeks). |
| Research test vectors | 91 of 91 pass to the cent (62 CPF, 12 SDL, 17 SHG), after two fixture corrections found by the independent review. |

The build fails if the tests of `packages/sg-rules` cover less than 95% of its lines.

## Independent review

Two reviews were made separately from the implementation, by a second AI model working from primary CPF, MOM, IRAS and SSG sources rather than from the research notes. They are not a professional or agency review.

- **Review of the statutory research data** (`research/verification/statutory-data-review.md`): recomputed all 91 vectors with a standalone Python script using integer and decimal arithmetic. It found real problems: AW keyed to the payment date instead of the *due and payable* date, a missing zero-wage branch and history for SDL, an AW fixture that overstated SDL, a 2028 rate table that does not exist, and an unsafe low-wage AW case. Each was fixed or turned into a refusal; the resolutions are listed in `VERIFICATION.md`.
- **Payroll choices review** (`research/verification/payroll-choices.md`): checked seven legal and format choices in the payroll implementation (deduction limits, CPF recovery, the EZPay file, shift pro-ration, payslip items, payment deadlines, the bank file). Items marked wrong were fixed: pro-ration for rostered staff no longer guesses a week, overtime deadlines run from the period in which it was worked, payslips keep full names and every overtime period, the AW top-up recovery and its deadline are modelled, EZPay advice codes are stable. Items marked **unclear** are listed on the [limitations](/docs/payroll/limitations/#where-the-law-or-format-is-unclear) page.

## Confirmed in CPF's online calculator

On 31 October 2026, 15 cases were run through CPF Board's public [CPF contribution calculator](https://www.cpf.gov.sg/employer/tools-and-services/calculators/cpf-contribution-calculator) and compared with the engine. **15 of 15 match to the dollar** on total, employee and employer share.

| Case | Inputs | What it stresses | Total / employee / employer |
| --- | --- | --- | --- |
| RD-03 | Citizen, born 1996, Apr 2026, OW S$1,001.34 | Rate applied to the exact wage, no pre-rounding | S$370 / 200 / 170 |
| RD-04 | Citizen, 65–70, Apr 2026, OW S$1,003.00 | Same, older age band | S$165 / 75 / 90 |
| WB-02 | Citizen, Mar 2026, OW S$50.01 | Start of the employer-only band | S$9 / 0 / 9 |
| WB-04 | Citizen, Mar 2026, OW S$500.01 | Start of the phase-in band | S$85 / 0 / 85 |
| WB-06 | Citizen, Mar 2026, OW S$750.00 | Top of the phase-in band, S$277.50 rounds up | S$278 / 150 / 128 |
| WB-08 | Citizen, Mar 2026, OW S$7,999.99 | Employer share = total − employee | S$2,960 / 1,599 / 1,361 |
| WB-13 | Citizen, 65–70, Mar 2026, OW S$555.55 | Phase-in with fractional cents | S$62 / 12 / 50 |
| SPR-10 | 1st-year SPR G/G, Mar 2026, OW S$1,700.00 | Band chosen on post-conversion OW | S$153 / 85 / 68 |
| PM-01 | Citizen, May 2026, OW S$1,363.64 | Pro-rated wage | S$505 / 272 / 233 |
| X-01 | Citizen, 55–60, Jun 2026, OW S$1,025.00 | Total exactly S$348.50 | S$349 / 184 / 165 |
| X-02 | Citizen, 60–65, Jun 2026, OW S$1,002.00 | Total exactly S$250.50 | S$251 / 125 / 126 |
| X-03 | Citizen, above 70, Jun 2026, OW S$633.33 | Pre-rounding would give S$68 | S$67 / 19 / 48 |
| X-04 | Citizen, Dec 2026, OW S$4,321.09 + AW S$2,345.67 | Bonus month with cents | S$2,467 / 1,333 / 1,134 |
| X-05 | 2nd-year SPR G/G, Jun 2026, OW S$612.34 | SPR phase-in band | S$106 / 50 / 56 |
| X-06 | Citizen, 55–60, Feb 2027, OW S$1,100.00 | 2027 table | S$391 / 209 / 182 |

What the calculator cannot check: it does not ask for the SPR date (so the SPR year and conversion-month pro-ration remain your inputs), it assumes the AW ceiling has already been applied, and it takes no year-to-date history. Those parts rest on CPF's AW ceiling examples above.

## Payroll tests

On top of the engine, the payroll module has end-to-end tests with exact cents: a fictional 12-person company for October 2026 (every age band, SPR years 1 and 2, a foreigner, a joiner, a leaver, a bonus hitting the AW ceiling, no-pay leave, overtime, a deduction cap) and one employee from January to December 2026 with two bonuses and the December recomputation. Recomputing any stored result gives a byte-identical hash.

## Not verified

- Overtime rounding: MOM publishes no rule; the default reproduces MOM's only worked example (S$13.60 an hour cap for non-workmen).
- The CPF EZPay file and the bank file have not been accepted by CPF's or any bank's systems.
- Anything listed on the [limitations](/docs/payroll/limitations/) page.
