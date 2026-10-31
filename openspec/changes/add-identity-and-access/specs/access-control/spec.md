## Purpose

Defines who may see and do what inside a Crow HR organisation: roles, the permission matrix, manager and self scopes, field-level sensitivity, organisation data isolation and the audit log.

## ADDED Requirements

### Requirement: Roles and assignment
Each membership SHALL hold zero or more assigned roles from `owner`, `hr_admin` and `payroll_admin`. Two further roles are not assigned. `employee` SHALL apply implicitly when the membership is linked to an employee record. `manager` SHALL apply while the linked employee has at least one active direct report. Only owners SHALL grant or revoke `owner`, `hr_admin` or `payroll_admin`, and hr_admins SHALL be able to invite members with no assigned roles only. An organisation SHALL always have at least one active owner: revoking the last owner role, or suspending the last owner, SHALL fail with 409 `last_owner`. Role changes SHALL take effect on the member's next request.

#### Scenario: hr_admin tries to grant payroll_admin
- **WHEN** an hr_admin assigns `payroll_admin` to a member
- **THEN** the response is 403 `forbidden` and no role changes

#### Scenario: Last owner protected
- **WHEN** the only owner removes their own owner role
- **THEN** the response is 409 `last_owner`

### Requirement: Permission matrix
Every API route SHALL be authorised server-side against the matrix below before any data is read. Scopes: **A** = all records in the organisation, **T** = the member's team (direct and indirect reports, not including themselves), **O** = the member's own records, **—** = denied. The effective permission of a member is the union over their roles. Read access to a resource does not imply access to sensitive fields; the sensitivity requirement governs those.

| Resource | Action | owner | hr_admin | payroll_admin | manager | employee |
| --- | --- | --- | --- | --- | --- | --- |
| Security settings (sign-in methods, SSO, MFA policy, timeouts) | read, update | A | — | — | — | — |
| Members, invitations, role grants | read | A | A | A | — | — |
| Members, invitations, role grants | create, update | A | A (no role grants) | — | — | — |
| Company profile, departments, teams, locations, cost centres, work schedules | read | A | A | A | A | A |
| Company profile, departments, teams, locations, cost centres, work schedules | create, update, archive | A | A | — | — | — |
| Employee directory (name, photo, job title, department, team, location, work email/phone, manager) | read | A | A | A | A | A |
| Employment record and lifecycle events | read | A | A | A | T | O |
| Employment record and lifecycle events | create, update | A | A | — | — | — |
| Personal details (DOB, residency, race, religion, personal contact, address) | read | A | A | A | — | O |
| Emergency contacts | read | A | A | — | T | O |
| Personal details and emergency contacts | update | A | A | — | — | O (via change request where required) |
| Work pass | read | A | A | A | — | O |
| Work pass | create, update | A | A | — | — | — |
| Compensation (basic pay, allowances, history) | read | A | — | A | — | O |
| Compensation | create, update | A | — | A | — | — |
| Bank details | read, update | A | — | A | — | O (update via change request) |
| Payroll runs, statutory files | read, create, update, finalise | A | — | A | — | — |
| Payslips, tax forms | read | A | — | A | — | O (released only) |
| Leave, claims, attendance, OT, timesheets | read | A | A | A | T | O |
| Leave, claims, attendance, OT, timesheets | create | A (on behalf) | A (on behalf) | — | — | O |
| Approval tasks | decide | assigned | assigned | assigned | assigned | assigned |
| Rosters and shifts | read | A | A | — | T | O + published roster of own location |
| Rosters and shifts | create, update, publish | A | A | — | T | — |
| Documents (non-medical categories) | read | A | A | categories marked payroll-visible | T, categories marked manager-visible (never medical) | O, categories marked employee-visible |
| Documents | create, update, delete | A | A | — | — | O upload to employee-uploadable categories |
| Approval policies, notification templates, leave and claim types | read, update | A | A | claim types read | — | — |
| Reports (headcount, turnover, leave, claims, attendance) | read, export | A | A | claims only | T (leave, attendance) | — |
| Reports (payroll cost) | read, export | A | — | A | — | — |
| Audit log | read, export | A | A (non-security events) | A (payroll events) | — | — |

