## Purpose

Defines SME-sized shift rostering: shift templates, weekly rosters per location or department, conflict detection against leave, holidays, rest days and hour limits, publishing, shift swaps and open-shift pickup with approval, and the published roster as the schedule for attendance, leave and payroll.

## ADDED Requirements

### Requirement: Shift templates
Owners and hr_admins SHALL maintain shift templates in Settings → Shift templates. Each template has:
- a name;
- a unique short code (1 to 6 characters);
- a start time and an end time. An end time at or before the start time means the shift ends the next day;
- an unpaid break in minutes, from 0 to 240 and less than the shift length;
- an optional location;
- a colour token from a fixed restrained set (`plain`, `kuning`, `biru`, `oren`, `ink`).

Paid duration SHALL be computed as end minus start minus break, and shown in hours and minutes. Templates in use SHALL be archived, not deleted. An organisation SHALL have at most 30 active templates per location (and 30 without a location).

#### Scenario: Overnight shift
- **WHEN** a template "Night" runs 22:00–06:00 with a 30-minute break
- **THEN** its paid duration is 7 h 30 min and shifts using it end at 06:00 the next day

### Requirement: Rosters and assignments
A roster SHALL exist per scope (a location, a department, or both) per ISO week (Monday start), with status `draft` or `published` and a version number.

Shifts SHALL belong to employees eligible for the scope in that week, or be left open (no employee) for pickup. Each shift has:
- a date;
- start and end timestamps in Asia/Singapore;
- break minutes;
- an optional template;
- an optional note of up to 200 characters.

A cell MAY instead mark the employee's rest day.

Managers SHALL edit rosters only where at least one team member is eligible, and SHALL assign only their team. "Copy last week" SHALL copy the shifts of employees still eligible and report those skipped, with reasons. A roster SHALL hold at most 150 employees. An edit SHALL fail with 409 `stale` when the shift changed since the editor loaded it.

#### Scenario: Copy last week
- **WHEN** a manager copies last week into a new draft and one employee has since resigned
- **THEN** all other shifts are copied and the summary says "1 shift not copied: <name> left on 30 Nov 2026"

### Requirement: Conflict detection
For every shift the system SHALL detect:
- `overlap`: another shift of the same employee overlapping in time. This SHALL block the save with 409 `shift_overlap`.
- `on_leave`: approved leave covering any part of the shift. Full-day leave conflicts with every shift that day. Half-day leave conflicts by session: the AM/PM boundary comes from the employee's work schedule, or is the midpoint of the shift for shift schedules.
- `outside_employment`: before the hire date or after the last working day.
- `pending_leave`: pending leave that overlaps the shift. This is a hint only.
- `public_holiday`: the shift falls on a public holiday that applies to the employee. The warning states the pay implication: an extra day's basic pay, plus OT beyond normal hours, for Part 4 staff.
- `rest_day`: the shift falls on the employee's rest day. The warning states the pay implication: one or two days' basic pay at the employer's request, depending on hours, plus OT.
- `daily_hours`: more than 12 hours in a day.
- `overtime`: hours beyond normal daily hours (8 when rostered more than 5 days that week, else 9). This is a hint only.
- `weekly_hours`: more than 44 normal hours in the week (the excess is overtime).
- `no_rest_day`: shifts on all seven days of the week.
- `ot_cap`: projected overtime in the calendar month above 72 hours.

All limits SHALL come from cited `packages/sg-rules` values. Conflicts SHALL show in the grid cell with a text label and icon, not colour alone. Leave approved after publishing SHALL flag the affected shifts and notify the roster's editors.

#### Scenario: Shift over approved leave
- **WHEN** a manager assigns a shift on a day the employee has approved annual leave
- **THEN** the shift saves with an `on_leave` conflict and the cell shows "On leave"

#### Scenario: Overlap blocked
- **WHEN** an employee already has 09:00–17:00 on Tuesday and a 16:00–22:00 shift is added for them that day
- **THEN** the save fails with 409 `shift_overlap`, naming the existing shift

#### Scenario: Six long days
- **WHEN** an employee is rostered 10 hours a day Monday to Saturday
- **THEN** each day warns "2 h beyond normal daily hours", the week warns "60 h rostered: 16 h beyond the 44-hour week", and Sunday is not flagged

