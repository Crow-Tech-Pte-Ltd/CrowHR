## ADDED Requirements

### Requirement: Filing a claim for an employee
Members whose `claims:create` scope is `all` (owners and hr_admins) SHALL be able to file a claim for any employee of their organisation from the web claim form, by choosing the employee in the form. The form SHALL offer only the claim types that employee is eligible for, SHALL show that employee's remaining caps, and SHALL upload receipts as that employee's. A draft filed on behalf SHALL keep its employee when edited. Other members SHALL NOT see the employee picker. The server SHALL remain the authority: a create, upload or eligible-types request for another employee from a member without `all` scope fails with 404, as before.

#### Scenario: HR files a claim for an employee
- **WHEN** an hr_admin chooses Nadia Rahman in the claim form, picks Transport, enters S$18.40 and submits
- **THEN** the claim is Nadia's, submitted by the hr_admin, and goes to Nadia's approver

#### Scenario: Types follow the chosen employee
- **WHEN** an hr_admin chooses an intern in probation and a claim type is limited to full-time staff
- **THEN** the form does not offer that type, and the remaining caps shown are the intern's

#### Scenario: Picker hidden from employees
- **WHEN** an employee opens the claim form
- **THEN** no employee picker is shown, and a request naming another employee fails with 404

### Requirement: Exchange-rate warning
For each non-SGD line of a submitted claim, the system SHALL compare its rate with the last rate used in the organisation for that currency: the rate on the most recently submitted other claim in the same organisation, submitted before this claim and now `submitted`, `approved` or `paid`, that has a line in that currency (its last such line by position). When the rate differs from that rate by more than 20% of it, the line SHALL carry `fxWarning` with the last rate, the date it was submitted (Singapore time) and the signed deviation in basis points (magnitude rounded up). Exactly 20% SHALL NOT warn. Drafts, rejected and withdrawn claims, lines on the same claim and other organisations' claims SHALL NOT count as the last rate. With no earlier rate there SHALL be no warning. The claim detail page and the approval summary SHALL show the warning, and it SHALL NOT block submission or approval.

#### Scenario: Rate far from the last one
- **WHEN** the last MYR rate used was 0.300000 and a submitted claim has an MYR line at 0.400000
- **THEN** the approver sees that 0.400000 is 33.34% above the last MYR rate, 0.300000

#### Scenario: Exactly 20%
- **WHEN** the last MYR rate used was 0.300000 and a line uses 0.360000 or 0.240000
- **THEN** there is no warning, and 0.360001 or 0.239999 warns

#### Scenario: First rate for a currency
- **WHEN** no earlier submitted, approved or paid claim in the organisation used THB
- **THEN** a THB line carries no warning

### Requirement: Claim number order
Ordering claims by claim number SHALL be numeric: by the number's length, then its text, so `C-10000` follows `C-9999`. This SHALL apply to the claim list API, the line register and payout register exports, the report sources and the web tables.

#### Scenario: Crossing 9999
- **WHEN** an organisation has claims C-9999 and C-10000 and the list is sorted by `claimNumber`
- **THEN** C-9999 comes first ascending and C-10000 comes first descending

### Requirement: Unattached receipt cleanup
The scheduled sweep SHALL delete claim receipts that are attached to no claim line and were uploaded more than 7 days ago: the file row, its bytes in the file store and an audit event `file.unattached_removed` in the file's organisation. A receipt attached to any claim line (including a draft's) SHALL NOT be deleted, and files with another purpose SHALL NOT be touched. The sweep SHALL be idempotent and safe when two ticks run at once, claiming rows with `FOR UPDATE SKIP LOCKED` and re-checking the attachment when deleting.

#### Scenario: Old unattached receipt
- **WHEN** a receipt uploaded 8 days ago is on no claim line and the sweep runs
- **THEN** its row and bytes are deleted and the audit log records it

#### Scenario: Attached or recent receipts kept
- **WHEN** a receipt uploaded 30 days ago is on a draft line, or an unattached receipt was uploaded exactly 7 days ago
- **THEN** the sweep keeps it
