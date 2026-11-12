---
title: IR8A export
description: Export each employee's IR8A figures, and the Appendix 8A benefits-in-kind and Appendix 8B share-plan gains, from Crow HR in the column layout of IRAS's IR8A import template, for manual import in myTax Portal.
---

At year end, a payroll admin opens the IR8A panel on the **Payroll** page, chooses the income year and downloads the IR8A rows, plus the Appendix 8A and 8B rows for the benefits-in-kind and share-plan gains recorded under **Year end**. The downloads contain full NRIC/FIN numbers, so they need a recent sign-in. You paste them into IRAS's IR8A import template and import it in myTax Portal yourself.

## What you get

- CSV rows in the column layout of IRAS's **IR8A import template (version 1.0)**, to paste at row 6 of the template's IR8A sheet.
- For each part, up to three more files in the layout of the template's **Appendix 8A(Accommodation)**, **Appendix 8A(Hotel & Others)** and **Appendix 8B** sheets, to paste at row 2 of each. A button appears only when the part has rows for that sheet.
- At most **200 records per part**; a 201st employee starts a second part with record numbers restarting at 1. Each part's appendix files hold the appendix rows of that part's employees, because one workbook imports at most 200 IR8A records with their appendices.
- IR8A income rounded **down** and deductions rounded **up** to the dollar. Appendix 8A amounts keep their cents; Appendix 8B prices and share counts keep up to five decimal places.
- Masked IDs on screen; the files carry the full IDs IRAS needs. Treat them like any other file with NRIC numbers.

Crow HR does not fill or redistribute IRAS's workbook itself, because its licence is not confirmed. Download the template from IRAS.

### Pasting into the template

IRAS's template protects its sheets, and its grey columns are locked: myTax fills them in after import (the IR8A sheet's d7, d8 and the "Appendix 8A indicator"; the appendix sheets' number of days, value and total columns, and the Appendix 8B gross amount). Crow HR leaves those columns empty. If your spreadsheet refuses to paste a row block over them, paste the columns on either side of each grey column separately. After import, check the totals myTax shows against the [IR8A totals on the Year end screen](#appendix-8a-and-8b-benefits-and-share-gains).

## Where the figures come from

