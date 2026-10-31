## Context

Builds on people (employment records with `employment_type` and `work_schedule_id`; effective-dated work schedule versions with seven typed days and minutes; tenures with hire and last working day), workflows (`submitApproval`, `SubjectAdapter`, `tick` transitions) and `sg-rules` (annual/sick entitlement, public holidays and `publicHolidayTreatment`, Part 4 coverage, and the new `src/leave/` parental rules). See proposal.md for scope.

## Goals / Non-Goals

**Goals:** statutory correctness without configuration; one working-day calculator shared by quote, apply, calendar, payroll and reports; balances that cannot be raced; outputs shaped for payroll's run items.

**Non-Goals:** money (payroll prices leave days); anniversary leave years.

## Decisions

1. **Types are rows, statutory behaviour is code.** `leave_types` holds one row per type per org (`code`, `statutory_code`, `paid`, `day_counting`, `half_days`, `attachment`, `sensitive`, `policy jsonb`). Rows are created lazily and idempotently (`insert … on conflict do nothing` on `(org_id, code)`) on the first leave request of an org, so existing orgs need no backfill. The statutory floor is enforced in code from `sg-rules`, so a policy edit cannot undercut it. *Alternative:* seeding in the setup wizard; rejected because orgs created before this change would have none.

2. **Entitlement is computed; everything else is a ledger.** Entitlement for (employee, type, year, as-at) is derived on read from service, schedule and policy (`entitlement.ts`, explained step by step). `leave_ledger` stores signed movements in hundredths of the unit (`carry_forward`, `expiry`, `forfeit`, `encashment`, `adjustment`, `taken`, `restored`), so balances are `entitlement + Σ ledger − pending`. *Alternative:* granting entitlement rows yearly; rejected because service-based changes mid-year (3-month eligibility, monthly accrual, sick-leave steps) would need re-grants.

3. **Days are materialised per request.** `leave_request_days` (date, session, units, leave year) is written at application. It drives overlap checks (session-aware), splitting across leave years, the calendar, `LeaveCalendar`, the unpaid-leave source and the government-paid report. Changing a schedule later does not silently re-count approved leave.

4. **Working-day calculator.** `calendar.ts` resolves, per date, the schedule version in force (via the employment record), the day type and minutes, and the employee's holiday set: gazetted holidays from `sg-rules` plus `org_holidays`, each passed through `publicHolidayTreatment` with the schedule's rest weekday and pattern; off-day holidays follow `leave_settings.off_day_holiday` (`extra_pay` default, or `next_working_day`). Shift schedules have no days: every non-holiday date counts, with a warning.

5. **Race safety.** Apply, approve and cancel take `pg_advisory_xact_lock(hashtext(org:employee:type))` before reading the balance, then insert. Approval re-checks without counting the request itself as pending.

6. **Approvals.** `leave` (attributes `typeCode`, `days`) and `leave_cancellation` (subject = the leave request) adapters. `onApproved` writes `taken` (or `restored`) ledger rows and the status in the engine's transaction. The workflows registry lets `deps.workflowPlugins` replace a core subject type, so the engine's fake subjects keep working in workflows tests.

7. **Parental leave is per child.** `leave_children` (birth or expected date, citizenship, order, stillborn, adoption intent date) belongs to the employee. Entitlement and usage for maternity, paternity, shared parental and adoption are scoped to the child; childcare and infant care are per year from all children. Funding segments from `sg-rules` map each counted day (by order within the child's entitlement) to employer, government or unpaid for the government-paid report.

8. **Part-time hours.** Employment type `part_time` switches annual, sick and hospitalisation (and custom working-day types) to hours: entitlement via `partTimeLeaveHours` against the comparable full-timer (the org's default fixed schedule, or the one chosen in leave settings); each leave day counts that day's scheduled minutes.

9. **Year end as a workflows transition.** `leave_year_end` runs on every tick and is idempotent through unique ledger keys (`(employee, type, year, kind)` for carry-forward and forfeit, and the carry row id for expiry).

10. **Outputs.** `UnpaidLeaveSource.listUnpaid(orgId, periodStart, periodEnd) → { sourceId, employeeId, date, days }[]` (maps one-to-one onto payroll's `unpaid_leave` run item with `days` and `date`); `GET /leave/payroll-input` exposes the same to `payroll:read`. `LeaveCalendar.entries(orgId, employeeIds, from, to)` for scheduling.

## Risks / Trade-offs

- [Completed-month and pro-ration rules for calendar leave years are an interpretation] → explained per balance; policies can be more generous; documented in `docs/limitations.md`.
- [No-pay leave reducing service is ambiguous in MOM's guidance] → setting `unpaid_service_rule` (`none`, `whole_month`, `any_day`), default `whole_month`.
- [Shift schedules over-count until rosters exist] → warning on the quote and approval summary.
- [SPL split between parents is declared, not verified] → the employee declares their share on the child record.

## Migration Plan

One drizzle migration adding the leave tables. No backfill (types are created lazily). Rollback = drop the tables.