#### Scenario: Matrix enforced per cell
- **WHEN** the table-driven permission test calls each route as each role, both against an in-scope record and against an out-of-scope record
- **THEN** each call succeeds or fails exactly as the matrix states, with 403 `forbidden` for denied actions on records the caller may know exist and 404 `not_found` otherwise

#### Scenario: Frontend hiding is not relied on
- **WHEN** an employee calls `GET /api/v1/employees/<id>/compensation` for a colleague directly
- **THEN** the response is 404 `not_found`

### Requirement: Manager scope
A manager's team SHALL be every employee whose current reporting chain, as at today's date in Asia/Singapore, leads to the manager through any number of levels. The chain SHALL be resolved from effective-dated employment records. Resolution SHALL terminate on cycles, which are reported as a data error, and SHALL NOT include the manager. When a reporting line changes, the team SHALL change on the next request.

#### Scenario: Indirect report visible
- **WHEN** A manages B and B manages C, and A requests C's leave history
- **THEN** the request succeeds

#### Scenario: Former report hidden
- **WHEN** C's manager changed from B to D effective yesterday
- **THEN** B can no longer read C's employment record or leave

### Requirement: Self-service and segregation of duties
Employees SHALL be able to read their own records within the O cells of the matrix. Nobody SHALL directly change their own compensation or bank details, even when holding `payroll_admin` or `owner`. Such changes SHALL go through a change request decided by another eligible member. If no other eligible member exists, an owner SHALL be allowed to self-approve, and the decision SHALL be marked `self_approved`. Nobody SHALL decide an approval task for their own request except under that same rule.

#### Scenario: payroll_admin edits own salary
- **WHEN** a payroll_admin calls the compensation update endpoint for their own employee record
- **THEN** the response is 403 `self_change_requires_approval` and a change request is offered instead

### Requirement: Field-level sensitivity
Fields SHALL carry at most one sensitivity class:
- `salary`: basic pay, allowances, payslip amounts, payroll lines, claim payout on payslip.
- `nric`: NRIC/FIN, passport number, work pass number.
- `bank`: bank account number and account name.
- `medical`: medical-category documents, sick-leave certificates, medical claim receipts.

Readers SHALL receive a sensitive field only if the matrix grants them its resource. `medical` additionally SHALL be readable only by owner, hr_admin, the employee themselves, and the member currently assigned an approval task for the specific item it is attached to. API responses SHALL omit unauthorised sensitive fields and list them in `redactedFields`. Exports and reports SHALL apply the same rules.

#### Scenario: Manager approves medical claim
- **WHEN** a manager is the assigned approver of a medical claim and opens it
- **THEN** they can view its receipt, and they cannot view that employee's other medical documents

#### Scenario: hr_admin views employee
- **WHEN** an hr_admin reads an employee profile
- **THEN** compensation and bank fields are absent and `redactedFields` lists them

### Requirement: NRIC/FIN masking and reveal
NRIC/FIN values SHALL be returned masked by default as the first character, four asterisks, the last three digits and the check letter (`S1234567D` becomes `S****567D`). Members with read access to the `nric` class SHALL be able to reveal one full value at a time through a dedicated endpoint. The endpoint requires recent re-authentication, is limited to 30 reveals per member per hour, and records `nric.revealed` with the target employee. Bank account numbers SHALL be masked to their last four digits with the same reveal rules.

#### Scenario: Reveal is audited
- **WHEN** a payroll_admin reveals an employee's NRIC
- **THEN** the full value is returned once, not cached by the client beyond the open view, and an audit event names the admin, the employee and the time

