## 1. Engine core

- [ ] 1.1 packages/core: write `testing/schema.workflows.test.ts` (tables, composite FKs, unique reminder key) then add `workflows.ts` and `notifications.ts` schema and migration
- [ ] 1.2 packages/core: write `workflows/policy-resolution.test.ts` (highest-priority matching policy, amount and type-code conditions, default per subject type, payroll default owner, snapshot unaffected by later policy edit) then implement policy CRUD and resolution
- [ ] 1.3 packages/core: write `workflows/approver-resolution.test.ts` (manager, manager_of_manager, role, member; skip self/no-manager/suspended with reason; all skipped → hr_admins; payroll and sole-hr_admin → owners; sole owner `self_approved`) then implement
- [ ] 1.4 packages/core: write `workflows/decide.test.ts` using a fake `SubjectAdapter` (any-of step closes on first decision, others superseded; reject needs 1–500-char comment; 409 `already_decided` on concurrent decide; callback throw rolls back; audit on decide) then implement submit/decide
- [ ] 1.5 packages/core: write `workflows/withdraw-cancel.test.ts` (withdraw pending → superseded + notices; cancellation subject submitted separately; original stays approved until cancellation approved) then implement
- [ ] 1.6 packages/core: write `workflows/http.test.ts` (task list scoped to assignee, subject read via adapter `canRead`, cross-org 404, decide endpoint) then implement routes

## 2. Delegation, escalation, rerouting

- [ ] 2.1 packages/core: write `workflows/delegation.test.ts` (date window inclusive with injected clock, subject-type filter, delegate never gets own request, role steps require delegate role, read access only for open delegated tasks, hr_admin sets on behalf) then implement
- [ ] 2.2 packages/core: write `workflows/escalation.test.ts` (due after N days, reminder + next-level task once, 0 disables, assignee without manager → hr_admins) then implement escalation in the sweep
- [ ] 2.3 packages/core: write `workflows/reroute.test.ts` (manager change supersedes old manager task and creates new one; reassignment by hr_admin with reason audited) then implement the lifecycle hook and reassign endpoint

## 3. Notifications and email

- [ ] 3.1 packages/core: write `notifications/notify.test.ts` (in-app rows, unread count, 180-day retention sweep, preferences respected, security kinds always emailed) then implement
- [ ] 3.2 packages/core: write `notifications/email-templates.test.ts` (each kind renders; payload types reject money/ID fields; rendered bodies contain no `S$` amounts, NRIC patterns or bank numbers) then implement templates
- [ ] 3.3 packages/core: write `notifications/outbox.test.ts` (retry schedule 1/5/30/120/720 min, failed after 5, suppressed when no mailer, owners see failures) then implement the outbox sweep
- [ ] 3.4 apps/server: write `src/mailer.test.ts` against an in-process SMTP sink then implement the SMTP `Mailer` from `SMTP_URL`/`MAIL_FROM`

## 4. Sweep and reminders

- [ ] 4.1 packages/core: write `jobs/tick.test.ts` (idempotent, `SKIP LOCKED` prevents double processing with two concurrent ticks on PGlite, catch-up after a 2-day gap) then implement `tick(now)` and the transition registry
- [ ] 4.2 packages/core: write `workflows/reminders.test.ts` (work pass 90/60/30/7/0, probation −14 to manager + hr, exactly once per threshold across 1 440 ticks, stops when resolved) then implement reminder sources for work pass and probation
- [ ] 4.3 packages/core: define the `ReminderSource` contract for payroll cutoff with a test double in `workflows/payroll-cutoff-reminder.test.ts`; the real source is implemented by the payroll change — leave this task unchecked until then
- [ ] 4.4 apps/server: write `src/scheduler.test.ts` (tick on start and every 60 s with fake timers, stops on shutdown) then implement

## 5. Inbox and UI

- [ ] 5.1 packages/core: write `workflows/inbox.test.ts` (union of sources, overdue first then due date then age, only actionable items, role filtering) then implement `GET /api/v1/inbox`
- [ ] 5.2 apps/web: write `e2e/home-inbox.spec.ts` (manager approves a leave inline, rejection requires comment, empty state text, no stat cards) then replace the foundation's fixture Home with the real inbox
- [ ] 5.3 apps/web: write `e2e/approvals-settings.spec.ts` (create amount-threshold claim policy, set out-of-office delegation, escalation shown as "Escalated") then build Settings → Approvals, notification bell and the delegation form
- [ ] 5.4 packages/demo: write `src/tick.test.ts` (interval tick, demo mailbox lists outbox) then wire the demo scheduler — coordinate with the demo workstream
