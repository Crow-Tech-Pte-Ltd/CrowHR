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

The API also has a **cutoff day** (`cutoffDay` in `PUT /api/v1/payroll/settings`; not on the screen yet). Payroll admins get a reminder 3 days before it, or before the pay day when it is not set, until the month's regular run is approved.

## Allowance treatment

Each recurring allowance type has three settings. There is no screen for them yet: set them with `PUT /api/v1/payroll/allowance-settings/{allowanceTypeId}` ([API reference](/docs/api/payroll/)).

| Setting | Default | Meaning |
| --- | --- | --- |
| `cpfLiable` | `true` (ordinary wages) | Whether the allowance is subject to CPF. Decide with CPF's guidance on [what counts as wages](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions). |
| `prorate` | `true` | Whether it is pro-rated in an incomplete month. |
| `grossRateIncluded` | not set | Whether it counts in the Employment Act gross rate of pay, used for public holiday pay and leave encashment. Set `true` for fixed contractual salary allowances and `false` for variable or irregular payments, productivity incentives, reimbursements, and travelling, food and housing allowances. Overtime, bonuses and AWS never count ([MOM: gross rate of pay](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary)). |

Classify every active allowance for the gross rate. While one is not set, payroll can't work out that employee's public holiday pay (the run blocks with `PH_GROSS_RATE_REQUIRED`) and leave encashment can't be requested for them; both messages name the allowance to classify. Changing a setting later does not reprice encashment requests already made.

## Run items without a screen

Two kinds of run item can only be added through the API ([API reference](/docs/api/payroll/)):

- **Public holiday pay for hourly or rostered staff.** Under the leave rule **Pay an extra day (payroll)**, an employee covered by the Employment Act earns one day's gross pay for a public holiday on an off day. Payroll adds it automatically for employees on a monthly rate and a fixed week. For anyone else the run blocks with `PH_GROSS_RATE_REQUIRED` until you add an `other_earning` item with `holidayDate` and the agreed daily gross `amountCents`.
- **An amount for overtime fed from attendance.** For contractual or hourly-paid overtime, add an `overtime` item with `overtimeSourceId` (the approved attendance claim's ID), the minutes and the contractual `amountCents`. It replaces the fed item, so the overtime is not paid twice.
