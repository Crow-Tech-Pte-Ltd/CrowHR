## ADDED Requirements
### Requirement: Approved encashment is paid once
The system SHALL let HR request encashment under an encashable policy and employees request their own only when enabled. Workflow approval SHALL deduct leave and produce an AW earning in the next regular run or final-pay run. Rejection or withdrawal SHALL release reserved leave. Payslips SHALL show quantity and the basic-salary rate working. Shared payroll feed reservations SHALL prevent duplicate payment and preserve adjustment earnings.

#### Scenario: Approval to payroll
- **WHEN** HR/payroll approves 2.5 days with daily basic rate S$120
- **THEN** leave decreases by 2.5 days and the next eligible payroll contains S$300 AW and CPF contributions

#### Scenario: Rejected request
- **WHEN** a pending request is rejected or withdrawn
- **THEN** its reserved balance is available again

#### Scenario: Adjustment and final pay
- **WHEN** payroll is adjusted or a leaver is paid off-cycle
- **THEN** the earning carries once and unused-leave encashment remains CPF wages, subject to the AW ceiling
