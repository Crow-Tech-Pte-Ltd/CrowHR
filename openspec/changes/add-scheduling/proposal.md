## Why

Shift-based SMEs (F&B, retail, cleaning, security) build weekly rosters in WhatsApp and spreadsheets. They routinely roster someone who is on approved leave, and nobody can see who swapped with whom. QuickHR gates scheduling behind its Growth tier, which is a gap we can fill for free.

The roster is also the missing fact for three modules that already exist. Attendance has no expected start or length for staff on `shift` work schedules. Leave counts every day as a working day for them. Payroll blocks an incomplete month for rostered staff until HR types in "Scheduled days" by hand. Publishing a roster closes all three gaps.

## What Changes

- **Shift templates** (Settings → Shift templates, owners and hr_admins): name, code, start and end time (may cross midnight), unpaid break, optional location, and a colour token from a fixed restrained set.
- **Rosters**, one per scope and ISO week (Monday to Sunday). The scope is a location, a department, or both.
  - A week grid with employees as rows and days as columns. Assign by click, keyboard or drag. Templates or custom times; mark a rest day; leave a shift open for pickup.
  - Copy last week, clear the week, CSV export.
- **Draft and published copies.** Managers edit a working copy. Publishing snapshots it. Employees, attendance, leave and payroll read only the published copy, so drafts and unpublished edits are invisible to them. Publishing notifies only the employees whose shifts were added, removed or changed.
- **Conflict detection**, computed on the server:
  - overlapping shifts block the save;
  - shifts on approved leave or outside employment must be acknowledged on publish;
  - pending leave is a hint;
  - warnings come from cited `packages/sg-rules` limits: public holiday work and rest-day work (each with its pay implication), more than 12 hours in a day, more than 44 normal hours in a week, no rest day in the week, and projected overtime above 72 hours in the month.
- **Shift swaps and open-shift pickup** with approval through `workflows` (subject `shift_swap`):
  - swap and give-away need the colleague to accept first;
  - pickup of an open shift goes straight to approval;
  - approval re-checks conflicts and changes the shifts atomically.
- **Feeds** (published roster only, staff on a `shift` work schedule only):
  1. attendance uses the shift as the expected schedule for lateness, early out and OT;
  2. leave counts only rostered days as working days;
  3. payroll receives scheduled days through a new `ScheduledDaysSource` port. A manual "Scheduled days" item still wins.
- **Views:**
  - Schedules: the week grid. Desktop-first and usable on a tablet; a day list at phone width.
  - My schedule: a mobile list of the next 14 days, swap offers, open shifts.
  - Swap approvals in the Inbox.
  - Peer swap offers on Home.
- Fix: the clock screen no longer lists yesterday's punches under "Today's punches" after clocking out late at night.

Sized for SMEs: up to 150 employees per roster and 30 active templates per location.

## Capabilities

### New Capabilities
- `scheduling`: shift templates, rosters, assignments, conflicts, publishing, swaps and pickup, the attendance, leave and payroll feeds.

### Modified Capabilities
None. Leave, attendance and payroll keep their specs: they gain the published roster as an input where their specs already said "roster".

## Non-goals

- Auto-scheduling, demand forecasting, labour-cost budgeting.
- Shift bidding and availability or preference collection.
- Shift-based pay rules (allowances, night differentials), which stay in payroll. The grid flags rest-day and public-holiday pay implications as text and never computes pay.
- Multi-week rotating patterns (copy-week covers the common case).
- Real-time collaborative editing.

## Impact

- `packages/core`:
  - new `scheduling/` module and schema `scheduling.ts`, with one migration;
  - `SubjectAdapter` `shift_swap` in `CORE_WORKFLOW_PLUGINS`;
  - `PlannedShifts` and `RosterDays` for attendance and leave;
  - `ScheduledDaysSource` for payroll;
  - a leave-approval hook for conflicts after publish;
  - matrix rows `shift_templates:update` and `shift_swaps:create`.
- `packages/core/src/payroll/ports.ts` and `snapshot.ts`: the new port and the `scheduled_days` run item (owned by WS4; a small additive change requested by the lead).
- `packages/sg-rules/src/hours/`: normal daily hours (8 or 9), rest-day rule, and `checkRosterWeek`, cited to MOM.
- `apps/web`:
  - `_app/schedules/*` (Schedules, My schedule);
  - `_app/settings/shift-templates.tsx`;
  - a mobile tab entry;
  - the attendance clock fix.
