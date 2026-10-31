## Purpose

Defines SME-sized shift rostering: shift templates, weekly rosters per location, conflict detection against leave and employment dates, publishing, and employee shift swaps with approval.

## ADDED Requirements

### Requirement: Shift templates
Owners, hr_admins and managers SHALL maintain shift templates with: name, unique short code (1 to 6 characters), start time, end time (an end time at or before the start time means the shift ends the next day), unpaid break in minutes (0 to 240, less than the shift length), and an optional location. Paid duration SHALL be computed as end minus start minus break, and shown in hours and minutes. Templates in use SHALL be archived, not deleted. An organisation SHALL have at most 30 active templates per location.

#### Scenario: Overnight shift
- **WHEN** a template "Night" runs 22:00–06:00 with a 30-minute break
- **THEN** its paid duration is 7 h 30 min and assignments using it end at 06:00 the next day

### Requirement: Rosters and assignments
A roster SHALL exist per location per ISO week (Monday start), with status `draft` or `published` and a version number. Assignments SHALL belong to employees whose current location is the roster's location. Each assignment has a date, start and end timestamps in Asia/Singapore, break minutes, an optional template and an optional note of up to 200 characters. Managers SHALL edit rosters only for locations where at least one team member is assigned, and SHALL assign only their team. "Copy previous week" SHALL copy assignments for employees still eligible and report those skipped, with reasons. A roster SHALL hold at most 150 employees.

#### Scenario: Copy previous week
- **WHEN** a manager copies last week into a new draft and one employee has since resigned
- **THEN** all other assignments are copied and the summary says "1 shift not copied: <name> left on 30 Nov 2026"

### Requirement: Conflict detection
For every assignment the system SHALL detect:
- `overlap`: another assignment of the same employee overlapping in time. This SHALL block the save with 409 `shift_overlap`.
- `on_leave`: approved leave covering any part of the shift. Full-day leave conflicts with every shift that day. Half-day leave conflicts by session, using the AM and PM boundaries from the employee's work schedule.
- `outside_employment`: before the hire date or after the last working day.
- `pending_leave`: pending leave that overlaps the shift. This is a hint only.
- `hours_warning`: daily or weekly hours above the limits returned by `packages/sg-rules` for the employee. This stays NOT IMPLEMENTED until those limits are cited (TODO: `research/sg-regulatory.md`).

Conflicts SHALL show in the grid cell with a text label and icon, not colour alone. Leave approved after publishing SHALL flag the affected shifts and notify the roster's editors.

#### Scenario: Shift over approved leave
- **WHEN** a manager assigns a shift on a day the employee has approved annual leave
- **THEN** the assignment saves with an `on_leave` conflict and the cell shows "On leave"

#### Scenario: Overlap blocked
- **WHEN** an employee already has 09:00–17:00 on Tuesday and a 16:00–22:00 shift is added for them that day
- **THEN** the save fails with 409 `shift_overlap`, naming the existing shift

### Requirement: Publishing
Publishing a roster SHALL require explicit acknowledgement of each unresolved `on_leave` and `outside_employment` conflict. The acknowledgements are recorded in the audit log. Publishing SHALL set the status to `published`, increment the version, and notify each employee with at least one shift that week. Editing a published roster SHALL keep it published and visible to employees. Each saved change SHALL notify only the employees whose assignments were added, removed or changed, with the old and new times. Employees SHALL never see draft rosters.

#### Scenario: Publish with conflict
- **WHEN** a manager publishes a roster with one `on_leave` conflict without acknowledging it
- **THEN** publishing fails with 409 `unacknowledged_conflicts`, listing the conflict

#### Scenario: Change after publish
- **WHEN** a published shift for Ali moves from 09:00 to 10:00
- **THEN** only Ali is notified: "Your shift on Wed 2 Dec 2026 changed from 09:00–17:00 to 10:00–18:00"

### Requirement: Shift swaps
An employee SHALL be able to offer one of their published future shifts to a colleague in the same roster, either as a swap for one of the colleague's shifts or as a give-away. The colleague SHALL accept or decline. On acceptance, the request SHALL go to approval through `workflows` as subject `shift_swap`. On final approval, the system SHALL re-run conflict detection for both employees, then exchange or reassign the shifts atomically. An `overlap` SHALL fail the approval with the reason. Both employees SHALL be notified of the result. A swap SHALL be cancellable by the requester until approved, and SHALL expire automatically when the shift starts.

#### Scenario: Approved swap
- **WHEN** Ali swaps his Friday shift for Mei's Saturday shift, Mei accepts and the manager approves
- **THEN** Ali has Saturday, Mei has Friday, the roster version increments and both are notified

#### Scenario: Swap creates overlap
- **WHEN** a give-away is approved but the colleague was assigned an overlapping shift after accepting
- **THEN** approval fails with the overlap reason and the shifts are unchanged

### Requirement: Schedule views and export
Employees SHALL see their published shifts for the next 14 days in My shifts, and the published roster of their own location. Managers and HR SHALL see rosters for their scope, with daily totals of assigned hours per day. A roster week SHALL be exportable to CSV with one row per assignment (employee number, name, date, start, end, break minutes, paid minutes, template code, conflicts).

#### Scenario: Employee sees only published
- **WHEN** next week's roster is still a draft
- **THEN** the employee's My shifts shows "Next week's schedule hasn't been published yet"
