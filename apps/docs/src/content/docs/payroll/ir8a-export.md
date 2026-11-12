---
title: IR8A export
description: Export each employee's IR8A figures from Crow HR in the column layout of IRAS's IR8A import template, for manual import in myTax Portal.
---

At year end, a payroll admin opens the IR8A panel on the **Payroll** page, chooses the income year and downloads the IR8A rows. The download contains full NRIC/FIN numbers, so it needs a recent sign-in. You paste them into IRAS's IR8A import template and import it in myTax Portal yourself.

## What you get

- CSV rows in the column layout of IRAS's **IR8A import template (version 1.0)**, to paste at row 6 of the template's IR8A sheet.
- At most **200 records per part**; a 201st employee starts a second part with record numbers restarting at 1.
- Income rounded **down** and deductions rounded **up** to the dollar.
- Masked IDs on screen; the file itself carries the full IDs IRAS needs. Treat it like any other file with NRIC numbers.

Crow HR does not fill or redistribute IRAS's workbook itself, because its licence is not confirmed. Download the template from IRAS.

## Where the figures come from

Approved payslips of the year plus the [year-to-date opening balances](/docs/people/importing/#year-to-date-opening-balances):

| IR8A item | Filled from |
| --- | --- |
| (a) Gross salary, fees, leave pay, wages and overtime | Basic pay after no-pay leave, overtime, back pay and other earnings |
| (b) Bonus | Bonus items, dated by their last pay date |
| d1 Allowances | Allowances and cash reimbursements whose claim type is marked taxable |
| d2 Commission | Commission items |
| Employee CPF | Employee CPF, including AW top-up recoveries |
| SHG donations | SHG deductions |

Back pay is reported in the year it was paid.

## Not filled: complete these yourself

- residential address (not recorded in Crow HR);
- director's fees;
- d3 gratuity, notice pay and similar (anything entered as "other earnings" lands in (a); move it by hand);
- d6 excess or voluntary employer CPF;
- tax borne by the employer, remission and exempt income;
- **Appendix 8A** (benefits in kind) and **Appendix 8B** (share plans): not produced at all.

Employees with an ID type other than NRIC or FIN, or without a recorded sex, are left out and listed with the reason. Leavers who needed IR21 tax clearance are only flagged; Crow HR does not prepare IR21.

## No direct submission

Direct submission through IRAS's AIS API is **not available**. It requires IRAS to approve the software, plus Corppass and APEX credentials and whitelisted servers. The export is for manual import in myTax Portal, which the employer does.

## Taxable cash reimbursements

A claim type's **Taxable benefit** flag marks its reimbursements as taxable cash benefits. Those enter d1; genuine business reimbursements stay out. The flag is recorded when payroll is computed, so changing a type later does not change past runs; claims paid outside payroll count in the year they were paid. A run replaced by an adjustment is counted once, as the adjustment.

This follows [IRAS's Tax Principles and Flexible Benefits](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/tax-principles-and-flexible-benefits): employers must track taxable benefits for IR8A. The flag does not determine whether a reimbursement legally attracts CPF, nor does it replace the separate Appendix 8A treatment of non-cash benefits or tax borne by the employer. Review those separately.