### Requirement: Encryption of sensitive identifiers and secrets
NRIC/FIN, passport and work pass numbers, bank account numbers, TOTP secrets, SSO client secrets and private keys SHALL be stored encrypted with AES-256-GCM under a key derived from `CROWHR_SECRET_KEY`. Each ciphertext SHALL carry a key identifier. NRIC/FIN and bank account numbers SHALL also store a keyed HMAC for exact-match lookup and duplicate detection. The server SHALL refuse to start without a valid 32-byte key, whether supplied by environment or generated on first boot into the data volume, and SHALL refuse a key that does not match the check value stored in the database.

#### Scenario: Database dump does not expose NRIC
- **WHEN** the `employees` table is read directly with SQL
- **THEN** no column contains a plaintext NRIC/FIN

### Requirement: Organisation data isolation
Every tenant table SHALL have a non-null `org_id`. All reads and writes SHALL go through org-scoped data access that adds the caller's organisation. References between tenant tables SHALL be composite foreign keys including `org_id`. Requests naming a record of another organisation SHALL return 404 `not_found` and SHALL NOT reveal that the record exists. Every module SHALL include a cross-organisation test for each route.

#### Scenario: Cross-org read
- **WHEN** an owner of org A requests an employee ID that belongs to org B
- **THEN** the response is 404 `not_found`

#### Scenario: Cross-org reference rejected by database
- **WHEN** code attempts to insert a leave request in org A that references an employee of org B
- **THEN** the database rejects it with a foreign key violation

### Requirement: Audit events
The system SHALL record an audit event for:
- every sign-in success and failure, sign-out, lockout and session revocation;
- password, MFA and recovery-code changes;
- SSO link, unlink and provider configuration changes;
- invitations, role grants, revocations and suspensions;
- NRIC and bank reveals;
- every export;
- every create, update or delete of employees, employment, compensation, bank, work pass, documents and settings;
- every approval decision;
- every payroll state change.

Each event SHALL contain: organisation, actor (member, system or CLI), action, target type and ID, request ID, IP address, user agent, time, and a field-level diff. For sensitive-class fields the diff SHALL record only that the field changed, not its values. Passwords, tokens, secrets and TOTP codes SHALL never be recorded.

#### Scenario: Salary change audit
- **WHEN** a payroll_admin changes an employee's basic pay
- **THEN** an event `compensation.updated` is recorded whose diff lists `basicPayCents` as changed without old or new values

### Requirement: Audit log immutability
Audit events SHALL be append-only. The database SHALL reject UPDATE and DELETE on the audit table. Each event SHALL store a SHA-256 hash over its canonical content and the previous event's hash in the same organisation. A verification command SHALL report the first broken link.

#### Scenario: Tampering detected
- **WHEN** an event row is altered by a database superuser bypassing the trigger and the verification command runs
- **THEN** it reports the ID of the first event whose hash does not match

### Requirement: Audit log access
Owners SHALL read all audit events. hr_admins SHALL read events except security-settings, SSO-configuration and payroll events. payroll_admins SHALL read payroll, compensation and bank events. The audit log SHALL be filterable by actor, action, target and date range, and exportable to CSV by those who can read it. Each export is itself audited.

#### Scenario: hr_admin cannot see SSO changes
- **WHEN** an hr_admin filters the audit log by action `sso.provider_updated`
- **THEN** the result is empty even though such events exist

### Requirement: Membership suspension and former employees
Suspending a membership SHALL revoke its sessions and refuse sign-in. When an employee's termination takes effect, the membership SHALL lose all assigned roles and become `former` (if this would remove the last owner, the termination is refused with 409 `last_owner` until another owner exists). A former member SHALL keep read-only access to their own payslips, tax forms and employee-visible documents until HR removes the membership.

#### Scenario: Leaver reads payslip
- **WHEN** a former employee signs in after their last day
- **THEN** they can download their released payslips and cannot submit leave or claims
