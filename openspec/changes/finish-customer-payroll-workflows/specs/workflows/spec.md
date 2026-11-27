## ADDED Requirements

### Requirement: Concurrent approval decisions and escalations

The escalation sweep SHALL defer a request that is locked by a concurrent decision and check its current state again on a later sweep. Escalation side effects SHALL commit together. A failed escalation SHALL remain eligible for retry.

#### Scenario: Decision holds the request

- **WHEN** an overdue request is locked by a decision transaction
- **THEN** the sweep skips that request, continues to other due requests, and a later sweep only escalates a still-pending step
