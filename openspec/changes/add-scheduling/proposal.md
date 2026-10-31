## Why

Shift-based SMEs (F&B, retail, cleaning, security) build weekly rosters in WhatsApp and spreadsheets. They routinely roster someone who is on approved leave, and nobody can see who swapped with whom. QuickHR gates scheduling behind its Growth tier, which is a gap we can fill for free. This change also gives attendance and OT a planned-shift baseline for employees on `shift` work schedules.

## What Changes

- **Shift templates:** name, code, start and end time (may cross midnight), unpaid break minutes, optional location.
- **Rosters:**
  - one per location and ISO week (Monday to Sunday), in a week-grid editor with employees as rows and days as columns;
  - assign a template or a custom shift, copy from the previous week, clear a week;
  - statuses `draft` and `published`; employees see only published shifts.
- **Conflict detection:**
  - overlapping shifts for one employee are blocked;
  - shifts on approved leave, or on a day the employee is not yet hired or has already left, are flagged and must be acknowledged on publish;
  - pending leave is shown as a hint;
  - daily and weekly hour warnings come from `packages/sg-rules` once its values are cited.
- **Publishing:** notifies affected employees. Edits after publishing raise the roster version, and only changed assignments are notified.
- **Shift swaps:** an employee offers a swap or a give-away to a colleague in the same roster. The colleague accepts, then the manager approves through `workflows` (subject `shift_swap`). Assignments exchange atomically, and conflicts are re-checked at approval.
- **Views:** my shifts (list, next 14 days), the published location roster for employees of that location, and CSV export of a roster week.

Sized for SMEs: up to 150 employees and 30 templates per location roster.

## Capabilities

### New Capabilities
- `scheduling`: shift templates, rosters, assignments, conflict detection with leave, publishing, swaps.

### Modified Capabilities
None.

## Non-goals

- Auto-scheduling, demand forecasting, labour-cost budgeting.
- Open shifts and shift bidding.
- Availability and preference collection.
- Shift-based pay rules (shift allowances, night differentials), which stay in payroll.
- Clock-in matching against shifts, which the attendance change (M2) consumes from here.
- Multi-week rotating patterns (copy-week covers the common case).
- Rosters spanning several locations in one grid.

## Impact

- `packages/core`: new `scheduling/` module and schema `scheduling.ts`. It consumes the leave module's `LeaveCalendar` interface (approved and pending leave by employee and date range) and implements the workflows `SubjectAdapter` for `shift_swap`. It exposes `PlannedShifts.forEmployee(range)` for attendance.
- `apps/web`: Schedule (week grid, desktop-first with a day view at 360px) and My shifts.
- `packages/sg-rules`: hour-limit warning functions, owned by the sg-rules workstream; consumed here as NOT IMPLEMENTED until cited.
