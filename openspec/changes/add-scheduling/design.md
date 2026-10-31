## Context

Depends on:
- identity and access (manager scope);
- organisation and people (locations, departments, tenures, work schedules of kind `shift`);
- workflows (subject `shift_swap`, notifications, tick);
- leave (`LeaveCalendar`, the working-day calculator in `leave/calendar.ts`);
- attendance (timesheets);
- payroll (ports).

Requirements are in `specs/scheduling`.

## Goals / Non-Goals

**Goals:**
- One request loads a 150 × 7 grid with its conflicts.
- Conflicts are computed on the server, so the web and mobile apps agree.
- Every downstream module reads one published truth.

**Non-Goals:** real-time collaborative editing. Last write wins per assignment. An `expectedUpdatedAt` check returns 409 `stale` when someone else changed the same shift.

## Decisions

1. **Scope.**
   - A roster is keyed by (`org_id`, `scope_key`, `week_start`). The scope is a location, a department, or both, and at least one must be set. `scope_key` is `"<locationId|*>:<departmentId|*>"`.
   - An employee is *eligible* for a roster week when, on at least one day of that week, they are employed (tenure) and their employment record matches the scope.
   - Managers (scope T) may open a roster only when at least one team member is eligible, and may assign only their team. Owners and hr_admins (scope A) may assign anyone eligible.
   - The grid lists eligible employees plus anyone already assigned.

2. **Timestamps, not times.** Shifts store `starts_at` and `ends_at` as `timestamptz`, computed from date + template in Asia/Singapore. An end at or before the start is the next day. `date` is the roster day the shift starts on. Paid minutes = end − start − break.

3. **Working copy and published copy.**
   - `roster_shifts` is the working copy that managers edit. Each row has a `kind`: `shift`, or `rest` (a marked rest day). `employee_id` is null for an open shift.
   - Publishing copies the working rows into `published_shifts` (same ids) in one transaction, replacing the roster's previous published rows. It increments `rosters.version` and writes a `roster_publications` row with the acknowledgements and a change summary.
   - Employees, `PlannedShifts`, attendance, leave and payroll read only `published_shifts`. Drafts and unpublished edits are invisible to them.
   - The diff between the old and new published rows decides who is notified:
     - first publish: everyone with a shift;
     - later publishes: only employees whose rows were added, removed or changed, with old and new times.
     - One employee gets one notification per publish.
   - `rosters.has_changes` is set on every working-copy edit and cleared on publish, so the grid can say "Unpublished changes".

4. **Rest days.**
   - A `rest` cell marks the employee's weekly rest day.
   - Where a week has no marked rest day:
     - for a fixed-week employee, the rest day is the one in their work schedule;
     - for a shift-schedule employee, Sunday (the EA default). The grid shows "Rest day assumed: Sunday".
   - A shift on the rest day raises `rest_day`. A week with shifts on all seven days raises `no_rest_day`. Both are warnings.

5. **Conflicts are computed, not stored.**
   - `conflictsFor(roster)` runs on read for the visible week: one leave query (`LeaveCalendar`), one shifts query and one employment load per roster.
   - Kinds:
     - `overlap`: blocks the save with 409 `shift_overlap`.
     - `on_leave`: approved leave, needs acknowledgement. Half-day leave conflicts by session. The AM/PM boundary is:
       - for fixed-week staff, the scheduled start (attendance settings) plus half the day's minutes;
       - for shift-schedule staff, the midpoint of the shift.
     - `outside_employment`: needs acknowledgement.
     - `pending_leave`: hint.
     - `public_holiday` and `rest_day`: warnings with the pay implication text from sg-rules.
     - `daily_hours` (> 12 h), `weekly_hours` (> 44 normal hours), `no_rest_day` and `ot_cap`: warnings.
   - `ot_cap` is the roster's projected overtime in the calendar month above 72 h. It counts minutes beyond the normal daily hours (8 h when the employee is rostered more than 5 days that week, else 9 h) and beyond 44 h in the week. Rest-day and public-holiday shifts count only their hours beyond normal daily hours, as MOM states.
   - Acknowledgements are stored on `roster_publications.acknowledged` (shift id + conflict kind) and in the audit log.
   - Leave approved after publishing calls `scheduling.onLeaveApproved` from the leave adapter, in the decision's transaction. It notifies the editors of affected rosters: the roster's last publisher plus hr_admins.

