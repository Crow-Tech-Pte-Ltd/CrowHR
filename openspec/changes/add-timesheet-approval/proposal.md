## Why

Attendance records punches and computes timesheets on read, and managers and HR correct them directly. Nothing says "this period is final": a correction can change last month's hours after payroll has paid them, and payroll reads whatever the punches say on the day it computes. The approvals engine already names a `timesheet` subject type that no module submits (Settings → Approvals shows it as "Not in use yet"). Organisations that pay from attendance want a sign-off step and a period that stays closed once signed off.

## What Changes

- **Optional per organisation, off by default.** Settings → Attendance gains *Timesheet approval*: on/off, the period (calendar month, half month or Monday–Sunday week), who submits (the employee, or their manager), and whether payroll uses approved timesheets only. With it off, nothing changes for existing installs.
- **Submit a period.** Once a period is over, the employee (or, in manager mode, the manager or HR) submits it. The submission snapshots the period's totals and goes through the workflows engine as subject `timesheet` with the organisation's policy; the default chain is the employee's manager. Submitting warns, without blocking, about missing punches and overtime not yet claimed.
- **Approve or return.** The approver sees the period's totals and approves, or returns it with a comment (the engine's rejection). The employee or the submitter can withdraw a pending timesheet. A returned or withdrawn timesheet can be submitted again.
- **Approved locks the period.** For the employee's dates in an approved timesheet: punches are refused, manager corrections are refused, and new overtime claims are refused. Owners and HR admins can still correct, which reopens the timesheet (explicit confirmation, reason, audited, employee notified); they can also reopen without a correction. A reopened period must be submitted and approved again.
- **Payroll uses approved timesheets only (optional).** When set, attendance's payroll feeds pass approved overtime only for dates inside an approved timesheet, and days worked (rostered staff) only for employees whose whole pay period is covered by approved timesheets. Anything else waits for approval and is picked up by the next run that is computed.
- **Work to do.** Home lists "Submit your timesheet" for the latest ended period (employee mode) or "Submit N timesheets" for a manager's team (manager mode).
- **Web.** Settings → Attendance card; My timesheet by period with status, Submit and Withdraw; a Timesheets tab for managers and HR with each person's status, Approve/Return, Submit and Reopen; lock notices and reopen confirmation in corrections.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `attendance`: timesheet periods, submission, approval, lock, reopen, and the approved-only payroll feeds. The permission matrix gains `attendance:reopen` (owner, hr_admin: all). Workflows gains the `timesheet` subject adapter (already named by `add-approvals-and-notifications`) and a `timesheet_reopened` notification kind.

## Non-goals

- Paying hourly-rated staff from approved hours: payroll has no hours-worked feed from attendance (hours are entered per run). That needs a payroll port and is a separate change.
- Partial approval of some days, or editing hours on the approval itself; corrections stay punches.
- Locking other modules' data for the period (leave approved later still shows on the day).
- Due dates, reminders or escalation for timesheets not submitted; Home shows them without a due date.
- Per-team or per-employee settings; the setting is per organisation.

## Impact

- `packages/core`: migration for `attendance_timesheets` and four `attendance_settings` columns; `attendance/periods.ts`, `attendance/timesheet-approval.ts`, the `timesheet` adapter and inbox source in `attendance/approval.ts`; lock checks in punches, corrections and overtime claims; approved-only filters in `attendance/outputs.ts`; routes under `/api/v1/attendance/timesheets` (additive); error code `timesheet_locked`; matrix row.
- `apps/web`: Settings → Attendance, My timesheet, Timesheets tab, correction sheet, Settings → Approvals (no amount threshold for timesheets).
- Docs: attendance and approvals pages; `docs/limitations.md`.
