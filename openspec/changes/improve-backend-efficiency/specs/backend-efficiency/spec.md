## ADDED Requirements

### Requirement: Bounded payroll persistence and compatible reads

The system SHALL persist calculated payslips in bounded batches within the existing atomic payroll transaction. Attendance and reports SHALL preserve scoped rows, totals, and report export behaviour.

#### Scenario: Recalculate an existing run

- **WHEN** payroll is computed again for a draft across multiple write batches
- **THEN** every applicable employee has one updated payslip and the run audit records the same totals

#### Scenario: Page leave requests

- **WHEN** a member pages a leave-request report sorted by date or amount
- **THEN** PostgreSQL returns the requested page and matching row count, and callers see only the records within their existing organisation and employee scope

### Requirement: Finite SSO state lifetime

The system SHALL bound the number and lifetime of cached provider configurations and reclaim expired OIDC transactions without consuming valid ones.

#### Scenario: A sweep runs while sign-in is available

- **WHEN** expired and active OIDC transactions coexist
- **THEN** a scheduled pass removes a bounded set of expired rows and active sign-in callbacks still work

### Requirement: Isolated PostgreSQL performance checks

The project SHALL provide a reproducible PostgreSQL benchmark using fictitious data in a private local database. The sustained workload SHALL report latency and machine use while exercising regular reads and heavier operations.

#### Scenario: Benchmark the same fixture before and after a change

- **WHEN** the benchmark runs with the same employee and history counts
- **THEN** it reports SQL statement counts and measured times for the same operations