6. **Swaps and pickup** (`shift_swaps`):
   - Kinds:
     - `swap`: my shift for the colleague's shift;
     - `giveaway`: my shift to the colleague;
     - `pickup`: an open shift to me.
   - State machine:
     - swap and give-away: `pending_peer` → (accept) `pending_approval` → `approved` | `rejected`;
     - pickup starts at `pending_approval`;
     - any open state may end `cancelled` (requester), `declined` (peer) or `expired` (the shift started, via tick).
   - The workflows request is created on peer acceptance (pickup: on request). The default chain is the manager of the requester.
   - `onApproved` runs in the decision's transaction. It locks both shifts with `SELECT … FOR UPDATE`, checks they are unchanged and still published, re-runs overlap and eligibility checks for the new holders, and updates `roster_shifts` and `published_shifts` together. It bumps the roster version and notifies both employees. A failed check throws `AppError(shift_overlap | swap_stale)`, so the engine rolls the decision back and the approver sees why.
   - One open swap per shift (partial unique index).

7. **Feeds** (design of the precedence):
   - `PlannedShifts.forEmployee(orgId, employeeId, from, to)` returns published shifts only.
   - `loadRosterDays(db, times, from, to)` attaches `t.roster` (date → published shifts or rest, plus covered weeks) to the `EmployeeTime` values from `leave/calendar.ts`.
   - `dayInfo` then applies this precedence for **staff on a `shift` work schedule**:
     - **Published roster covers the date's week** (the employee has a published row in that week, or is eligible for a published roster of that week): the roster wins.
       - A date with shifts is `shift`, with the shifts' paid minutes and first start.
       - A marked rest date is `rest`.
       - Any other date is `off`.
     - **Not covered:** the old fallback (every day is a shift day of weekly/5 minutes).
   - Fixed-week staff ignore the roster in these feeds: their contractual week defines their working days. Their shifts still get conflict checks.
   - What each consumer does with it:
     - **Attendance:** expected start, end and minutes for lateness, early out and OT. Work on a rostered off or rest day is all OT, as for fixed-week rest days.
     - **Leave:** only rostered dates count. Uncovered dates keep the old count with its warning.
     - **Payroll:** `ScheduledDaysSource.listScheduledDays(orgId, from, to)` (new port in `payroll/ports.ts`, default `schedulingScheduledDaysSource`).
       - It returns an employee only when every date of the period is covered by their published roster and they are employed for the whole period. Otherwise HR enters the figure as today.
       - Scheduled days = |dates with a published shift ∪ public holidays that are not their rest day ∪ dates of approved leave counted for them|, so paid leave and holidays never make days worked exceed scheduled days.
       - The snapshot adds a `scheduled_days` run item (`source: "attendance"`, label "Scheduled days (from published roster)") unless the run already has a manual `scheduled_days` item: **a manual entry wins**, as for `days_worked`.

8. **Permissions.**
   - Existing rows: `rosters:read/create/update/publish`.
   - New rows:
     - `shift_templates:update` (owner, hr_admin): Settings → Shift templates;
     - `shift_swaps:create` (employee: own): request a swap or pickup.
   - Templates are read by anyone with `rosters:create` or `rosters:read`. Employees see their own published shifts, and the published roster of the scopes they are eligible for (names, times and template codes only).

## Data model

All tables have `org_id`, and FKs are composite.

| Table | Key columns |
| --- | --- |
| `shift_templates` | `id`, `location_id?`, `name`, `code`, `start_time`, `end_time`, `break_minutes`, `colour`, `archived_at` |
| `rosters` | `id`, `location_id?`, `department_id?`, `scope_key`, `week_start`, `status` (`draft`/`published`), `version`, `has_changes`, `published_at?`, `published_by_membership_id?`; unique (`org_id`, `scope_key`, `week_start`) |
| `roster_shifts` | `id`, `roster_id`, `employee_id?`, `kind`, `date`, `starts_at?`, `ends_at?`, `break_minutes`, `template_id?`, `note`, `updated_at` |
| `published_shifts` | same columns as `roster_shifts` plus `version`; `id` = the working shift's id |
| `roster_publications` | `id`, `roster_id`, `version`, `published_by_membership_id`, `acknowledged jsonb`, `changes jsonb`, `published_at` |
| `shift_swaps` | `id`, `roster_id`, `kind`, `shift_id`, `requester_employee_id`, `peer_employee_id?`, `peer_shift_id?`, `status`, `approval_request_id?`, `note`, `created_by_membership_id`, `expires_at`, `decided_at?` |

## Risks / Trade-offs

- [Payroll file ownership] → the port is additive and defaults to an empty list without rosters. The lead reviews the WS4 diff.
- [Partial-month coverage] → scheduled days are omitted unless the whole period is covered. A new hire mid-month still needs HR's figure, because MOM's denominator is the whole month's working days. Recorded in `docs/limitations.md`.
- [Week grid at phone width] → a day list replaces the grid below 768 px. Editing there is one shift at a time.
- [Days worked on an unrostered day] → attendance counts them as worked, so they can push days worked above scheduled days. Payroll then blocks with `ROSTER_DAYS_INVALID`, and HR decides. Recorded in limitations.
