## ADDED Requirements

### Requirement: Approved regular hours in hourly payroll

For an organisation using approved-timesheets-only payroll, a monthly or final-pay run SHALL use dated regular worked minutes for an hourly employee when approved timesheets cover the relevant employed dates and the regular hours are unambiguous. The source SHALL be visible. Manual hours entered for the employee SHALL take precedence for the run. Earlier payroll results SHALL remain reproducible.

#### Scenario: Full coverage through a rate change

- **WHEN** a payroll admin computes a run with usable approved hours on both sides of a change in the employee's hourly rate
- **THEN** each date's regular hours are priced at that date's rate

#### Scenario: A payroll admin must review time

- **WHEN** approval coverage is incomplete, prior approvals lack daily records, punches are incomplete, or separate overtime or special-day earnings make regular hours ambiguous
- **THEN** the run asks for manual hours and does not use a partial automatic amount

### Requirement: Allowance type creation in the web app

Authorised payroll staff SHALL be able to create an organisation's recurring allowance types through Payroll and manage their treatment on the existing screen.

#### Scenario: Add a type

- **WHEN** a payroll admin saves a valid unique type from Payroll
- **THEN** it appears in Allowance treatment and on the hire and pay change forms for that organisation
