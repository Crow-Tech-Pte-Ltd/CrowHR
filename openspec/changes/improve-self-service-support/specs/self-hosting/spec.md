## ADDED Requirements

### Requirement: In-app recovery and escalation
The web app SHALL offer troubleshooting guidance organised by common tasks. Authenticated members SHALL see shortcuts scoped to their role. Owner diagnostics SHALL use the existing owner-only system status.

#### Scenario: A staff member cannot reach a payslip
- **WHEN** a staff member opens payroll help
- **THEN** the app explains payslip release and links to their own payslips if their account has an employee record
- **AND** the app tells them when their company administrator must act

#### Scenario: An owner shares diagnostics
- **WHEN** an owner copies the support summary
- **THEN** the summary contains only allowlisted technical fields
- **AND** the owner can review it before sharing

#### Scenario: A request fails
- **WHEN** a user follows help from an API permission or server error
- **THEN** the app opens the relevant help topic and carries a valid request reference when available
