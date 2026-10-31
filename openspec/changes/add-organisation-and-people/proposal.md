## Why

Payroll, leave, claims, approvals and reports read the employee record: residency status and PR start date for CPF, DOB for age bands, race and religion for SHG, work pass for FWL, reporting lines for approvals, and work schedules for leave and OT. That record must be correct and effective-dated before those modules can be built. Most SMEs arrive from spreadsheets mid-year, so validated bulk import with YTD opening balances is part of v1.

## What Changes

- **Company profile:** legal name, UEN (format-validated), CPF Submission Number (CSN), registered address, logo.
- **One legal entity per organisation in v1.** CPF submissions, IR8A, the bank payout account and payroll runs are all per legal entity, so making the organisation the entity keeps each of those boundaries equal to the existing org-isolation boundary. Groups with several UENs use one organisation per entity, and one user can switch between them. Multi-entity organisations with consolidated reporting are a later change.
- **Structure:** departments, teams, locations and cost centres, each archivable rather than deleted.
- **Work schedules** define each weekday as working, half-day, off day or rest day, with contracted hours. A `shift` schedule type takes its days from rosters. Leave and OT use these later.
- **Employee profile:**
  - Personal and identity fields: legal and preferred name, NRIC/FIN (encrypted, masked), ID type, DOB, nationality, residency status with PR start date, race and religion for SHG, SHG opt-out.
  - Contact details, up to 3 emergency contacts, bank details (encrypted).
  - Work passes with expiry.
- **Effective-dated employment records:** job title, department, team, location, cost centre, manager, employment type, work schedule, probation end, EA coverage and workman flags.
- **Effective-dated compensation:** basic pay (monthly or hourly) and recurring allowances.
- **Lifecycle events:** hire, transfer, promotion, salary change, probation confirmation, resignation with notice and computed last day, termination, rehire. Future-dated events are allowed.
- **Bulk CSV import** (employees, compensation, YTD opening balances): a validation preview listing every error by row and column, then all-or-nothing commit.
- **Employee list export** to CSV/XLSX, respecting field permissions.
- **Onboarding and offboarding checklists** from templates, created automatically on hire and on resignation or termination.
- **Employee self-service edits:** contact details and emergency contacts edit directly; sensitive fields (legal name, NRIC/FIN, DOB, residency, race, religion, bank) go through a change request approved by HR (bank by payroll).
- Implements `ReportingScopeResolver` for `access-control`.

## Capabilities

### New Capabilities
- `organisation`: company profile, legal-entity decision, departments, teams, locations, cost centres, work schedules.
- `employees`: employee profile, work passes, bank details, employment records, compensation history, lifecycle events, import/export, checklists, self-service change requests.

### Modified Capabilities
None.

## Non-goals

- Several legal entities in one organisation, inter-entity transfers, and consolidated group reporting.
- Allowance CPF and tax treatment, and pay item types. The payroll change owns these; this change stores allowance type references only.
- Leave entitlements and leave opening balances (leave change).
- Statutory thresholds such as Part IV salary limits and EA notice periods by length of service. These come from `packages/sg-rules` once `research/sg-regulatory.md` lands, and are derived, not stored.
- MOM OED occupation coding, dependants, qualifications, assets, MyInfo pre-fill, and an org chart beyond a reporting tree list.
- Updating existing employees through CSV import (create-only in v1).

## Impact

- `packages/core`: new `organisation/` and `employees/` modules, schema files `organisation.ts` and `employees.ts`, extension of `organisations`, and a `memberships.employee_id` FK.
- `apps/web`: People (list, profile tabs, import wizard, checklists) and Settings → Company / Structure / Work schedules.
- Consumers: access-control (scope resolver), workflows (manager lookup, change requests), payroll (compensation, residency, DOB, race, religion, bank, YTD), leave (schedules, tenure), documents and reporting.
