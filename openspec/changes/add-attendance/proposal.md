## Why

Clock-in that loses punches when the signal drops is one of the biggest complaints about QuickHR. Singapore SMEs with Part 4 staff also have to pay overtime correctly, keep the 72-hour monthly limit in view, and feed approved OT to payroll. Leave (M1) and approvals exist; payroll exposes an `OvertimeSource` port that attendance fills.

## What Changes

- **Clock in/out** from web and mobile web with a big clear button. Every punch carries a client idempotency key, the device time of the tap and the device time of sending, so the server records device time, server time and the corrected time, and flags clock skew and late sync. Punches tapped offline are queued on the device and replayed in order; a retried punch returns the original result and is never stored twice.
- **Optional controls, set per organisation:** geolocation (stored only when the org enables it, with a PDPA notice shown before the first punch), office locations with a radius, and allowed IP ranges. Each control either flags or blocks a punch.
- **Timesheets:** daily records built from punches and the work schedule (scheduled start from the attendance settings, break, hours), lateness and early-out with grace minutes, rest days, off days, public holidays and approved leave. Managers and HR correct a day by adding or voiding punches with a reason, audit-logged.
- **Overtime:** computed per day as worked minutes beyond the schedule (all minutes on rest days, off days and holidays), rounded down to the org's OT block. Employees claim OT for a day; claims are approved through the workflows engine (subject `overtime`). Eligibility under Employment Act Part 4 comes from `sg-rules` (statutory vs contractual OT is shown); the month's 72-hour limit is warned at claim and approval.
- **Payroll feed:** `OvertimeSource.listApproved(orgId, periodStart, periodEnd)` returns approved OT minutes with a stable source id, matching payroll's port.
- **Reports:** attendance summary per employee for a period, exportable as CSV.
- **Web:** clock-in screen (mobile first), My timesheet, Team timesheet with corrections, OT claims, Settings → Attendance.

## Capabilities

### New Capabilities
- `attendance`: punches, offline replay, location and IP controls, timesheets and corrections, overtime computation and claims, payroll OT feed, attendance reports.

### Modified Capabilities
None. `overtime` is a subject type the workflows change already names; the permission matrix gains `attendance:update` (corrections: owner, hr_admin, manager for the team).

## Non-goals

- Native mobile apps (M4; they reuse this API) and kiosk or biometric devices.
- Matching punches to rostered shifts (scheduling, M3); shift schedules use the attendance settings' default start.
- Rest-day and public-holiday base pay (payroll computes it from day rates); attendance passes OT minutes only.
- Breaks punched separately, job or project time tracking, and photo or selfie verification.
- Automatic absence deductions; absences are shown, payroll decides.

## Impact

- `packages/core`: new `attendance/` module, schema `attendance.ts` (in the WS5 migration); `overtime` workflows adapter; matrix row; `V1_MODULES` line.
- `apps/web`: `_app/attendance/*`, `_app/settings/attendance*`, an offline punch queue in the browser (localStorage, replayed on reconnect).
- Payroll (WS4) wires `attendanceOvertimeSource` into `payrollPorts` at merge.