### Requirement: Publishing
Publishing a roster SHALL require explicit acknowledgement of each unresolved `on_leave` and `outside_employment` conflict. The acknowledgements are recorded in the audit log.

Publishing SHALL:
- snapshot the working copy as the published roster;
- set the status to `published`;
- increment the version;
- notify, on the first publish, each employee with at least one shift that week. On later publishes it SHALL notify only the employees whose shifts were added, removed or changed, with the old and new times.

Edits after publishing SHALL stay invisible to employees and to attendance, leave and payroll until the roster is published again. Employees SHALL never see draft rosters.

#### Scenario: Publish with conflict
- **WHEN** a manager publishes a roster with one `on_leave` conflict without acknowledging it
- **THEN** publishing fails with 409 `unacknowledged_conflicts`, listing the conflict

#### Scenario: Change after publish
- **WHEN** a published shift for Ali moves from 09:00 to 10:00 and the roster is published again
- **THEN** only Ali is notified: "Your shift on Wed 2 Dec 2026 changed from 09:00–17:00 to 10:00–18:00"

### Requirement: Shift swaps and open shifts
An employee SHALL be able to offer one of their published future shifts to a colleague on the same roster. The offer is either a swap for one of the colleague's shifts or a give-away. The colleague SHALL accept or decline. On acceptance, the request SHALL go to approval through `workflows` as subject `shift_swap`.

An employee eligible for a roster SHALL be able to request an open published shift. The request goes straight to approval.

On final approval, the system SHALL re-run overlap and eligibility checks for the new holders, then exchange or reassign the shifts atomically in both the working and published copies. An `overlap`, or a shift changed since the request, SHALL fail the approval with the reason and leave the shifts unchanged. Both employees SHALL be notified of the result. A request SHALL be cancellable by the requester until approved, and SHALL expire automatically when the shift starts.

#### Scenario: Approved swap
- **WHEN** Ali swaps his Friday shift for Mei's Saturday shift, Mei accepts and the manager approves
- **THEN** Ali has Saturday, Mei has Friday, the roster version increments and both are notified

#### Scenario: Swap creates overlap
- **WHEN** a give-away is approved but the colleague was given an overlapping shift after accepting
- **THEN** approval fails with the overlap reason and the shifts are unchanged

### Requirement: The published roster as the schedule
For employees on a `shift` work schedule, and for dates in a week covered by their published roster, the published roster SHALL be the expected schedule. Precedence: published roster first, then the work schedule fallback. Fixed-week employees keep their work schedule.

- **Attendance** SHALL use the shift's start, end and paid minutes for lateness, early out and overtime. All work on a rostered off or rest day is overtime.
- **Leave** SHALL count only rostered dates as working days.
- **Payroll** SHALL receive the scheduled days through its `ScheduledDaysSource` port, for employees whose whole period is covered and who are employed for all of it. Scheduled days are the dates with a shift, public holidays not on the rest day, and counted leave dates. A manual "Scheduled days" item on the run SHALL win over the roster figure.

#### Scenario: Rostered employee's incomplete month
- **WHEN** every week of November is published for a rostered café worker who takes one day of no-pay leave
- **THEN** the November run computes without "Scheduled days" being entered, and basic pay is the monthly salary × days worked / scheduled days

#### Scenario: Leave on a rostered off day
- **WHEN** a rostered employee applies for annual leave Monday to Wednesday and has no shift on Tuesday
- **THEN** the leave counts 2 days and Tuesday shows "Not rostered"

### Requirement: Schedule views and export
Employees SHALL see in My schedule:
- their published shifts for the next 14 days;
- swap offers waiting for them;
- open shifts they can pick up.

They SHALL also see the published roster of their own scope. Managers and HR SHALL see rosters for their scope, with daily totals of rostered hours. A roster week SHALL be exportable to CSV with one row per shift: employee number, name, date, start, end, break minutes, paid minutes, template code and conflicts.

#### Scenario: Employee sees only published
- **WHEN** next week's roster is still a draft
- **THEN** the employee's My schedule shows "Next week's schedule hasn't been published yet"
