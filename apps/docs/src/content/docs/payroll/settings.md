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

Open **Payroll → Settings**:

| Setting | What it does |
| --- | --- |
| Pay day | Day of the month for the default pay date; empty means the last day of the month. MOM requires salary to be paid within 7 days after the end of the salary period, and the run warns when the pay date is later. |
| Cutoff day | Day of the month payroll inputs close. Payroll admins get a reminder 3 days before it, or before the pay day when it is empty, until the month's regular run is approved. |
| Release payslips on approval | Off by default: payslips become visible to employees only when a payroll admin releases them. On: they are released automatically when the run is approved. |
| CPF advice code | Two digits for the EZPay file, usually `01`. Later runs in the same month get the next free code. |
| Foreign worker levy: sector, tier and skill | Your company's profile for the [FWL estimate](/docs/payroll/shg-sdl-fwl/#foreign-worker-levy-estimate). Sectors: services, manufacturing, construction, process, marine shipyard. |
| Debit account: bank SWIFT/BIC, account number, account name | The account salaries are paid from, written into the [bank file](/docs/payroll/bank-file/). |

## Allowance treatment

**Payroll → Allowance treatment** (also under **Settings**) lists each recurring allowance type with three settings. Owners and payroll admins change them; a change applies the next time a draft run is computed.

| Setting | Default | Meaning |
| --- | --- | --- |
| CPF | CPF-liable (ordinary wages) | Whether the allowance is subject to CPF. Decide with CPF's guidance on [what counts as wages](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions). |
| Incomplete month | Pro-rated | Whether it is pro-rated, like basic pay, in a month someone joins or leaves. |
| Gross rate of pay | Not set | Whether it counts in the Employment Act gross rate of pay, used for public holiday pay and leave encashment. **Included** for fixed contractual salary allowances; **Excluded** for variable or irregular payments, productivity incentives, reimbursements, and travelling, food and housing allowances. Overtime, bonuses and AWS never count ([MOM: gross rate of pay](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary)). |

The gross rate has no default because no answer is right for every allowance. Answer it for each allowance before your first run: while one is not set, every run lists it as a warning (`ALLOWANCE_GROSS_RATE_UNSET`, with a link to this screen), a public holiday on an off day blocks payroll for the staff who get it (`PH_GROSS_RATE_REQUIRED`), and their leave encashment can't be requested. Changing a setting later does not reprice encashment requests already made.

Allowance types, and the recurring allowances on each employee, are added through the API for now ([API reference](/docs/api/)): allowance types under organisation settings, and allowances on a hire or pay-change event. They show on the employee's **Pay** tab.

## Holiday pay and contractual overtime on a run

Two kinds of item need an amount that only you know. The run's issue says so and links to the employee's drawer with the item ready to fill in:

- **Holiday pay for hourly or rostered staff.** Under the leave rule **Pay an extra day (payroll)**, an employee covered by the Employment Act earns one day's gross pay for a public holiday on an off day. Payroll adds it automatically for employees on a monthly rate and a fixed week. For anyone else the run blocks with `PH_GROSS_RATE_REQUIRED` until you choose **Enter holiday pay** and enter the day's gross pay; the item is tied to that holiday, so it is paid once.
- **Overtime from attendance without a statutory rate.** For employees not covered by Part 4, or paid by the hour, approved overtime blocks the run (`OT_NOT_STATUTORY`, `OT_AMOUNT_REQUIRED`). Choose **Enter the overtime amount**, or **Enter amount** next to the overtime under **From other modules** in the drawer, and enter the contractual pay for those hours. It replaces the fed amount for that overtime claim, so the overtime is not paid twice.

Manual items can be edited or removed from the drawer while the run is a draft. Through the API these are an `other_earning` item with `holidayDate`, and an `overtime` item with `overtimeSourceId` (the approved overtime claim's ID); see the [API reference](/docs/api/payroll/).
