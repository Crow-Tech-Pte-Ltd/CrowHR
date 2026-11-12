## ADDED Requirements
### Requirement: Every blocking issue leads to its fix
Each payroll issue SHALL say what to do in terms of the web app, and SHALL carry a reference to what it is about when known (`ref.itemId`, `ref.holidayDate`, `ref.allowanceCodes`). The run overview and the employee drawer SHALL offer, for every blocking issue, a link to the place that fixes it: Payroll → Allowance treatment, the employee's drawer with the item form prefilled, the company profile, or the employee's record. A run SHALL warn while an allowance paid in it has no gross-rate classification.

#### Scenario: Unclassified allowance before any holiday
- **WHEN** a new organisation's first run pays an allowance that has no gross-rate classification
- **THEN** the run lists the warning `ALLOWANCE_GROSS_RATE_UNSET` naming the allowance, linked to Allowance treatment, and nothing blocks

#### Scenario: Off-day holiday for an hourly employee
- **WHEN** a public holiday falls on an hourly employee's off day under the "pay an extra day" rule
- **THEN** the run blocks with `PH_GROSS_RATE_REQUIRED` referencing the holiday, and the fix opens the employee's drawer with holiday pay for that date ready to fill in; once entered and recomputed, the issue is gone

#### Scenario: Fed overtime without a statutory rate
- **WHEN** approved overtime from attendance reaches a run for an employee outside Part 4
- **THEN** `OT_NOT_STATUTORY` references `attendance:<claim ID>`, and an amount entered for that claim replaces the fed amount and clears the issue

### Requirement: Return an approved run to draft in the web app
An owner or payroll admin SHALL be able to return an approved, unpaid run to draft from the run page after giving a reason, which is shown on the draft and kept in the audit log.

#### Scenario: New bank account after approval
- **WHEN** a payroll admin returns an approved run with the reason "Chloe's new bank account"
- **THEN** the run is a draft showing that reason and can be recomputed and submitted again
