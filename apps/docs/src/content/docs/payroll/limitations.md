---
title: Limitations and what needs your judgement
description: What Crow HR does not do, statutory questions it cannot settle for you, and the results you must check before paying or filing.
---

Crow HR computes what the cited rules say and shows its working, but some questions have no published answer, some inputs only you know, and some features are not built. This page lists them. It is kept in step with `docs/limitations.md` in the repository. Nothing here, or elsewhere in these docs, is legal, tax or CPF advice.

## Decisions that are yours

Crow HR does not decide these; it computes from what you enter.

- **OW or AW.** Each earning is marked ordinary or additional wages by the person entering it, and each allowance type is CPF-liable OW unless changed. Use CPF's guidance on [what constitutes wages](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions).
- **The date an AW became due and payable**, which keys the AW ceiling.
- **Retroactive pay**: a later-decided increment is AW of the month paid; one paid late by mistake is OW of the original months and needs those months recomputed (reopen them as adjustments).
- **Whether a deduction is permitted** under Employment Act s 27, and that you have the employee's written consent where needed. Crow HR checks the amount limits, not the legal basis.
- **"Days worked"** for incomplete-month salary: whether outpatient sick leave or childcare leave counts is your policy.
- **SPR rate options** (F/G, F/F): record them only after CPF approves the joint election.
- **Opening balances** when you start mid-year: they drive the AW ceiling for the rest of the year.

## CPF

- **2028 rates are not published.** From January 2028 the 2027 tables are carried forward with warning `CPF_RATES_ASSUMED_CARRIED_FORWARD`. Re-check when CPF publishes the new rates.
- **Low-wage months with capped AW** (total wages above S$50 and up to S$750 with AW over the ceiling) are refused with `CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED`: CPF publishes no rule, so the run blocks for that employee.
- **Open questions** (no official answer found): whether AW payable in one year but paid in the next also changes the rate table; whether a known leaving month should shorten the AW ceiling estimate before the last month; when an approved SPR F/G or F/F election takes effect and whether it can be reversed; mid-month changes of residency.
- **AW top-up recovery** (CPF Act s 7(9)): the employee share of a top-up on earlier AW may be deducted with a "CPF AW recovery" item until 30 June of the following year; otherwise the employer bears it, shown as "Employee share absorbed". Remittance never waits for recovery. Recovering other CPF arrears caused by the employer is blocked; the s 7(6A) route (non-negligent error, with consent) and waivers for leavers are not supported.
- **CPF late-payment interest** is not computed.

## Payroll inputs

- **Fed inputs**: approved no-pay and other unpaid leave, approved overtime, rostered staff's days worked and scheduled days, and approved claims reach the run automatically ([items fed from other modules](/docs/payroll/running-payroll/#items-fed-from-other-modules)). **Approved claims are paid by payroll**: to pay one by transfer instead, mark it paid outside payroll under Claims before the run is computed, or it is paid twice. Hours for hourly-paid staff are still typed in.
- **Fed overtime has no amount**: for employees not covered by Part 4, or paid by the hour, approved overtime from attendance blocks the run and can't be priced on it. Enter their overtime by hand instead.
- **Holiday work premiums** are still entered separately. Off-day holiday entitlement now feeds a daily gross-pay earning when policy chooses extra pay; monthly fixed-week rates are automatic. Hourly or rostered staff need an explicit holiday amount through the API. Rest-day holidays give a substitute day.
- **Leave encashment** needs an approved payout request, including for year-end entries. It then feeds payroll at the gross rate automatically. Classify active allowances with `grossRateIncluded` through the payroll settings API first; shift staff need an explicit contractual average workweek.
- **Reopened claims** carry through the replaced run chain. An adjustment settles the chain's unpaid claim reservations without paying an already-paid claim twice.
- **Back pay** from a retroactive change is flagged on the next run (`BACKPAY_OWED`) but not computed; enter the amount as a "Back pay" item.
- **Staff without a fixed week** (rostered or shift) need scheduled days and days worked for an incomplete month; the run blocks without them. They come from published rosters and attendance when the whole month is covered, otherwise HR enters them. A mid-month rate change and SPR graduated-to-full conversion are blocked for these staff.
- **Not handled**: daily-rated and piece-rated pay.
- **Allowance CPF and pro-ration settings** have an API but no screen.
- **Adjustments do not recompute later months**; CPF's December (or last-month) AW recomputation absorbs the difference, and Crow HR warns when you reopen an earlier month.

