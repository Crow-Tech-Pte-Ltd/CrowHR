## Purpose

Defines how a payroll run is prepared, computed, reviewed, approved and paid for one organisation, how each employee's pay is built from pay items, and how the run stays reproducible and auditable.

## ADDED Requirements

### Requirement: Pay items
For each employee in a run, pay SHALL be built from these items, all in integer cents:
- **Basic pay** from the compensation records in force during the period. A monthly-rated employee who works the whole period with no no-pay leave SHALL be paid the monthly amount. Otherwise each compensation segment SHALL be paid by MOM's incomplete-month formula (monthly rate / working days in the month × days worked in the segment), using the employee's work schedule, with no-pay leave days removed from the days worked; the result is rounded half up to the cent. Hourly-rated employees SHALL be paid rate × hours entered for the run.
- **Recurring allowances** in force during the period, pro-rated the same way unless the allowance type is set not to pro-rate; CPF-liable as OW unless the allowance type is set as not CPF-liable.
- **One-off earnings**: bonus, commission, back pay or other, each classified OW or AW. An AW item SHALL carry an AW payable date inside the run's period.
- **Overtime**, entered manually as minutes worked and the OT period. Statutory OT pay for Part 4 employees SHALL be computed by sg-rules; for other employees an amount SHALL be entered.
- **Claims reimbursement** read from the claims `ReimbursementSource`, never CPF-liable.
- **Deductions** with an Employment Act category.
- **Employer-only costs**: CPF employer share, SDL and an FWL estimate (never deducted from pay).

#### Scenario: Mid-month joiner
- **WHEN** an employee on S$4,000.00 a month on a Monday–Friday schedule joins on 16 Mar 2026 (12 of 22 working days)
- **THEN** basic pay is S$2,181.82 and CPF is computed on that amount

#### Scenario: No-pay leave
- **WHEN** an employee on S$3,000.00 takes 2 days of no-pay leave in a 22-working-day month
- **THEN** the payslip shows basic S$3,000.00 and a "No-pay leave (2 days)" deduction of S$272.73

### Requirement: Employment Act deduction limits
Deductions SHALL be checked against MOM's limits: damage or loss, accommodation, amenities and services each at most 25% of the period's salary; advances and loans each at most 25% per instalment; and all deductions together at most 50% of the salary payable, excluding absence, advances, loans, overpaid salary and co-operative society payments. Employee CPF counts towards the 50% limit. A breach SHALL be a blocking issue naming the deduction, the limit and the amount over it. The 50% limit SHALL be a warning, not a blocking issue, on an employee's final pay.

#### Scenario: Over the 50% limit
- **WHEN** an employee's deductions subject to the limit total 55% of salary
- **THEN** the run shows a blocking issue explaining the 50% limit and how much to reduce, and cannot be submitted for review

### Requirement: Payroll runs and lifecycle
A run SHALL belong to one organisation and one calendar month period, with a pay date (defaulting from payroll settings). Kinds: `regular` (one active per month), `off_cycle` (`final_pay` for chosen employees, who are then left out of that month's regular run, or `bonus` with only one-off items) and `adjustment`. States: `draft` → `in_review` → `approved` → `paid`. Inputs SHALL be editable only in draft. Submitting for review SHALL require a computation with no blocking issues whose inputs still match the current records; if records changed since computing, submission SHALL fail with 409 telling the user to recompute. A pay date more than 7 days after the period end SHALL be a warning citing MOM's salary payment rule; with overtime in the run, a pay date more than 14 days after the period end SHALL also warn. Every transition SHALL be audit-logged.

#### Scenario: Stale inputs
- **WHEN** a payroll_admin changes an employee's basic pay after the run was computed and then submits it
- **THEN** submission fails with 409 and the message asks them to recompute the run

### Requirement: Approval through the approvals engine
Submitting a run SHALL create a `payroll_run` approval request with the run's net total as `amountCents`. The decision SHALL call the payroll adapter in the same transaction: approval moves the run to `approved`, rejection returns it to `draft` with the comment. Until the workflows engine is wired, an owner or payroll_admin other than the submitter SHALL decide; an owner who submitted MAY decide and the decision SHALL be marked self-approved.

#### Scenario: Rejected run
- **WHEN** the owner rejects a run in review with "Bonus for Ravi is wrong"
- **THEN** the run returns to draft and shows the comment

### Requirement: Reopen creates an adjustment
Reopening an approved or paid run SHALL create an `adjustment` run for the same month that starts from a copy of the original inputs. The original run's figures, payslips and files SHALL never change; it is marked superseded only when the adjustment is approved. CPF, SHG and SDL charged by the adjustment SHALL be the difference between the corrected month and what earlier runs of that month charged, and each payslip SHALL show the net amount still payable or overpaid. Reopening SHALL be audit-logged with a reason.

#### Scenario: Correcting a paid run
- **WHEN** a payroll_admin reopens the paid October run to add a missed S$200 allowance for one employee and the adjustment is approved
- **THEN** the October run still shows its original figures, the adjustment payslip shows the revised October pay and the S$200 allowance less the extra employee CPF as still payable, and CPF charged by the adjustment is only the extra contribution

### Requirement: Deterministic and persisted computation
Each employee result SHALL be computed by a pure function of an input snapshot. The snapshot (employee particulars, compensation, allowances, items, schedule, YTD CPF state before the month, earlier runs of the month), the rate-table ids, the full working, the issues and the YTD/AW-ceiling state after the month SHALL be stored per employee per run, with SHA-256 hashes of the canonical JSON of inputs and results. Recomputing the same snapshot SHALL give a byte-identical result. The next month's CPF SHALL start from the stored state after the latest effective run of an earlier month of the same year, or from the employee's YTD opening balance.

#### Scenario: Recompute from the snapshot
- **WHEN** a stored employee snapshot is recomputed a year later
- **THEN** the result's hash equals the stored result hash

### Requirement: Statutory refusals are blocking issues
When sg-rules refuses a case (for example `CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED`) or rejects an input, the employee's result SHALL carry a blocking issue with the rule's explanation and source, the rest of the run SHALL still compute, and the run SHALL not be submittable until it is resolved. Payroll SHALL also be blocked until the company profile has a UEN, CSN and address.

#### Scenario: Unsupported low-wage AW case
- **WHEN** an employee's month falls in CPF's unsupported low-wage capped-AW case
- **THEN** the run lists a blocking issue for that employee with CPF's explanation, and other employees' pay is still shown

### Requirement: Review
The run overview SHALL show blocking issues and warnings first, then totals (gross, net, employee and employer CPF, SHG, SDL, FWL estimate, reimbursements) and headcount, then changes since the previous month's regular run (joiners, leavers, basic pay changes, new one-off items, net changes). The employee table SHALL be dense, right-align numbers in a monospaced font and be navigable by keyboard (move with arrow keys or j/k, open with Enter, close with Escape, next/previous employee in the drawer). The drawer SHALL show every line, the CPF, SDL and SHG working with each rule table's effective date and source link, the inputs, and the issues.

#### Scenario: Changes since last month
- **WHEN** October has one joiner, one leaver and one raise compared with September
- **THEN** the overview reads "3 changes since September" and lists them

### Requirement: Payroll access
Payroll runs, items and files SHALL require `payroll:*` permissions (owner and payroll_admin). hr_admin and managers SHALL get 403. Records of another organisation SHALL answer 404.

#### Scenario: hr_admin without payroll role
- **WHEN** a member with only hr_admin opens a payroll run
- **THEN** the API answers 403
