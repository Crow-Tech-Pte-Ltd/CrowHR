## Purpose

Defines the employee record that every other module reads: identity and statutory attributes, employment and compensation history, lifecycle events, bulk import and export, onboarding and offboarding checklists, and self-service changes.

## ADDED Requirements

### Requirement: Employee identity and statutory fields
An employee SHALL have:
- an employee number unique within the organisation (auto-generated as `E0001`… unless entered);
- legal name and an optional preferred name;
- ID type (`nric`, `fin` or `other`) and ID number;
- date of birth, gender and nationality;
- residency status (`citizen`, `pr` or `foreigner`);
- race and religion, used for SHG fund derivation, and an SHG opt-out flag with its opt-out date.

NRIC and FIN values SHALL pass the checksum for their prefix: S/T for NRIC, and F/G/M for FIN, including the M series. PR start date SHALL be required when residency is `pr` and rejected otherwise. Date of birth SHALL be before the hire date, and a hire SHALL be refused when the employee is below the minimum employment age that `packages/sg-rules` returns for the hire date (TODO: value and citation from `research/sg-regulatory.md`). An ID number already used by another employee in the organisation SHALL be rejected with 409 `duplicate_id_number`. This includes former employees, and the response points to the rehire flow.

#### Scenario: Bad NRIC checksum
- **WHEN** an hr_admin saves NRIC `S1234567A` whose check letter is wrong
- **THEN** the save fails with "This NRIC's check letter does not match. Check the last letter against the card."

#### Scenario: PR without start date
- **WHEN** residency status `pr` is saved without a PR start date
- **THEN** the save fails, naming the field `prStartDate`

#### Scenario: Rehire detected
- **WHEN** a new employee is created with the NRIC of a former employee
- **THEN** the response is 409 `duplicate_id_number` with the former employee's ID and the message offers "Rehire this person instead"

### Requirement: Contact details and emergency contacts
An employee SHALL have a work email, personal email, mobile number and residential address with a 6-digit postal code for SG addresses, plus up to 3 emergency contacts (name, relationship, phone). Phone numbers SHALL be stored in E.164 format; an 8-digit number is taken as `+65`. The work email SHALL be unique among active employees and is the default email for that employee's invitation.

#### Scenario: Fourth emergency contact
- **WHEN** a fourth emergency contact is added
- **THEN** it is rejected with a message that at most 3 are allowed

### Requirement: Bank details
An employee SHALL have at most one current bank account: bank (from a maintained list of Singapore banks with their bank codes), account number (digits only, encrypted, masked to its last 4) and account holder name. Changing the account SHALL keep the previous one as history with the date it stopped being current. Payroll SHALL use the account that is current on the payment date.

#### Scenario: Bank change keeps history
- **WHEN** a payroll_admin replaces an employee's DBS account with an OCBC account effective 1 Nov 2026
- **THEN** a payment dated 31 Oct 2026 uses the DBS account and a payment dated 1 Nov 2026 uses the OCBC account

