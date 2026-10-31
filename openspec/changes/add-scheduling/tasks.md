## 1. Model

- [x] 1.1 packages/core: write `scheduling/schema.test.ts` (tables, unique roster per scope-week, composite FKs, one open swap per shift) then add `scheduling.ts` schema and migration
- [x] 1.2 packages/core: write `scheduling/templates.http.test.ts` (overnight paid duration, break < length, code length and uniqueness, 30 active per location, archive in use) then implement templates and Settings → Shift templates permissions (`shift_templates:update`)
- [x] 1.3 packages/core: write `scheduling/rosters.http.test.ts` (scope eligibility, manager team-only, 150-employee cap, stale 409 on concurrent edit, open shifts, rest-day cells, copy last week with skip reasons, clear week) then implement rosters and shifts

## 2. Conflicts

- [x] 2.1 packages/core: write `scheduling/conflicts.test.ts` with a `LeaveCalendar` double (overlap blocks; full-day and AM/PM leave by work-schedule boundary; shift-schedule midpoint; outside employment; pending hint; public holiday and rest day with pay text) then implement `conflictsFor`
- [x] 2.2 packages/sg-rules: add cited `hours/` (normal daily hours 8/9, rest day per week) and `checkRosterWeek` with tests; core `scheduling/hours.test.ts` (12 h day, 44 h week, no rest day, 72 h projected monthly OT) then wire `daily_hours`, `weekly_hours`, `no_rest_day`, `ot_cap`
- [x] 2.3 packages/core: write `scheduling/leave-after-publish.test.ts` (leave approved later flags shifts and notifies roster editors) then implement the hook in the leave adapter

## 3. Publishing and swaps

- [x] 3.1 packages/core: write `scheduling/publish.http.test.ts` (unacknowledged conflicts → 409 listing them; acknowledgements audited; version increments; first publish notifies everyone with shifts; drafts and unpublished edits invisible to employees; republish notifies only changed employees with old/new times) then implement
- [x] 3.2 packages/core: write `scheduling/swaps.http.test.ts` (swap and give-away within roster; peer accept creates `shift_swap` request; pickup of an open shift; approval swaps atomically in working and published copies; overlap fails approval and rolls back; cancel; decline; expiry at shift start via tick; Home item for the peer) then implement the state machine and `SubjectAdapter`
- [x] 3.3 packages/core: write `scheduling/planned-shifts.test.ts` (published only, range query) then expose `PlannedShifts`

## 4. Feeds

- [x] 4.1 packages/core: write `scheduling/attendance-feed.test.ts` (late vs shift start, OT beyond the shift, off-day work all OT, draft roster ignored, fixed-week staff unaffected) then attach the published roster to `EmployeeTime` / `dayInfo`
- [x] 4.2 packages/core: write `scheduling/leave-feed.http.test.ts` (rostered days only; uncovered weeks fall back) then use the roster in `countLeave`
- [x] 4.3 packages/core: write `scheduling/payroll-feed.http.test.ts` (no `SCHEDULED_DAYS_REQUIRED` block once the month is published; manual entry wins; partial coverage omitted) then add `ScheduledDaysSource` to payroll ports and the snapshot
- [x] 4.4 packages/core: write `scheduling/cafe-month.http.test.ts`: a rostered café worker's full month (roster → publish → clock-ins → OT claims approved → no-pay day → payroll run) with exact cents

## 5. Access, export

- [x] 5.1 packages/core: matrix rows (`shift_templates:update`, `shift_swaps:create`), cross-org seeding of every scheduling table, OpenAPI snapshot
- [x] 5.2 packages/core: write `scheduling/export.http.test.ts` (CSV columns, paid minutes, conflicts column) then implement roster CSV export

## 6. Web

- [ ] 6.1 apps/web: Settings → Shift templates
- [ ] 6.2 apps/web: Schedules week grid (click, keyboard, drag; copy last week; publish with acknowledgement; daily totals; restrained colour tokens; readable at 25 × 7; tablet) and day list at phone width
- [ ] 6.3 apps/web: My schedule (mobile list of 14 days, unpublished message, swap offers, open shifts, request swap/pickup) and the mobile tab
- [ ] 6.4 apps/web: attendance clock lists only today's punches (and an open overnight shift), not yesterday's after clocking out
- [ ] 6.5 e2e: `e2e/schedules.spec.ts` (build next week's roster, publish, employee sees it at 390 px, requests a swap, peer accepts, manager approves in the Inbox) and WS5b screenshots at 1440, 1024 and 390
