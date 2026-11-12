## 1. Schema and settings (packages/core)

- [x] 1.1 packages/core: write `attendance/schema.test.ts` cases (`attendance_timesheets` has org_id, cross-org employee FK rejected, one open or approved timesheet per period start) then add the table and the four `attendance_settings` columns in a migration
- [x] 1.2 packages/core: write `attendance/periods.test.ts` (month, half month, Monday–Sunday week, previous/next, submittable from 04:00 SGT the day after) then implement `attendance/periods.ts`
- [x] 1.3 packages/core: write `attendance/timesheet-approval.http.test.ts` settings cases (off by default, saved and audited, payroll limit needs approval on, omitted `timesheets` keeps stored values) then extend settings

## 2. Submission and decisions

- [x] 2.1 packages/core: write `attendance/timesheet-approval.http.test.ts` (off → 409; too early → 400; submit snapshots totals and warns; manager approves; return needs a comment and allows resubmission; withdraw; duplicate and overlap → 409; employee in manager mode → 403/404, manager submits and HR decides; cross-employee 404) then implement `attendance/timesheet-approval.ts`, the `timesheet` adapter and routes
- [x] 2.2 packages/core: matrix row `attendance:reopen` (owner, hr_admin: all) proven by `access/matrix.http.test.ts`; org-B timesheet row in `testing/attendance.ts` so `access/cross-org.test.ts` sweeps the new routes

## 3. Lock and reopen

- [x] 3.1 packages/core: write `attendance/timesheet-lock.http.test.ts` (punch into an approved period → 422 `punch_rejected` reason `timesheet_locked`; replay still 200; manager correction and void → 409; HR without confirmation → 409 `canReopen`; HR with `reopen: true` corrects and reopens, audited, employee notified; OT claim → 409; pending period not locked; day records `locked`; setting off lifts the lock; reopen endpoint: HR only, not own, approved only) then implement the lock checks and reopen

## 4. Payroll and Home

- [x] 4.1 packages/core: write `attendance/timesheet-payroll.test.ts` (limited: OT only inside approved timesheets, released after approval; days worked only for fully covered rostered employees; not limited: unchanged) then implement the filters in `attendance/outputs.ts`
- [x] 4.2 packages/core: write the Home cases in `attendance/timesheet-approval.http.test.ts` (employee mode item until submitted; manager mode count; nothing while off) then implement the `timesheets` inbox source

## 5. Web and docs

- [x] 5.1 apps/web: Settings → Attendance "Timesheet approval" card; My timesheet by period with status, Submit and Withdraw; Timesheets tab with status, Approve/Return, Submit and Reopen; lock notice and reopen confirmation in the correction sheet; Settings → Approvals without an amount threshold for timesheets
- [x] 5.2 e2e: write `e2e/timesheet-approval.spec.ts` (employee submits last week → the manager sees the task in the Inbox and approves it from the Timesheets tab → My timesheet shows Approved and every day Locked → a correction answers 409 `timesheet_locked` and HR sees the reopen confirmation)
- [x] 5.3 docs: attendance and approvals pages in `apps/docs`; remove "Timesheet approval is not in use" from `docs/limitations.md` and add the new limitations; OpenAPI snapshot regenerated (`bun run openapi:check` passes against v1.0)
