---
title: CPF EZPay file
description: Download the CPF EZPay (FTP) submission file for a Crow HR payroll run and upload it to CPF EZPay yourself.
---

For an approved or paid run, a payroll admin downloads the **CPF EZPay submission file** from the run page and uploads it in CPF's EZPay service. Crow HR does not submit to CPF Board directly.

## Format

The file follows CPF Board's *CPF EZPay (FTP) File Specifications* effective 16 January 2025:

- fixed-length records of 150 characters: employer header, a summary record per payment code, detail records, employer trailer with record count and total;
- file name `<CSN><MonYYYY><advice code>.DTL`;
- payment codes CPF (01), MBMF (02), SINDA (03), CDAC (04), ECF (05) and SDL (11);
- employment status E, L, N or O from the join and leave dates;
- names stripped of the characters the specification forbids.

It contains the amounts **this run charged**. An adjustment run produces a supplementary file with only the difference.

## Refusals and exclusions

Generation stops with a message saying how to fix it when:

- the company profile has no CSN;
- an amount would be negative;
- a CPF account number does not start with S or T.

Employees without an S/T number who have an SHG contribution (foreign employees) are left out of the detail records with a warning to key them in EZPay; their SHG is written as a summary record only.

## Advice codes

The month's regular run uses the advice code from [payroll settings](/docs/payroll/settings/) (usually `01`). Each later run of the same month gets the next free code. A month that would need a code past 99 is refused rather than reusing a code.

## Not confirmed by CPF Board

The file is tested against a committed golden file built from the specification, but it **has not been accepted by CPF's systems in a real submission**, and CPF Board has not reviewed it. Points the specification does not settle:

- whether foreign employees' SHG should appear as a summary record only (what Crow HR does);
- how a top-up on earlier AW should be declared: Crow HR reports it in the current month's amount with no new AW in that month's AW column.

Check the first file you upload against CPF EZPay's own validation and your payroll records.
