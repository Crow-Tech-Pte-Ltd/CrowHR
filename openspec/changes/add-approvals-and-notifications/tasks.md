## 1. Engine core

- [x] 1.1 packages/core: write `testing/schema.workflows.test.ts` (tables, composite FKs, unique reminder key) then add `workflows.ts` and `notifications.ts` schema and migration
- [x] 1.2 packages/core: write `workflows/policy-resolution.test.ts` (highest-priority matching policy, amount and type-code conditions, default per subject type, payroll default owner, snapshot unaffected by later policy edit) then implement policy CRUD and resolution
- [x] 1.3 packages/core: write `workflows/approver-resolution.test.ts` (manager, manager_of_manager, role, member; skip self/no-manager/suspended with reason; all skipped → hr_admins; payroll and sole-hr_admin → owners; sole owner `self_approved`) then implement
- [x] 1.4 packages/core: write `workflows/decide.test.ts` using a fake `SubjectAdapter` (any-of step closes on first decision, others superseded; reject needs 1–500-char comment; 409 `already_decided` on concurrent decide; callback throw rolls back; audit on decide) then implement submit/decide
- [x] 1.5 packages/core: write `workflows/withdraw-cancel.test.ts` (withdraw pending → superseded + notices; cancellation subject submitted separately; original stays approved until cancellation approved) then implement
- [x] 1.6 packages/core: write `workflows/http.test.ts` (task list scoped to assignee, subject read via adapter `canRead`, cross-org 404, decide endpoint) then implement routes

## 2. Delegation, escalation, rerouting

- [x] 2.1 packages/core: write `workflows/delegation.test.ts` (date window inclusive with injected clock, subject-type filter, delegate never gets own request, role steps require delegate role, read access only for open delegated tasks, hr_admin sets on behalf) then implement
- [x] 2.2 packages/core: write `workflows/escalation.test.ts` (due after N days, reminder + next-level task once, 0 disables, assignee without manager → hr_admins) then implement escalation in the sweep
- [x] 2.3 packages/core: write `workflows/reroute.test.ts` (manager change supersedes old manager task and creates new one; reassignment by hr_admin with reason audited) then implement the lifecycle hook and reassign endpoint

## 3. Notifications and email

- [x] 3.1 packages/core: write `notifications/notify.test.ts` (in-app rows, unread count, 180-day retention sweep, preferences respected, security kinds always emailed) then implement
- [x] 3.2 packages/core: write `notifications/email-templates.test.ts` (each kind renders; payload types reject money/ID fields; rendered bodies contain no `S$` amounts, NRIC patterns or bank numbers) then implement templates
- [x] 3.3 packages/core: write `notifications/outbox.test.ts` (retry schedule 1/5/30/120/720 min, failed after 5, suppressed when no mailer, owners see failures) then implement the outbox sweep
- [x] 3.4 apps/server: write `src/mailer.test.ts` against an in-process SMTP sink then implement the SMTP `Mailer` from `SMTP_URL`/`MAIL_FROM`

## 4. Sweep and reminders

- [x] 4.1 packages/core: write `jobs/tick.test.ts` (idempotent, `SKIP LOCKED` prevents double processing with two concurrent ticks on PGlite, catch-up after a 2-day gap) then implement `tick(now)` and the transition registry
- [x] 4.2 packages/core: write `workflows/reminders.test.ts` (work pass 90/60/30/7/0, probation −14 to manager + hr, exactly once per threshold across 1 440 ticks, stops when resolved) then implement reminder sources for work pass and probation — the sources read `deps.peopleDates` (a `PeopleDates` interface, tested with a double); they stay inactive until the people module implements it (docs/limitations.md)
- [ ] 4.3 packages/core: define the `ReminderSource` contract for payroll cutoff with a test double in `workflows/payroll-cutoff-reminder.test.ts`; the real source is implemented by the payroll change — leave this task unchecked until then (contract + double test done)
- [x] 4.4 apps/server: write `src/scheduler.test.ts` (tick on start and every 60 s with fake timers, stops on shutdown) then implement

## 5. Inbox and UI

- [x] 5.1 packages/core: write `workflows/inbox.test.ts` (union of sources, overdue first then due date then age, only actionable items, role filtering) then implement `GET /api/v1/inbox`
- [x] 5.2 apps/web: write `e2e/home-inbox.spec.ts` (manager approves a leave inline, rejection requires comment, empty state text, no stat cards) then replace the foundation's fixture Home with the real inbox — leave doesn't exist yet, so the spec uses people's real `profile_change` request type (seeded chain manager → HR admin): submit → manager on Home → HR in the inbox → change applied → requester notified
- [x] 5.3 apps/web: write `e2e/approvals-settings.spec.ts` (create amount-threshold claim policy, set out-of-office delegation, escalation shown as "Escalated") then build Settings → Approvals, notification bell and the delegation form — the delegation form lives in the Inbox ("Out of office") and, for HR, in Settings → Approvals; My profile belongs to the people workstream. Also built: the Inbox page (j/k/a/r/x keys, bulk approve, optimistic updates) and Settings → Notifications
- [x] 5.4 packages/demo: write `src/tick.test.ts` (interval tick, demo mailbox lists outbox) then wire the demo scheduler — done by WS8b: the worker runs `createManualScheduler`, the page ticks it every 30 s and on navigation, sweep email lands in the Demo outbox

## 6. Integration with people and self-hosting

- [x] 6.1 packages/core: write `workflows/people-integration.test.ts` (line manager from employment records, profile change decided through the engine and applied, bank → payroll_admin, cancel/withdraw both ways, legacy endpoint closes the request, transfer re-routes the manager task, real work-pass/probation/checklist/setup items on Home, `former` transition in `tick`) then wire `approverDirectory`, `peopleDates`, the profile-change `SubjectAdapter`, checklist and setup `InboxSource`s and the former transition
- [x] 6.2 packages/core: write `workflows/system.test.ts` (owners warned when the last successful backup is older than 48 h; quiet where backups aren't expected) then add the backup `InboxSource`; apps/server runs the nightly backup check on the shared scheduler