### Requirement: Work passes
A foreign employee SHALL have work pass records: pass type (Employment Pass, S Pass, Work Permit, Dependant's Pass with LOC, LTVP with LOC, ONE Pass, Training Employment Pass, or other; the list is maintained in `packages/sg-rules`), pass number (encrypted), issue date, expiry date, and an optional notes field. Employment records SHALL NOT be created for a `foreigner` without a pass valid on the start date. Passes that expire within 90 days SHALL be surfaced to HR by the reminders in `workflows`. An expired pass with no later pass SHALL show the employee as "Work pass expired" in the list.

#### Scenario: Foreigner without pass
- **WHEN** an hr_admin hires a `foreigner` with no work pass covering the start date
- **THEN** the hire fails with a message to add a work pass first

### Requirement: Effective-dated employment records
Employment terms SHALL be stored as non-overlapping records with `effective_from` (inclusive) and `effective_to` (exclusive, open when null). Each record carries job title, department, team, location, cost centre, manager, employment type (`full_time`, `part_time`, `contract`, `intern`), work schedule, probation end date, `ea_covered` (default true) and `is_workman` (default false). Part IV coverage SHALL be derived from salary and `is_workman` by `packages/sg-rules` at a given date, and SHALL NOT be stored. An employee SHALL NOT be their own manager, and a manager change that creates a reporting cycle SHALL be rejected. Querying "as at" any date SHALL return the record in force on that date.

#### Scenario: As-at query
- **WHEN** an employee transferred from Sales to Ops effective 1 Sep 2026
- **THEN** their record as at 31 Aug 2026 shows Sales and as at 1 Sep 2026 shows Ops

#### Scenario: Reporting cycle rejected
- **WHEN** A manages B and someone sets B as A's manager
- **THEN** the change fails with 409 `reporting_cycle`

### Requirement: Compensation history
Compensation SHALL be stored as non-overlapping effective-dated records with pay basis (`monthly` or `hourly`), an amount in integer cents (basic monthly pay, or hourly rate), and a reason. Recurring allowances SHALL be stored separately as effective-dated rows referencing an allowance type, with an amount in integer cents per month. A change dated before the most recent finalised payroll period SHALL be accepted only with an explicit `retroactive: true` flag, and SHALL be reported to payroll as a pending back-pay adjustment. Amounts SHALL be non-negative safe integers.

#### Scenario: Future raise
- **WHEN** a payroll_admin records basic pay S$4,200.00 from 1 Jan 2027 for someone earning S$4,000.00
- **THEN** compensation as at 31 Dec 2026 is 400000 cents and as at 1 Jan 2027 is 420000 cents

#### Scenario: Retro change without flag
- **WHEN** a raise effective 1 Sep 2026 is entered after the September payroll was finalised, without `retroactive: true`
- **THEN** it fails with a message that September is finalised and that a retroactive change will create a back-pay adjustment

### Requirement: Lifecycle events
Each change to employment or compensation SHALL be made through a lifecycle event that records the actor, the effective date and the resulting records. The event types are:
- `hire` (creates a tenure, employment record, compensation and membership invitation);
- `transfer`, `promotion` and `salary_change`;
- `probation_confirmed`;
- `resignation` (notice date, notice period in days, computed last working day counting the notice date as day 1, editable when shortened by agreement; the default notice period comes from the employment contract, falling back to the statutory minimum from `packages/sg-rules`, TODO cite);
- `termination` (reason: dismissal, retrenchment, contract end, retirement, death, mutual agreement; last working day);
- `rehire` (new tenure on the same employee, keeping history).

Events SHALL have status `scheduled` before their effective date and `effective` from it, computed from the date, not by a background job. A scheduled event SHALL be cancellable, and cancelling restores the prior records. Termination becoming effective SHALL trigger the `former` membership transition from `access-control` on the day after the last working day.

#### Scenario: Resignation computes last day
- **WHEN** an employee gives notice on 3 Nov 2026 with a 30-day notice period
- **THEN** the last working day is computed as 2 Dec 2026, an offboarding checklist is created, and the employee shows "Leaving 2 Dec 2026"

#### Scenario: Rehire keeps history
- **WHEN** a former employee who left on 30 Jun 2025 is rehired on 1 Mar 2026
- **THEN** they keep their employee ID and history and get a second tenure starting 1 Mar 2026

### Requirement: Bulk import with validation preview
HR SHALL import employees from CSV (UTF-8, comma-separated, header row, at most 5 MB and 2 000 data rows), using a downloadable template whose columns map one-to-one to fields. Separate templates SHALL import compensation and YTD opening balances. The YTD template records, for the current calendar year up to the last month paid in the previous system: ordinary wages, additional wages, employee CPF, employer CPF, SHG deductions and the last month covered, all in dollars with up to 2 decimals and converted to cents. Upload SHALL produce a preview: rows that will be created and every error as `row, column, value, message`. Nothing SHALL be written until the user confirms. Confirmation SHALL commit all rows in one transaction or none. Dates SHALL accept `YYYY-MM-DD` and `DD/MM/YYYY` only.

#### Scenario: Errors listed by cell
- **WHEN** a 120-row file has an invalid NRIC in row 7 and a missing department in row 52
- **THEN** the preview shows 118 valid rows and both errors with row number, column name and how to fix them, and the confirm button is disabled until the file is fixed and re-uploaded

#### Scenario: Unknown department
- **WHEN** a row names department "Finanse" that does not exist
- **THEN** the error says the department was not found and lists the closest existing name

#### Scenario: YTD opening balance
- **WHEN** a YTD file gives `ow_ytd` 36000.00 for an employee with last month covered June 2026
- **THEN** 3600000 cents is stored as their 2026 opening ordinary wages through June, available to payroll

### Requirement: Employee export
Users with list access SHALL export the employee list (current filters and chosen columns) to CSV or XLSX. Columns the user cannot read SHALL NOT be offered. Including unmasked NRIC/FIN or bank numbers SHALL require recent re-authentication. Every export SHALL be audit-logged with the column list and row count.

#### Scenario: Manager export
- **WHEN** a manager exports people
- **THEN** only their team appears and NRIC, compensation and bank columns are not available

### Requirement: Onboarding and offboarding checklists
HR SHALL maintain checklist templates of kind `onboarding` or `offboarding`. Each item has a title, an assignee role (hr_admin, payroll_admin, manager, employee) and a due offset in days relative to the start date or the last working day. One template of each kind can be the default. The default template SHALL be instantiated on `hire`, and on `resignation` or `termination`, with due dates computed from the event. Items SHALL be completable or skippable (with a reason) by the assigned role. Open items SHALL appear in assignees' Home inbox. Cancelling the triggering event SHALL cancel its checklist.

#### Scenario: Onboarding created on hire
- **WHEN** an employee is hired starting 1 Dec 2026 and the default onboarding template has "Issue KETs" for hr_admin due +14 days
- **THEN** an hr_admin inbox item "Issue KETs: <name>" due 15 Dec 2026 is created

### Requirement: Employee self-service changes
Employees SHALL directly edit their preferred name, personal email, mobile, address and emergency contacts; each edit is audit-logged. Changes to legal name, ID number, date of birth, residency status or PR start date, race, religion and bank details SHALL be submitted as a change request with an optional attachment. The request is routed through `workflows`: bank details to payroll_admin, all others to hr_admin. It SHALL be applied only when approved, from the effective date given by the approver. While a request is pending, the employee SHALL see the pending values marked "Awaiting HR approval", and the current values SHALL stay in force everywhere else.

#### Scenario: Bank change needs approval
- **WHEN** an employee submits new bank details
- **THEN** payroll continues to use the old account until a payroll_admin approves, and the employee sees "Awaiting approval"

#### Scenario: Direct edit
- **WHEN** an employee updates their mobile number
- **THEN** it is saved immediately and an audit event records the change