Approved payslips of the year plus the [year-to-date opening balances](/docs/people/importing/#year-to-date-opening-balances):

| IR8A item | Filled from |
| --- | --- |
| (a) Gross salary, fees, leave pay, wages and overtime | Basic pay after no-pay leave, overtime, back pay and other earnings |
| (b) Bonus | Bonus items, dated by their last pay date |
| d1 Allowances | Allowances and cash reimbursements whose claim type is marked taxable |
| d2 Commission | Commission items |
| d7(a), d7(b) Share-plan gains | Appendix 8B records (myTax computes them from the 8B sheet) |
| d8 Benefits-in-kind | Appendix 8A records (myTax computes them from the 8A sheets) |
| Employee CPF | Employee CPF, including AW top-up recoveries |
| SHG donations | SHG deductions |

Back pay is reported in the year it was paid. An employee with appendix records but no pay in the year, such as a former employee with a share gain, gets an IR8A record with only those amounts.

## Appendix 8A and 8B: benefits and share gains

Open **Payroll → IR8A panel → Benefits and share gains**, or go to **Year end** for the income year. Owners and payroll admins record, per employee:

- **Appendix 8A (benefits-in-kind)**: each place of residence (one record per address and unbroken period, at most 10 a year), with its utilities, driver and servant costs; hotel stays; cars; and the other item 4 benefits (home leave passages, interest benefits, insurance premiums, holidays, education, club fees, gains from assets, a vehicle given, other non-monetary awards).
- **Appendix 8B (share-plan gains)**: each ESOP exercise, or ESOW grant or vesting, in the year the gain accrues (at most 30 a year).

Leave out benefits IRAS exempts or grants a concession for, such as group medical insurance or festive gifts up to S$200 for all staff ([IRAS list](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/list-of-benefits-in-kind-granted-administrative-concession-or-exempt-from-income-tax)). Cash allowances, such as a housing or car allowance, are d1 allowances, not benefits-in-kind.

Every saved record shows what Crow HR computed, item by item, marked **computed** or **entered**, with the working. Every change is audit-logged.

### What Crow HR computes, and what you enter

Crow HR computes the values IRAS gives a formula for, using IRAS's [explanatory notes for Appendix 8A](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-form-ir8a-and-appendix-8a-for-ya2027.pdf) and [Appendix 8B](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-appendix-8b-for-ya2027.pdf), its pages on [accommodation](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/accommodation-and-related-benefits) and [cars](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/car-and-car-related-benefits), and the AIS data item rules. You enter the rest.

| Item | Computed by Crow HR | You enter |
| --- | --- | --- |
| Days of occupation or car use | Both ends counted | The dates |
| 2a Annual value, premises the employer owns | Annual value ÷ employees sharing × days ÷ 365 | The premises' annual value (property tax bill or e-Valuation List); or 2a itself if the annual value changed during the year |
| 2b Furniture and fittings | 40% of 2a if partly furnished (fittings only), 50% if fully furnished | Partly or fully furnished |
| 2c Rent, premises the employer rents | Rent ÷ employees sharing | Rent for the period, including furniture and fittings |
| 2f Taxable value of the residence | 2a + 2b, or 2c, less rent the employee paid; not below zero | Rent the employee paid |
| 2g Utilities, phone, gadgets; 2i servant, gardener | | Actual amounts |
| 2h Driver | Annual cost × private km ÷ total km | Cost and mileage |
| 3 Hotel stay | Cost less what the employee paid | Both amounts |
| 4i Car | 3/7 × [(cost − PARF rebate) ÷ 10 × days ÷ days in the year + running costs] for a new car; ÷ years to COE expiry (rounded up) for a second-hand car; (renewal cost + PARF rebate forgone) ÷ 5 or 10 for a renewed COE; 3/7 × (rental + running costs) for a leased car | Costs, rebate, years and running costs |
| 4a–4h, 4j | | The cost of each benefit. For 4b interest benefits, IRAS's rate is 3-month SORA + 1.5 points ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/benefits-relating-to-loans)) |
| 8B Gross gain | (open market value − price paid) × shares | Plan, grant date, the date the gain accrues, prices in S$ and shares |
| 8B section | ESOP granted before 1 Jan 2003: S10(1)(g), IR8A d7(b); everything else S10(1)(b), d7(a) | |
| IR8A d8, d7(a), d7(b) | Sum, decimals dropped | |

Computed values are rounded **down to the cent**: IRAS publishes no rounding rule, and its worked examples truncate. With this rule Crow HR reproduces IRAS's examples to the dollar.

For Appendix 8B, the gain accrues on the exercise date (ESOP), the vesting date (ESOW with vesting), the grant date (ESOW without vesting) or, with a selling moratorium, the day it is lifted. Use the SGX last done price on the listing date for listed shares, and the net asset value per share when there is no market price. Convert foreign prices to S$ at that day's rate, or at a source used consistently for all employees and years. IRAS does not take losses, and a loss can't offset another plan's gain. Fill in the granting company only when it isn't the employer.

### Not supported

- **Premises the employer owns** (annual value basis): IRAS's import template has this method disabled, so the accommodation row leaves 2a and 2b empty. The IR8A panel notes the 2a and 2b values to enter in myTax after import.
- **Leap years**: IRAS has not published how to apportion the annual value in a year of 366 days, so for income year 2028 Crow HR asks you to enter 2a yourself.
- **ERIS** records (phased out after YA 2024; IRAS asks software not to send them), **QEEBR** tax deferral (the employee applies) and the **deemed exercise** rule for leaving foreigners (reported in their IR21, which Crow HR does not prepare).
- Exchange rates, loan interest calculations and annual values are not looked up.
- Benefits-in-kind don't appear on payslips or affect CPF.
- Printed Appendix 8A and 8B forms for employers outside AIS.

## Not filled: complete these yourself

- residential address (not recorded in Crow HR);
- director's fees;
- d3 gratuity, notice pay and similar (anything entered as "other earnings" lands in (a); move it by hand);
- d6 excess or voluntary employer CPF;
- tax borne by the employer, remission and exempt income;
- 2a and 2b of premises the employer owns (see above).

Employees with an ID type other than NRIC or FIN, or without a recorded sex, are left out of the IR8A and appendix files and listed with the reason. Leavers who needed IR21 tax clearance are only flagged; Crow HR does not prepare IR21.

## No direct submission

Direct submission through IRAS's AIS API is **not available**. It requires IRAS to approve the software, plus Corppass and APEX credentials and whitelisted servers. The export is for manual import in myTax Portal, which the employer does.

## Taxable cash reimbursements

A claim type's **Taxable benefit** flag marks its reimbursements as taxable cash benefits. Those enter d1; genuine business reimbursements stay out. The flag is recorded when payroll is computed, so changing a type later does not change past runs; claims paid outside payroll count in the year they were paid. A run replaced by an adjustment is counted once, as the adjustment.

This follows [IRAS's Tax Principles and Flexible Benefits](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/tax-principles-and-flexible-benefits): employers must track taxable benefits for IR8A. The flag does not determine whether a reimbursement legally attracts CPF. Non-cash benefits are recorded under Year end (Appendix 8A), and tax borne by the employer is entered in myTax.
