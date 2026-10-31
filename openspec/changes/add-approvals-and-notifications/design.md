## Context

Depends on `add-identity-and-access` (memberships, roles, `authorize`, audit, optional `Mailer`) and `add-organisation-and-people` (manager resolution, work pass and probation data, checklists). Core is runtime-agnostic, so there are no timers inside core. Hosts drive time. Requirements are in `specs/workflows`.

## Goals / Non-Goals

**Goals:** modules integrate by implementing one adapter; every decision is transactional with the subject's state change; the inbox query is fast enough to render Home in under 200 ms for an org with 200 employees.

**Non-Goals:** a general job queue. `tick` handles only the sweeps listed in the spec. Long-running work such as payroll calculation runs inside requests.

## Decisions

1. **Subject adapters.** Each module registers this adapter at app construction:

   ```ts
   SubjectAdapter<T> {
     type;
     attributes(subject);   // { amountCents?, typeCode? }
     summary(subject);      // { title, lines[], context[] }
     onApproved(tx, id, decision);
     onRejected(tx, id, decision);
     onWithdrawn(tx, id);
     canRead(ctx, id);
   }
   ```

   The engine never reads module tables directly. *Alternative:* an event bus with eventual consistency. It is rejected because a leave approval must change the leave balance atomically.

2. **The snapshot is the chain.** On submit, the engine resolves the policy and writes `approval_steps` rows holding the approver *rule* (`manager`, `role:hr_admin`, `member:<id>`). Each step is resolved to concrete tasks only when it becomes active. Late resolution is what makes manager re-routing and delegation work. The policy *structure* is frozen at submit; the *people* are resolved when needed.

3. **Delegation applies at task-creation time and re-applies in the sweep.** When a delegation starts, existing open tasks of the delegator gain a delegate task. Tasks carry `on_behalf_of_membership_id`. Read access for delegates is granted by `canRead` checking for an open task. No permission rows are written.

4. **One locking discipline.** A decision runs `SELECT … FOR UPDATE` on `approval_requests`, checks that the task is still pending, writes the decision, advances the step or finalises, calls the adapter callback, then writes audit and notifications. Everything happens in one transaction, which gives `already_decided` under races.

5. **Notifications.** A `notify(tx, recipients, kind, payload)` call writes `notifications` rows and, if the mailer is configured and the preferences allow, `email_outbox` rows in the same transaction. Email templates are plain functions per kind that take only non-sensitive fields (enforced by a typed payload without money or ID fields, plus a test). They render a text part and a minimal HTML part in the Crow Tech style (system fonts in email, ink on white, a yellow accent bar).

6. **`tick(now)` design.** It is one exported function on the core app: `app.jobs.tick(now)`. Each sweep selects due rows with `FOR UPDATE SKIP LOCKED LIMIT 100` and loops until none are left.
   - **Escalation:** `approval_tasks.due_at <= now AND escalated_at IS NULL`.
   - **Reminders:** each `ReminderSource` yields `(subjectKey, threshold, dueOn, recipients)`. `reminders_sent` has a unique `(org_id, source, subject_key, threshold)` constraint, so `INSERT … ON CONFLICT DO NOTHING` is the de-duplication.
   - **Outbox:** sends rows where `next_attempt_at <= now`.
   - **Transitions:** registered by modules, such as the `former` membership transition.

   `apps/server` calls `tick` with `setInterval(60_000)` and on startup. The demo calls it every 30 s and on load. Tests call it with an injected clock.

7. **The inbox is a union of sources.** `InboxSource.list(ctx) → InboxItem[]` comes from approvals, checklists, reminders, setup and payroll (added by payroll). Each source does one indexed query. Items are merged and sorted in memory, which is fine at SME scale. Inline actions call the same decision endpoint as the full view.

8. **Escalation counts calendar days.** `due_at = activated_at + N × 24h`. Business-day escalation would depend on the leave module's holiday calendar and would add a cross-module dependency for marginal value.

## Data model sketch

All tables have `org_id`, and FKs are composite.

| Table | Key columns |
| --- | --- |
| `approval_policies` | `id`, `org_id`, `subject_type`, `name`, `condition jsonb?` (`{amountGte}` or `{typeCodes[]}`), `priority`, `is_default`, `active` |
| `approval_policy_steps` | `policy_id`, `position`, `approver_rule` (manager, manager_of_manager, role:<r>, member:<id>), `escalate_after_days` |
| `approval_requests` | `id`, `org_id`, `subject_type`, `subject_id`, `requester_employee_id`, `requester_membership_id`, `policy_id`, `status` (pending, approved, rejected, withdrawn), `current_position`, `attributes jsonb`, `submitted_at`, `decided_at` |
| `approval_steps` | `request_id`, `position`, `approver_rule`, `escalate_after_days`, `status` (waiting, active, approved, rejected, skipped), `skip_reason?`, `activated_at` |
| `approval_tasks` | `id`, `org_id`, `request_id`, `position`, `assignee_membership_id`, `on_behalf_of_membership_id?`, `origin` (resolved, delegated, escalated, reassigned), `status` (pending, approved, rejected, superseded), `due_at`, `escalated_at?`, `decided_at?`, `comment?`, `self_approved` |
| `delegations` | `id`, `org_id`, `from_membership_id`, `to_membership_id`, `starts_on`, `ends_on`, `subject_types[]?`, `created_by` |
| `notifications` | `id`, `org_id`, `recipient_membership_id`, `kind`, `title`, `link`, `subject_type?`, `subject_id?`, `created_at`, `read_at?` |
| `notification_prefs` | `membership_id`, `category`, `email_enabled` |
| `email_outbox` | `id`, `org_id`, `to`, `kind`, `payload jsonb`, `status` (queued, sent, failed, suppressed), `attempts`, `next_attempt_at`, `last_error` |
| `reminders_sent` | `org_id`, `source`, `subject_key`, `threshold`, `sent_at`; unique (`org_id`, `source`, `subject_key`, `threshold`) |

## Risks / Trade-offs

- [The adapter callback can be slow, holding the request row lock] → callbacks must do only local DB work. Lint rule: no outbound fetch inside adapter callbacks.
- [Delegation broadens data access] → access is limited to open tasks' subjects only. Medical attachments follow the "current approver" rule in `access-control`, and delegates count as current approvers. This is deliberate and documented.
- [Email deliverability (SPF/DKIM) is outside our control] → the docs cover it. The in-app inbox is the system of record.
- [The single-process tick blocks during large sweeps] → batched by 100, and the next tick continues.

## Migration Plan

Additive. Seeds default policies per org on organisation creation and through a migration for existing orgs.

## Open Questions

- Should approved leave cancellation default to immediate when the leave start date is in the future? This is the leave module's adapter choice, and it does not change this engine.
