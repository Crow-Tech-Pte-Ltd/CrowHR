---
title: Bank payment file
description: Crow HR's generic ISO 20022 pain.001.001.03 salary file, what it contains and why you must check it with your bank first.
---

For an approved run, a payroll admin can download a **bank payment file** for the run's net pay. It is a generic ISO 20022 `pain.001.001.03` credit-transfer file. Downloading it needs a recent sign-in and is audit-logged.

## What it contains

- Category purpose `SALA` (salary) on the payment information and transaction purpose.
- The debit account from [payroll settings](/docs/payroll/settings/) (bank BIC, account number, account name).
- One credit transfer per employee, for their net pay, to the bank account that was current on the pay date when the run was computed.
- Employees without a bank account are left out and listed as excluded on screen.

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

A run records each employee's bank account when it is computed. If an account changes afterwards, submitting, approving or downloading the bank file tells you the run is out of date:

- a run in review: withdraw it, recompute and submit again;
- an approved run that is not paid yet: choose **Return to draft** on the run, give the reason, then recompute and approve it again. If a later run already used its CPF figures, use an adjustment instead;
- a paid run: use an adjustment.

An administrator changing someone's bank details needs a recent sign-in, and the employee is notified.

Account holder names in Chinese, Tamil or another non-Latin script stop the file from being generated, with a message saying which. Enter the Latin spelling your bank has on record as the holder name, then recompute and approve again. Crow HR never strips such names from the file silently.