## Employment Act checks

- **Payment deadlines**: salary is checked against 7 days after the period (s 21(1)) and each overtime entry against 14 days after the period in which it was worked (s 21(2)). The Interpretation Act rule that moves a deadline falling on a Sunday or public holiday to the next day is not applied, so a run can be flagged a day early. Paying on a non-working day is allowed and only noted.
- **Deduction limits**: accommodation, amenities and services share one 25% cap; damage or loss, advances and loans are 25% each; all deductions together 50%, with employee CPF and SHG counting towards it; the 50% limit is only a warning on final pay.
- **Final pay timing** when the employer ends the employment (last day, or within 3 working days) is not checked yet.
- **Overtime rounding** has no MOM rule; the default reproduces MOM's published example.

## Files you upload

- **No direct submission** to CPF Board, IRAS or any bank. Crow HR produces files; you upload them.
- **CPF EZPay file**: built from CPF's specification and a golden-file test, not confirmed by CPF Board or accepted in a live submission. See [CPF EZPay file](/docs/payroll/cpf-ezpay-file/).
- **Bank file**: generic ISO 20022 `pain.001.001.03`, not mapped to any bank's guide and not tested with any bank. See [bank file](/docs/payroll/bank-file/).
- **IR8A**: rows for IRAS's import template; several items are not filled, Appendix 8A and 8B are not produced, and AIS API submission is not available. See [IR8A export](/docs/payroll/ir8a-export/).
- **Not available**: IR21 tax clearance, income tax withholding, bank-specific formats (DBS, OCBC, UOB and others), MOM or Myinfo integrations.

## Where the law or format is unclear

The independent review of the payroll choices marked these as **unclear**: the available sources do not settle them. Crow HR's current choice is shown; check it against your own advice.

| Question | Crow HR's choice |
| --- | --- |
| Should foreign employees' SHG appear in the EZPay file only as a fund summary, without detail records? | Summary record only; employees without an S/T number are listed for you to key in EZPay. |
| How is a top-up on earlier AW encoded in the EZPay file when the month has no new AW? | Reported in the current month's CPF amount, with no new AW in that month's AW column. |
| Is a pay date after the raw 7- or 14-day deadline always late, given the Interpretation Act rule for Sundays and public holidays? | Flagged as late on the raw count (may be a day early). |
| Should the bank file set a service level (FAST/GIRO), and which charge bearer? | No service level; charge bearer `SLEV`. Depends on your bank. |
| Are 8-character BICs and punctuation in references accepted? | Accepted by the generic file; some banks require 11 characters and plainer references. |

## Platform and sign-in

- **Singpass** is not tested against real Singpass and its button lacks the official logo. See [Singpass](/docs/admin/sso/singpass/).
- **Security emails bypass the outbox**: invitations and password resets are sent once, without retries. "Sign-in attempts blocked", "new MFA method" and "recovery code used" notices are not sent.
- **JIT-provisioned members** are not reported to HR; only the audit log records them.
- **No email change** for a member's sign-in email yet.
- **Org switcher** in the web app shows only the current organisation (the API supports switching).
- **No row-level security** in the database: isolation is enforced by the application and composite foreign keys, with a test that every route refuses another organisation's IDs.
- **The common-password list** is a curated list of a few hundred entries plus patterns, not a breach corpus.
- **Docker images are not published** and CI has not run on a hosted runner. Of the reverse proxies, only Caddy is tested.
- **Not built**: the [mobile apps](/docs/coming-soon/mobile-apps/). The [in-browser demo](/docs/demo/) is built but not deployed.
- **Virus scanning is optional**: configure your own clamd via `CLAMAV_HOST` / `CLAMAV_PORT`; receipts, documents and medical certificates then use the shared scan sweep. Without it, uploads are explicitly unscanned.
