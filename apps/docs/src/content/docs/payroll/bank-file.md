---
title: Bank payment file
description: Crow HR's generic ISO 20022 pain.001.001.03 salary file, what it contains and why you must check it with your bank first.
---

For an approved run, a payroll admin can download a **bank payment file** for the run's net pay. It is a generic ISO 20022 `pain.001.001.03` credit-transfer file. Downloading it needs a recent sign-in and is audit-logged.

## What it contains

- Category purpose `SALA` (salary) on the payment information and transaction purpose.
- The debit account from [payroll settings](/docs/payroll/settings/) (bank BIC, account number, account name).
- One credit transfer per employee to the bank account snapshotted at compute for the pay date, for their net pay.
- Employees without a bank account are left out and listed as excluded in the response and on screen.

The file validates against the official ISO 20022 XSD.

## Check it with your bank before first use

:::caution[Generic format, not tested with any bank]
Singapore's SS611 standard adopts `pain.001.001.03` but leaves the details to each bank, and banks publish their own implementation guides. The file is **not mapped to any bank's guide and has not been tested with any bank**.
:::

Known differences you may need to resolve with your bank:

- **Service level and rail**: the file has no service level or local instrument, so it does not choose FAST or GIRO. ANZ's Singapore guide, for example, requires service level `URNS` for FAST/PayNow.
- **Charge bearer** is fixed at `SLEV`; some banks expect another value or none.
- **BIC length**: some banks require 11-character BICs; the file accepts 8 or 11.
- **References**: some banks restrict the characters and length of end-to-end IDs.

Send your bank a sample file and ask for their validation before paying salaries with it. Bank-specific formats (DBS, OCBC, UOB and others) are not available.

## Bank details changed after computation

Compute snapshots the bank account, and submit, approval and the bank file check it against the current effective-dated record. A changed account makes the run stale. For a run in review, withdraw it, recompute and submit again. For an approved unpaid run, the API `POST /api/v1/payroll/runs/{id}/return-to-draft` (with a reason) allows recomputation and fresh approval; a later run using its CPF figures may require an adjustment instead. Paid runs require an adjustment. Administrative bank changes require recent re-authentication and notify the employee.

Creditor names containing Chinese, Tamil or other unsupported non-Latin scripts block file generation with an actionable error. Enter the bank-recognised Latin spelling as the account holder name, then recompute and re-approve. Crow HR does not silently strip these names from the file.
