## Why

A 200-employee PostgreSQL trial measured 266 statements per payroll calculation and higher tail latency on concurrent attendance and reporting requests. Expired SSO transactions and obsolete discovery configurations can also accumulate on long-running servers.

## What changes

- Write payslips in bounded batches inside the existing payroll transaction.
- Reduce attendance and leave report work and paginate supported leave-request sorts in PostgreSQL.
- Bound the SSO discovery cache and reclaim expired transaction rows in the existing job sweep.
- Make the existing synthetic benchmark repeatable on isolated PostgreSQL, with an optional sustained workload and resource sampling.

## Capabilities

### New capabilities

- `backend-efficiency` for bounded payroll, reporting, and authentication work and the synthetic performance baseline.

## Impact

Core payroll persistence, employee calendars, attendance, reports, OIDC and the scheduler, one additive database index, and development benchmark tooling.

## Non-goals

Language or framework migration, changes to payroll rules, public API changes, production benchmarking, and changes to the data retained for valid sessions, payroll, or audits.
