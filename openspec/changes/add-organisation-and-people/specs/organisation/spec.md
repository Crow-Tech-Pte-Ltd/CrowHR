## Purpose

Defines the organisation as a single Singapore legal entity and the structure that other modules hang off: company profile, departments, teams, locations, cost centres and work schedules.

## ADDED Requirements

### Requirement: One legal entity per organisation
Each organisation SHALL represent exactly one legal entity with one UEN and one CSN. Payroll runs, CPF submissions, IR8A data and the bank payout account SHALL be scoped to the organisation. Groups of companies SHALL be supported as separate organisations that one user can belong to and switch between, using the active-organisation switch from `auth`.

#### Scenario: Second entity
- **WHEN** an owner of "Acme Pte. Ltd." needs payroll for "Acme Services Pte. Ltd."
- **THEN** they create a second organisation from the organisation switcher, become its owner, and the two organisations share no employees or data

### Requirement: Company profile
Owners and hr_admins SHALL maintain: legal name (required), trading name, UEN (required), CSN, registered address (block or house number, street, unit, building, 6-digit postal code), and a logo (PNG or SVG, at most 1 MB). The UEN SHALL match one of the three ACRA structural formats: 8 digits and a letter; 4-digit year, 5 digits and a letter; or `T`/`S`, 2 digits, a 2-character entity type, 4 digits and a letter. The CSN SHALL be the organisation's UEN followed by a 3-letter payment type and a 2-digit serial; the accepted payment types come from `packages/sg-rules` (TODO: cite from `research/sg-regulatory.md`). The time zone SHALL be fixed to Asia/Singapore and the currency to SGD. Payroll finalisation SHALL be blocked until the UEN, CSN and address are complete.

#### Scenario: Invalid UEN
- **WHEN** an owner saves UEN `12345`
- **THEN** the save fails with 400 `validation_failed` and the message lists the three accepted UEN formats with an example of each

#### Scenario: CSN must match UEN
- **WHEN** the UEN is `201912345K` and a CSN `201812345KPTE01` is saved
- **THEN** the save fails with a message that the CSN must begin with the organisation's UEN

### Requirement: Departments, teams, locations and cost centres
The organisation SHALL have flat lists of departments, teams (each optionally belonging to one department), locations (name, address, postal code) and cost centres (unique code, name). Names SHALL be unique within their list among active entries. An entry referenced by any current employment record SHALL NOT be archived. The attempt SHALL fail with 409 `in_use`, give the number of employees affected, and link to a filtered employee list. Archived entries SHALL remain visible in historical records and SHALL NOT be selectable for new records.

#### Scenario: Archive department in use
- **WHEN** an hr_admin archives a department that 4 current employees belong to
- **THEN** the response is 409 `in_use` with `count: 4`

### Requirement: Work schedules
The organisation SHALL define named work schedules. A schedule is either `fixed` or `shift`. A `fixed` schedule defines each of the seven weekdays as `working` (with contracted hours in minutes), `half` (working, with fewer contracted hours), `off` (a non-working day) or `rest` (the rest day). It SHALL have exactly one `rest` day (TODO: cite the Employment Act rest-day basis from `research/sg-regulatory.md`). Its weekly contracted hours are the sum of its days. A `shift` schedule SHALL take working days from published rosters and SHALL record only contracted weekly hours. Exactly one schedule SHALL be the organisation default. Editing a schedule used by employees SHALL create a new effective-dated version from a chosen date rather than changing history.

#### Scenario: Five-day week
- **WHEN** an hr_admin creates "Office 5-day" with Mon–Fri `working` 480 minutes, Saturday `off` and Sunday `rest`
- **THEN** the schedule is saved with weekly contracted hours of 40 h 00 min

#### Scenario: No rest day
- **WHEN** a fixed schedule is saved with no `rest` day
- **THEN** the save fails with a message saying to mark exactly one day as the rest day

#### Scenario: Schedule change is effective-dated
- **WHEN** "Office 5-day" is changed to make Saturday `half` from 1 Dec 2026
- **THEN** leave or OT calculations for dates before 1 Dec 2026 still see Saturday as `off`

### Requirement: Organisation setup checklist
Until the profile, at least one department, the default work schedule and at least one employee exist, owners and hr_admins SHALL see a setup checklist on Home. Each step links to the screen that completes it, and each step's state comes from the data, not from a manual tick.

#### Scenario: Setup progress
- **WHEN** an owner has saved the company profile but no work schedule
- **THEN** Home shows "Company profile" done and "Work schedule" outstanding
