---
title: Payroll settings
description: Set the pay day, payslip release, CPF advice code, foreign worker levy profile and the debit account for the bank file before your first Crow HR payroll run.
---

Payroll is available to owners and payroll admins. Before the first run, check three things.

## 1. Company profile

The run cannot be submitted until **Settings → Company** has the legal name, UEN, CPF submission number (CSN) and registered address. The legal name is printed on payslips and the CSN goes into the CPF EZPay file. See [company and structure](/docs/admin/company-and-structure/#company-profile).

## 2. Employee records

Payroll reads everything from People: date of birth (CPF age band), residency and PR start date (CPF rates), race and religion (SHG fund), work schedule (pro-ration), basic pay and recurring allowances, and the bank account current on the pay date. If you start mid-year, [import year-to-date opening balances](/docs/people/importing/#year-to-date-opening-balances) first.

## 3. Payroll settings

Open **Payroll → Payroll settings**:

| Setting | What it does |
| --- | --- |
| Pay day | Day of the month for the default pay date; empty means the last day of the month. MOM requires salary to be paid within 7 days after the end of the salary period, and the run warns when the pay date is later. |
| Release payslips on approval | Off by default: payslips become visible to employees only when a payroll admin releases them. On: they are released automatically when the run is approved. |
| CPF advice code | Two digits for the EZPay file, usually `01`. Later runs in the same month get the next free code. |
| Foreign worker levy: sector, tier and skill | Your company's profile for the [FWL estimate](/docs/payroll/shg-sdl-fwl/#foreign-worker-levy-estimate). Sectors: services, manufacturing, construction, process, marine shipyard. |
| Debit account: bank SWIFT/BIC, account number, account name | The account salaries are paid from, written into the [bank file](/docs/payroll/bank-file/). |

The settings API also stores a **cutoff day**. Payroll admins get a reminder 3 days before it (or before the pay day when no cutoff is set) until the month's regular run is approved.

## Allowance treatment

Each allowance type is, by default, CPF-liable as ordinary wages and pro-rated in incomplete months. The API (`/api/v1/payroll/allowance-settings`) can mark a type as not CPF-liable or not pro-rated; there is no screen for this yet. Decide the treatment for each allowance with CPF's guidance on [what counts as wages](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions).

The API also accepts `grossRateIncluded` for each allowance type (`gross_rate_included` in the database). It determines whether an allowance belongs in the Employment Act gross rate used for automatic off-day holiday pay and leave encashment, independently of CPF liability and pro-ration. Set `true` for fixed contractual salary allowances; set `false` for variable or irregular payments, productivity incentives, reimbursements, and travelling, food and housing allowances. Overtime, bonuses and AWS are also excluded under [MOM's gross-rate definition](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary). Do not treat every recurring payroll payment as a fixed salary allowance.

Missing settings or a null flag mean **unclassified**, rather than excluded. An active unclassified allowance produces a blocking issue for holiday pay and prevents a leave-encashment request, naming the allowance to classify. Encashment uses only recurring allowances in force on its rate date, with exclusive end dates, and preserves their amounts and classification in the request's rate working. Later changes do not reprice existing requests.

An off-day public holiday with the leave policy's **extra pay** setting feeds one daily gross-rate earning into payroll. Rest-day holidays continue to produce a substitute paid holiday. Monthly fixed-week rates are automatic; hourly or rostered staff need an explicit `other_earning` item with `holidayDate` and the confirmed daily gross `amountCents`. These API inputs currently have no dedicated screen.

Approved overtime missed by its original run rolls into a later run once. Payroll reserves the source and carries it through adjustments. For contractual or hourly OT, add an overtime item with `overtimeSourceId` (the approved attendance claim's ID), minutes and the contractual `amountCents`; this replaces the fed amount without adding a second OT line. These fields are available through the API. Earlier-period OT keeps its original dates and the existing late-payment/AW classification warnings; review them before approving.
