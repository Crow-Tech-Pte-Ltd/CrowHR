## ADDED Requirements
### Requirement: Young hires and Part 4 flags
The hire form SHALL show the Employment Act conditions for someone under 16 on the start date as soon as both dates are known, from the same rule the server checks. The employee CSV import SHALL accept optional `workman` and `manager_or_executive` columns (yes or no; empty means no).

#### Scenario: Fourteen on the start date
- **WHEN** HR enters a date of birth that makes the new hire 14 on the start date
- **THEN** the form says light duties only, no industrial work unless with family, no night work and limited daily hours

#### Scenario: Importing a manager
- **WHEN** an import row has `manager_or_executive` = `yes`
- **THEN** the employee's job is flagged as a manager or executive; any value other than yes or no is reported on that cell
