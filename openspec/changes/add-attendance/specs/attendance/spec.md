## Purpose

Defines how employees clock in and out (including offline), how daily timesheets, lateness and overtime are worked out and corrected, how overtime is approved and passed to payroll, and what attendance reports show.

## ADDED Requirements

### Requirement: Punches with device and server time
A punch SHALL carry kind (`in` or `out`), a client idempotency key, the device time of the tap, the device time it was sent, whether it was queued, and the source (`web`, `mobile_web`, `correction`). The server SHALL store the device time, the server receive time and the recorded time (device tap time corrected by the device clock offset measured at sending). It SHALL flag `clock_skew` when the offset exceeds the organisation's threshold (default 2 minutes) and `late_sync` when the punch arrives more than 10 minutes after it was tapped. A punch with an idempotency key already stored for the employee SHALL return the original punch and status without creating another. A punch recorded more than 7 days in the past or in the future SHALL be rejected with the reason.

#### Scenario: Offline punch replayed
- **WHEN** an employee taps Clock in at 08:58 with no signal and the queued punch is sent at 09:20
- **THEN** the punch is recorded at 08:58 with server time 09:20 and flag `late_sync`

#### Scenario: Retried punch
- **WHEN** the same punch is sent twice with the same idempotency key
- **THEN** the second response returns the first punch and only one punch exists

#### Scenario: Wrong device clock
- **WHEN** a device clock is 15 minutes fast and the punch is sent immediately
- **THEN** the recorded time is the server time, both times are stored, and the punch is flagged `clock_skew`

### Requirement: Location and network controls
Organisations SHALL choose whether to collect location. Location SHALL be stored only when collection is enabled, and the clock-in screen SHALL show the organisation's PDPA notice before the first punch. When office locations with a radius are configured, a punch outside every radius, or without a location when one is required, SHALL be flagged or rejected per the setting. Allowed IP ranges (CIDR) SHALL work the same way.

#### Scenario: Location off
- **WHEN** location collection is disabled and a client sends coordinates
- **THEN** the punch is stored without coordinates

#### Scenario: Outside the office in block mode
- **WHEN** an office radius is 200 m in block mode and a punch is 1 km away
- **THEN** the punch is rejected with 422 `outside_location`, naming the nearest office

### Requirement: Daily timesheets
For each employee and date the timesheet SHALL show the day type (working, half, off, rest, public holiday, leave), scheduled minutes, first in, last out, worked minutes (paired punches minus the break when the day is long enough), late minutes beyond the grace period, early-out minutes, missing punches, flags and OT minutes. Owners and hr_admins (all) and managers (their team) SHALL correct a day by adding a punch or voiding one with a reason; each correction is audit-logged and the original punch is kept.

#### Scenario: Late arrival
- **WHEN** the scheduled start is 09:00 with 5 minutes' grace and the employee clocks in at 09:12
- **THEN** the day shows 12 minutes late

#### Scenario: Manager correction
- **WHEN** a manager adds a missing clock-out at 18:00 for a report with reason "Forgot to clock out"
- **THEN** the day's worked minutes update and the audit log records the correction and who made it

### Requirement: Overtime and claims
OT minutes SHALL be worked minutes beyond the day's scheduled minutes on working and half days, and all worked minutes on rest days, off days and public holidays, rounded down to the organisation's OT block (default 15 minutes) and ignored below the minimum (default 30 minutes). An employee SHALL claim OT for a date up to the computed minutes, with a reason; claims are approved through the workflows engine as subject `overtime`. Each claim SHALL record whether the employee is covered by Part 4 on that date (statutory OT) or not (contractual OT). Claims and approvals SHALL show the month's OT hours and warn when approved plus pending OT exceeds 72 hours; the warning never blocks.

#### Scenario: 72-hour warning
- **WHEN** an employee with 70 approved OT hours in November claims 3 more hours
- **THEN** the claim is created with a warning that November would reach 73 hours, over the 72-hour limit

#### Scenario: Claim more than worked
- **WHEN** an employee claims 120 minutes for a day with 60 computed OT minutes
- **THEN** the claim fails with 422, saying at most 60 minutes can be claimed for that day

### Requirement: Payroll overtime feed
The module SHALL list approved OT for an organisation and period as `{ sourceId, employeeId, minutes, periodStart, periodEnd }`, one entry per approved claim whose date is in the period, with a stable `sourceId`.

#### Scenario: Approved OT reaches payroll
- **WHEN** a 90-minute OT claim for 12 Nov 2026 is approved
- **THEN** the November feed lists 90 minutes for that employee with period 12–12 Nov 2026

### Requirement: Attendance summary export
Owners, hr_admins and managers (their team) SHALL get an attendance summary for a period per employee (days worked, late count and minutes, early-out count, missing punches, worked hours, approved OT hours, leave days), as JSON and as CSV.

#### Scenario: CSV export
- **WHEN** an hr_admin exports November
- **THEN** a CSV with one row per employee and a header row downloads, and a manager's export contains only their team
