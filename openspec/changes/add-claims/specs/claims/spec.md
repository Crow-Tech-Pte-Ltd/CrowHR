## Purpose

Defines how employees claim reimbursement for business and benefit expenses, how caps and receipts are enforced, how claims are approved, and how approved claims are paid through payroll or outside it.

## ADDED Requirements

### Requirement: Claim types
Owners and hr_admins SHALL configure claim types with: name, unique code, category (`medical`, `dental`, `transport`, `meals`, `entertainment`, `travel`, `phone`, `training`, `other`), `receipt_required` (`always`, `never`, or `above` an amount in cents), cap amount in cents with period (`per_claim`, `monthly`, `yearly`, `none`), eligible employment types, `available_during_probation` (default true), default payout (`payroll` or `outside`), `taxable` flag and GL code. Caps are per employee and counted by the expense date's calendar month or year. A claim type in use SHALL be archivable but not deletable.

#### Scenario: Ineligible type hidden
- **WHEN** an intern opens the claim form and "Phone allowance claim" is limited to `full_time`
- **THEN** the type is not offered, and an API submission using it fails with 422 `not_eligible`

### Requirement: Multi-line claims
A claim SHALL contain 1 to 30 lines. Each line SHALL have: claim type, expense date (not in the future, and not older than the organisation's submission window, default 90 days), merchant, description (1 to 200 characters), currency (ISO 4217), amount in that currency's minor units (positive), optional GST in SGD cents, and receipts. The claim total SHALL be the sum of line SGD amounts. A submitted claim SHALL NOT be edited. The employee withdraws it, or copies a rejected claim into a new draft. Drafts SHALL be saved without validation of required receipts, and are validated on submit.

#### Scenario: Old expense
- **WHEN** a line has an expense date 120 days ago and the window is 90 days
- **THEN** submission fails, naming the line and saying expenses older than 90 days cannot be claimed

#### Scenario: Copy rejected claim
- **WHEN** an employee copies a rejected claim
- **THEN** a new draft is created with the same lines and receipts and the rejected claim is unchanged

### Requirement: Currency conversion
For a non-SGD line, the employee SHALL enter an exchange rate (SGD per 1 unit of the foreign currency) as a decimal with up to 6 decimal places, stored as an integer number of millionths. The SGD amount SHALL be computed with integer arithmetic as `amountMinor × rateMicros`, scaled by the currency's minor-unit exponent, and rounded half-up to the cent. The computed SGD amount SHALL be shown before submission. Approvers SHALL see the original amount, the rate and the SGD amount.

#### Scenario: Ringgit conversion
- **WHEN** a line is MYR 125.50 (12550 minor units) at rate 0.301234
- **THEN** the SGD amount is 3780 cents (S$37.80, from 37.804867 rounded half-up)

#### Scenario: Zero-decimal currency
- **WHEN** a line is JPY 5,000 (exponent 0) at rate 0.008912
- **THEN** the SGD amount is 4456 cents

### Requirement: GST field
Each line SHALL accept an optional GST amount in SGD cents that is at least 0 and at most the line's SGD amount. GST SHALL be rejected on non-SGD lines. GST SHALL be included in the line amount, not added to it, and SHALL be reported separately in claim reports.

#### Scenario: GST on foreign line
- **WHEN** a USD line carries a GST amount
- **THEN** submission fails with "GST applies only to SGD expenses. Remove the GST amount for this line"

### Requirement: Caps
On submission, each line's SGD amount, plus that employee's `submitted` and `approved` claims of the same type in the same cap period, SHALL NOT exceed the cap. If it does, submission SHALL fail with 422 `cap_exceeded`, stating the cap, the amount used, the amount pending and the remaining amount. On approval the check SHALL be repeated, counting only other `approved` and `paid` claims. If the cap would be exceeded then, approval SHALL fail with the same detail. Per-claim caps apply to the sum of that claim's lines of the type. The claim form SHALL show the remaining amount per type as the employee fills it in.

#### Scenario: Monthly cap
- **WHEN** a type has a S$100.00 monthly cap, the employee has S$70.00 approved this month and submits S$40.00
- **THEN** submission fails with `cap_exceeded`: cap S$100.00, used S$70.00, pending S$0.00, remaining S$30.00

#### Scenario: Cap rechecked at approval
- **WHEN** two S$60.00 claims against a S$100.00 monthly cap were submitted while each fit, and the first is approved
- **THEN** approving the second fails with `cap_exceeded` and the approver can reject it with the shown reason

### Requirement: Receipts
Receipts SHALL be PDF, JPEG, PNG, WebP or HEIC, identified by file signature rather than extension, at most 10 MB each and 5 per line. They are stored through the injected file store under the organisation's prefix. A line whose type requires a receipt (always, or above the configured amount) SHALL NOT be submitted without one. When a file scanner is configured, new receipts SHALL be `pending_scan` and the claim SHALL NOT be submitted until all its receipts are `clean`. `infected` files SHALL be deleted, with the uploader told to upload a different file. When no scanner is configured, receipts SHALL be `unscanned`, and owners SHALL see that scanning is off in Settings. A receipt whose SHA-256 matches a receipt on another non-rejected claim in the organisation SHALL be flagged "Possible duplicate" to approvers with a link to the other claim, and SHALL NOT be blocked.

#### Scenario: Renamed executable
- **WHEN** a file named `receipt.pdf` whose content is a Windows executable is uploaded
- **THEN** it is rejected with "This file is not a PDF or image. Upload a photo or PDF of the receipt"

#### Scenario: Duplicate receipt flagged
- **WHEN** an employee attaches the same receipt image used in last month's approved claim
- **THEN** the approver sees "Possible duplicate of claim C-0042" on that line

### Requirement: Submission and approval
Submitting SHALL validate the claim, assign a claim number unique within the organisation (`C-0001`…), set the status to `submitted` and create a `workflows` request of subject type `claim` with `amountCents` set to the claim total and `typeCode` set to the codes of its lines. The approver view SHALL show lines, receipts (subject to medical sensitivity), cap usage per type and duplicate flags. Final approval SHALL set the status to `approved` with the payout method taken from the claim types; a claim with mixed payout types SHALL use `payroll`. Rejection SHALL set `rejected` with the comment. Withdrawal by the employee SHALL be allowed while `submitted`.

#### Scenario: Approved claim
- **WHEN** the last approver approves a S$45.60 transport claim
- **THEN** its status is `approved`, its payout is `payroll`, and the employee is notified

### Requirement: Reimbursement through payroll
Claims SHALL expose `ReimbursementSource.listPayable(orgId, periodEnd)` returning approved, unpaid, payroll-payout claims approved on or before `periodEnd`. Each entry gives employee, claim ID, number, type code, `taxable` and SGD amount in cents. When payroll attaches a claim to a run, the claim SHALL be reserved for that run, and other runs SHALL NOT list it. When the run is finalised, the claim SHALL become `paid` with the run's payment date. If the run is discarded before finalisation, the reservation SHALL be released. A claim SHALL be paid at most once.

#### Scenario: Claim approved after cutoff
- **WHEN** October payroll lists payables with `periodEnd` 31 Oct 2026 and a claim is approved on 1 Nov 2026
- **THEN** it is not listed for October and is listed for November

#### Scenario: Discarded run releases claims
- **WHEN** a draft run that reserved 3 claims is discarded
- **THEN** those 3 claims are payable again

### Requirement: Payment outside payroll
Payroll_admins and owners SHALL be able to mark one or more `approved` claims as paid outside payroll, with a payment date and reference (1 to 100 characters). Those claims become `paid` and are no longer payable through payroll. A claim reserved by a payroll run SHALL NOT be marked paid outside it.

#### Scenario: Bulk mark paid
- **WHEN** a payroll_admin marks 5 approved claims paid on 4 Nov 2026 with reference "FAST 4 Nov"
- **THEN** all 5 become `paid`, each audit event records the reference, and none appear in November's payables

### Requirement: Claim reports
Claims SHALL register reports with `reporting`:
- claims by type, department and month (count, SGD total, GST total);
- claims by status with age (submitted for more than 7 days highlighted);
- per-employee cap usage for a period;
- payout register (paid claims with method, date and reference).

Medical claim amounts SHALL appear in totals, and receipts and descriptions of medical lines SHALL be omitted for readers without `medical` access.

#### Scenario: Department totals
- **WHEN** an hr_admin runs claims by department for October 2026
- **THEN** each department shows the count, the SGD total and the GST total of claims with expense dates in October, by status
