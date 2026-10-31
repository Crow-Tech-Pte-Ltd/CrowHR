## Context

Depends on identity and access (manager scope), organisation and people (locations, employees, tenures, work schedules of kind `shift`), workflows (subject `shift_swap`, notifications) and the leave module (M1; not yet specced) through a narrow `LeaveCalendar` interface. Requirements are in `specs/scheduling`.

## Goals / Non-Goals

**Goals:** a grid that loads a 150 × 7 roster in one request; conflict detection computed on the server, so the web and mobile apps agree; no dependency on leave internals.

**Non-Goals:** real-time collaborative editing. Last write wins per assignment, and an `updated_at` check returns 409 `stale` when someone else changed the same cell.

## Decisions

1. **Timestamps, not times.** Assignments store `starts_at` and `ends_at` as `timestamptz`, computed from date + template in Asia/Singapore. Singapore has no DST, but storing instants keeps overnight shifts and attendance matching trivial. `date` is the roster day the shift starts on.

2. **`LeaveCalendar` interface** (defined here, implemented by leave): `LeaveCalendar.entries(orgId, employeeIds, from, to) → { employeeId, date, session: 'full' | 'am' | 'pm', status: 'approved' | 'pending' }[]`. Until leave exists, a test double is used, and the conflict type stays live only in tests. The AM/PM boundary for half-day leave comes from the employee's work schedule version; for `shift` schedules it falls at the midpoint of the shift.

3. **Conflicts are computed, not stored.** `conflictsFor(assignments)` runs on read for the visible week. It does one leave query and one assignments query per roster, cheap at SME scale. Acknowledgements are stored as `roster_publications.acknowledged jsonb` (assignment ID + conflict type) for the audit trail. Leave approved after publishing triggers a workflows notification from the leave adapter's `onApproved`, through a `ScheduleConflictNotifier` hook exposed here.

4. **Versioning and change notices.** Each publish or post-publish save increments `rosters.version` and writes `roster_changes` rows (assignment, before, after). The notifier groups changes by employee per save, so one employee gets one notification per save.

5. **Swaps are a two-phase state machine:** `pending_peer` → (accept) `pending_approval` → `approved` | `rejected` | `cancelled` | `expired`. The workflows request is created only on peer acceptance. Approval runs in the workflows transaction and swaps `employee_id` on both assignments under `SELECT … FOR UPDATE`.

6. **Exposure to attendance.** `PlannedShifts.forEmployee(orgId, employeeId, from, to)` returns published assignments only.

## Data model sketch

All tables have `org_id`, and FKs are composite.

| Table | Key columns |
| --- | --- |
| `shift_templates` | `id`, `org_id`, `location_id?`, `name`, `code`, `start_time`, `end_time`, `break_minutes`, `archived_at` |
| `rosters` | `id`, `org_id`, `location_id`, `week_start` (Monday), `status`, `version`, `published_at?`; unique (`org_id`, `location_id`, `week_start`) |
| `shift_assignments` | `id`, `org_id`, `roster_id`, `employee_id`, `date`, `starts_at`, `ends_at`, `break_minutes`, `template_id?`, `note`, `updated_at` |
| `roster_publications` | `id`, `org_id`, `roster_id`, `version`, `published_by`, `acknowledged jsonb` |
| `roster_changes` | `id`, `org_id`, `roster_id`, `version`, `assignment_id`, `before jsonb?`, `after jsonb?`, `changed_by`, `at` |
| `shift_swaps` | `id`, `org_id`, `from_assignment_id`, `to_employee_id`, `to_assignment_id?`, `status`, `approval_request_id?`, `created_at`, `expires_at` |

## Risks / Trade-offs

- [Leave is not specced yet] → the interface is minimal, and the leave change must implement it. The roadmap records the dependency.
- [Hour-limit warnings depend on regulatory research] → `hours_warning` is behind `// NOT IMPLEMENTED:` and the task stays unchecked until sg-rules cites the limits.
- [Week grid at 360px] → a day view with an employee list replaces the grid on narrow screens. Editing on mobile is limited to single assignments.
