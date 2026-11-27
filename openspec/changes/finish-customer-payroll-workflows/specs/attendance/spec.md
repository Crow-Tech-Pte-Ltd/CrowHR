## ADDED Requirements

### Requirement: Web access to attendance controls

Authorised staff SHALL be able to manage schedule-specific lateness start times and file overtime for employees they are permitted to act for. An employee SHALL be able to submit a new overtime claim for a date after rejection or withdrawal under the existing validation rules.

#### Scenario: Refile a withdrawn claim

- **WHEN** an employee opens a day whose overtime claim they withdrew and its period remains open
- **THEN** the employee can submit a replacement subject to the normal validation and approval flow

#### Scenario: Set a schedule's start time

- **WHEN** an authorised administrator sets a schedule-specific start time
- **THEN** attendance applies it to staff on that schedule

### Requirement: Approved time facts for hourly payroll

An approved timesheet SHALL preserve the date and worked minutes needed for hourly payroll, with the information needed to identify incomplete or exceptional days. Reopening SHALL remove the approval from the payroll feed until it is approved again.

#### Scenario: Reopened time is unavailable for payroll

- **WHEN** HR reopens an approved timesheet before a payroll run is computed again
- **THEN** that timesheet no longer supplies approved hours to the run
