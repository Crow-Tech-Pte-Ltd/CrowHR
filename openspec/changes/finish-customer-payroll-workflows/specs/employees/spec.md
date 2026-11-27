## ADDED Requirements

### Requirement: Effective-dated recurring allowances in the web app

An authorised pay editor SHALL be able to assign recurring allowances at hire and add, change or end them through a pay change. The system SHALL retain history, preserve unrelated pay and allowances, and protect finalised payroll.

#### Scenario: End one allowance without changing basic pay

- **WHEN** a pay editor ends a transport allowance from a future effective date
- **THEN** the old rate remains in force before the effective date, the transport allowance ends on that date, and basic pay and other allowances stay in force

#### Scenario: Cancel the scheduled end

- **WHEN** an authorised pay editor cancels the scheduled event
- **THEN** the previous end date is restored

#### Scenario: A rate change would put two amounts in the same month

- **WHEN** a pay editor changes an allowance in the web app on a date that would produce a second amount in that month
- **THEN** the web app asks for a month boundary and explains how to enter any earlier difference
