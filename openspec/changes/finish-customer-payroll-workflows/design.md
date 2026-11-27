## Context

Approved timesheets already gate the overtime and days-worked feeds. Their existing approval totals need enough detail to carry dated hourly work into the payroll snapshot. Leave, attendance and allowance APIs already enforce organisation scope and role permissions.

## Goals

- Keep approved payroll reproducible and manual time entry available.
- Give authorised HR users direct navigation to routine record and payroll setup actions.

## Decisions

- Store per-day payroll facts with each new approval in the existing approval snapshot. Use dates to price hours under the existing effective-dated rate logic. Older approvals without those facts require manual hours or a fresh approval.
- Only use a complete set of approved facts for the employed days in a run. If the regular hours cannot be distinguished from separately paid overtime or special-day work, keep the existing manual entry path for that employee and explain why. A manual hours item takes precedence for the entire employee in that run. Recomputing uses current approved inputs and persists what was used.
- Use the existing allowance setup and lifecycle permissions. End a recurring allowance by ending the effective-dated record, with the original boundary recorded so cancellation can restore it. Preserve basic pay and allowances omitted from a pay change.
- Require a month boundary for web amount changes when two rates would otherwise be in effect during the month. Keep the existing API contract for callers that use the legacy amount-only workflow. Use a one-off payroll item for a difference that applies earlier.
- Reuse existing permission-aware routes and forms for leave and attendance. Keep protected fields on the current scoped APIs.
- Escalation claims the parent approval request first, as decisions do. Process one request per transaction and defer locked or failed requests to a later sweep. A stable cursor bounds retries within each sweep.

## Risks / Trade-offs

- Partial coverage could underpay someone. Use the feed only for full coverage with usable records, and test that ambiguous or missing data falls back to manual entry.
- A backdated allowance change can invalidate payroll already signed off. Refuse changes affecting any finalised period and explain the correction path.
- Approved hours are inputs, while approved overtime and contractual premiums can have their own amounts. Pricing ambiguous hours remains a payroll review decision.

## Migration Plan

New approval facts and lifecycle event fields are additive. Old approvals, pay snapshots and lifecycle events remain readable.
