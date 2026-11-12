## MODIFIED Requirements
### Requirement: Audit log immutability
Audit events SHALL be append-only. The database SHALL reject UPDATE on the audit table, and SHALL reject DELETE except for the audit events of an expired demo company deleted by the demo-company expiry sweep (its transaction names that organisation, and the organisation's demo expiry is set and in the past). An organisation's demo expiry SHALL be settable only when the organisation is created. Each event SHALL store a SHA-256 hash over its canonical content and the previous event's hash in the same organisation. A verification command SHALL report the first broken link.

#### Scenario: Tampering detected
- **WHEN** an event row is altered by a database superuser bypassing the trigger and the verification command runs
- **THEN** it reports the ID of the first event whose hash does not match

#### Scenario: Real organisation
- **WHEN** any statement, including one inside a transaction that names the organisation for the sweep, deletes an audit event of an organisation without a demo expiry
- **THEN** the database refuses it

#### Scenario: Turning a real organisation into a demo company
- **WHEN** an UPDATE sets a demo expiry on an existing organisation that had none
- **THEN** the database refuses it
