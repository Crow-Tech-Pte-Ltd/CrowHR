## Decisions

- Batch payslip inserts with a fixed row limit to stay well below PostgreSQL's parameter ceiling. Keep the run lock, feed reservations, deletion, inserts and audit in one transaction.
- Index attendance facts once by employee, reuse dates and schedule lookups, and calculate totals in one pass. Keep schedules effective-dated and all attendance responses compatible.
- Page date-sorted and amount-sorted leave requests in the database using the same scope filters for the count and selected page, with one snapshot and a stable identifier for ties. Apply the same tie order to exports. Keep the existing natural text sorts and report permissions. Select leave compensation only when its salary column is visible.
- Cache OIDC discovery per application and provider, with expiry, a size limit and one in-flight promise per version. Remove expired transaction rows in indexed, bounded batches with row locking so callbacks and replica sweeps can race safely.
- Reuse synthetic fixtures on a private PostgreSQL cluster and sample latency, CPU and memory during a sustained mix of payroll, exports, reads and encrypted backups.
