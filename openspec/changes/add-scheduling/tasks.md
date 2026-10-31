## 1. Model

- [ ] 1.1 packages/core: write `testing/schema.scheduling.test.ts` (tables, unique roster per location-week, composite FKs) then add `scheduling.ts` schema and migration
- [ ] 1.2 packages/core: write `scheduling/templates.test.ts` (overnight paid duration, break < length, code length, 30 active per location, archive in use) then implement templates
- [ ] 1.3 packages/core: write `scheduling/assignments.http.test.ts` (location eligibility, manager team-only, 150-employee cap, stale 409 on concurrent edit, copy previous week with skip reasons, cross-org 404) then implement rosters and assignments

## 2. Conflicts

- [ ] 2.1 packages/core: write `scheduling/conflicts.test.ts` with a `LeaveCalendar` double (overlap blocks; full-day and AM/PM leave by work-schedule boundary; shift-schedule midpoint; outside employment; pending hint) then implement `conflictsFor`
- [ ] 2.2 packages/core: write `scheduling/hours-warning.test.ts` against an sg-rules stub — implementation stays `// NOT IMPLEMENTED:` and this task unchecked until sg-rules ships cited limits
- [ ] 2.3 packages/core: write `scheduling/leave-after-publish.test.ts` (leave approved later flags shifts and notifies roster editors via `ScheduleConflictNotifier`) then implement the hook for the leave adapter

## 3. Publishing and swaps

- [ ] 3.1 packages/core: write `scheduling/publish.test.ts` (unacknowledged conflicts → 409 listing them; acknowledgements audited; version increments; employees with shifts notified; drafts invisible to employees; post-publish edit notifies only changed employees with old/new times) then implement
- [ ] 3.2 packages/core: write `scheduling/swaps.test.ts` (offer/give-away within roster; peer accept creates `shift_swap` request; approval re-checks conflicts and swaps atomically; overlap fails approval; cancel; expiry at shift start via tick) then implement the state machine and `SubjectAdapter`
- [ ] 3.3 packages/core: write `scheduling/planned-shifts.test.ts` (published only, range query) then expose `PlannedShifts` for attendance

## 4. Views

- [ ] 4.1 packages/core: write `scheduling/export.test.ts` (CSV columns, paid minutes, conflicts column) then implement roster CSV export via the shared export writer
- [ ] 4.2 apps/web: write `e2e/roster.spec.ts` (build a week from templates, see "On leave" label, publish requires acknowledgement, copy previous week summary) then build the week grid and day view
- [ ] 4.3 apps/web: write `e2e/my-shifts.spec.ts` at 360px (next 14 days, unpublished message, offer swap, peer accepts, manager approves from Home) then build My shifts and swap flows
