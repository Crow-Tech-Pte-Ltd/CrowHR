## Context

Builds on `add-attendance` (punches, computed day records, corrections as punches, overtime claims, the payroll `OvertimeSource` and `DaysWorkedSource` feeds) and `add-approvals-and-notifications` (subject adapters, policies, `submitApproval`, `withdrawSubject`, decisions in one transaction, Home inbox sources). The engine already lists `timesheet` among its subject types; nothing registers it yet. Requirements are in `specs/attendance`.

## Goals / Non-Goals

**Goals:** a sign-off step that reuses the engine and its policies unchanged; a lock that every write path into a period respects; payroll inputs that can be limited to signed-off periods without touching payroll's code; no behaviour change while the setting is off.

**Non-Goals:** stored day records (timesheets stay computed on read); an hours-worked feed for hourly-rated staff; locking leave or rosters.

## Decisions

1. **Periods are computed, ranges are stored.** `attendance/periods.ts` maps a date to its period for the organisation's setting: calendar month, half month (1–15, 16–end) or Monday–Sunday week. Each submission stores its own `period_start`/`period_end`, and locks read the stored ranges, so changing the setting never moves an existing approval. Submitting a period that overlaps an open or approved timesheet of another shape is refused. *Alternative:* store only a period key; rejected because a setting change would silently re-cut approved periods.

2. **One row per submission.** `attendance_timesheets` keeps every submission with status `submitted`, `approved`, `returned`, `withdrawn` or `reopened`; a partial unique index allows one `submitted` or `approved` row per employee and period start. The approval request's subject is that row, so each resubmission gets its own request and chain, and the history stays readable. Same pattern as `overtime_claims`.

3. **A period can be submitted once it is over:** from 04:00 SGT on the day after its last day. 04:00 is attendance's overnight cut-off, so no live punch can still land on the period's last work date. Offline punches replayed later meet the lock (decision 6).

4. **Requester is the employee.** `requesterEmployeeId` is the employee and `requesterMembershipId` their membership (the submitter's when the employee has no sign-in). The engine already excludes whoever files on someone's behalf, so in manager mode the submitting manager's own `manager` step is skipped and the request falls back to HR, as for claims filed on behalf. The adapter's default chain is `manager` (3-day escalation), like overtime.

5. **Pending is open; approved is closed.** A submitted timesheet does not lock: the approver may still correct punches before approving. `submitted_totals` is the snapshot at submission; `onApproved` recomputes the totals in the decision's transaction and stores `approved_totals`, so what is approved is what the approver saw. The summary shows when totals changed since submission.

6. **Lock points.** With the setting on, an `approved` row covering the work date blocks:
   - employee punches: `422 punch_rejected` with `details.reason = "timesheet_locked"`, because native clients that lag the server already drop and show `punch_rejected` (a new code could be retried as unknown);
   - corrections (add and void): `409 timesheet_locked` with `details.canReopen`. Owners and HR admins (`attendance:reopen`) may resend with `reopen: true`; the correction and the reopen then commit together and are both audited. Managers cannot;
   - new overtime claims: `409 timesheet_locked`. Claims already pending are decided as usual.
   Turning the setting off lifts every lock (rows stay as history).

7. **Reopen.** `POST /attendance/timesheets/:id/reopen` (reason, `attendance:reopen`, never one's own) sets the row `reopened` and notifies the employee and the submitter (`timesheet_reopened`, category requests). The approval request stays `approved`: it records a decision that happened. The period is then open and must be submitted again.

8. **Approved-only payroll lives in attendance's feeds.** `payrollApprovedOnly` changes `listApprovedOvertime` (claims dated inside an approved timesheet only) and `listRosterDaysWorked` (employees whose employed dates in the pay period are all inside approved timesheets). Figures come from the locked punches, computed as today. Payroll's code and ports are unchanged: an employee left out simply has no fed item, so payroll behaves as for staff who don't clock in. The overtime feed already reads unpaid claims from earlier periods, so overtime approved late is paid by the next run computed.

9. **Settings.** Four columns on `attendance_settings` with defaults that reproduce today's behaviour. The settings view gains a `timesheets` object; the PUT body accepts it optionally and keeps the stored values when it is absent, so clients that predate it don't switch it off. `payrollApprovedOnly` requires approval to be on.

10. **Home.** A `timesheets` inbox source lists the latest ended period: "Submit your timesheet for …" for an employee who hasn't (employee mode), or "Submit N timesheets for …" for a manager with unsubmitted team members (manager mode). No due date (Non-goals).

## Data model

| Table / column | Notes |
| --- | --- |
| `attendance_settings.timesheet_approval` | boolean, default false |
| `attendance_settings.timesheet_period` | `monthly` (default), `semi_monthly`, `weekly` |
| `attendance_settings.timesheet_submitter` | `employee` (default), `manager` |
| `attendance_settings.payroll_approved_timesheets_only` | boolean, default false |
| `attendance_timesheets` | `id`, `org_id`, `employee_id` (composite FK), `period_start`, `period_end`, `status`, `approval_request_id`, `submitted_by_membership_id`, `submitted_at`, `submitted_totals jsonb`, `approved_totals jsonb?`, `decided_at?`, `decided_by_membership_id?`, `comment?`, `reopened_at?`, `reopened_by_membership_id?`, `reopen_reason?`; unique (`org_id`, `id`); partial unique (`org_id`, `employee_id`, `period_start`) where status in (`submitted`, `approved`); index (`org_id`, `employee_id`, `period_start`); check `period_end >= period_start` |

## Risks / Trade-offs

- [Leave or a holiday approved later changes a locked day's figures] → `approved_totals` keeps what was approved; payroll's days-worked feed is live. Documented in limitations.
- [Two submissions of differently shaped overlapping periods at the same instant] → only possible right after a period change; the overlap check runs in the submitting transaction, and the unique index covers the common case (same start). Documented.
- [Rostered staff with an incomplete month and an unapproved timesheet] → payroll blocks the payslip for days worked, as it does today for staff without attendance; the fix is to approve the timesheet (or enter the figure) and recompute.

## Migration Plan

One additive migration (next free number at merge): the table and four columns with defaults. Existing organisations keep approval off. Rollback: drop the table and the columns.
