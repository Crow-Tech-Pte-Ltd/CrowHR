## ADDED Requirements
### Requirement: Approved encashment is paid once
The system SHALL let HR request encashment under an encashable policy and employees request their own only when enabled. Workflow approval SHALL deduct leave and produce an AW earning in the next regular run or final-pay run. Rejection or withdrawal SHALL release reserved leave. Encashment SHALL use the MOM gross rate based on basic salary plus fixed recurring allowances in force on the rate date and classified `grossRateIncluded: true`; excluded variable allowances SHALL NOT contribute. Missing/null classification for an active allowance SHALL block the request. Payslips SHALL show quantity and basic + included allowances → monthly gross → daily gross rate working. Shared payroll feed reservations SHALL prevent duplicate payment and preserve adjustment earnings.

#### Scenario: Approval to payroll
- **WHEN** HR/payroll approves 2.5 days for a five-day-week employee with S$2,600 monthly basic, S$260 included fixed allowance and an excluded variable allowance
- **THEN** monthly gross is S$2,860, daily gross is S$132, leave decreases by 2.5 days and the next eligible payroll contains S$330 AW and CPF contributions

#### Scenario: Effective-dated and immutable rate
- **WHEN** salary or allowance records have expired or start after the rate date, or change after the request
- **THEN** only records in force on the rate date contribute and the snapshotted amount and working remain unchanged through recompute and adjustment

#### Scenario: Unclassified allowance
- **WHEN** an active recurring allowance has missing or null gross-rate classification
- **THEN** the request fails with a message naming the allowance to classify and no leave is reserved

#### Scenario: Rejected request
- **WHEN** a pending request is rejected or withdrawn
- **THEN** its reserved balance is available again

#### Scenario: Adjustment and final pay
- **WHEN** payroll is adjusted or a leaver is paid off-cycle
- **THEN** the earning carries once and unused-leave encashment remains CPF wages, subject to the AW ceiling
