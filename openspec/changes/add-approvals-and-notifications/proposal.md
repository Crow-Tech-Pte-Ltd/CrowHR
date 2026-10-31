## Why

Leave, claims, OT, timesheets, profile changes, shift swaps and payroll runs all need "someone else must agree before this takes effect". If each module built its own approvals, the rules would drift. Approvers on leave would stall requests, and nobody would get one inbox. SME owners also say email is unreliable, so the in-app inbox must be the dependable channel and the product must work fully without SMTP.

## What Changes

- **One generic approval engine.** Modules submit a *subject* (type, ID, requester, attributes such as `amountCents`) and receive `approved` or `rejected` callbacks.
- **Configurable policies per subject type:**
  - ordered steps, with each step resolving to the requester's manager (level 1 or 2), a role (hr_admin, payroll_admin, owner) or a named member;
  - conditions on attributes (amount thresholds, leave or claim type);
  - a default policy per subject type ("manager, then hr_admin fallback").
  Payroll defaults to "owner".
- **Rules:**
  - The chain is snapshotted at submission.
  - Self-approval and missing managers are skipped, falling back to HR and then to an owner.
  - Pending manager steps re-route when a reporting line changes.
  - Delegation covers out-of-office dates.
  - A step escalates after N days (default 3).
  - Requesters can withdraw while pending, and modules can request cancellation of approved items.
  - HR can reassign tasks.
- **In-app notifications** with an unread count. **Email notifications** go through an outbox with retries when SMTP is configured, contain no sensitive data, and have per-user email preferences (security emails are always sent).
- **Reminders:** work pass expiry (90/60/30/7/0 days), probation end (14 days before), payroll cutoff (3 days before, cutoff date from payroll settings), and document expiry through the same mechanism. Reminders are de-duplicated per threshold.
- **A host-driven `tick(now)` sweep** for escalations, reminders, the email outbox and date-triggered transitions. It is runtime-agnostic: the server runs it every minute and the demo on an interval.
- **Home "work to do" inbox:** approval tasks, checklist items, reminders and setup steps for the current member, ordered by overdue first and then by due date, with inline approve/reject for simple subjects.

## Capabilities

### New Capabilities
- `workflows`: approval engine, policies, delegation, escalation, withdraw/cancel, notifications (in-app + email), reminders, Home inbox.

### Modified Capabilities
None.

## Non-goals

- Parallel approval inside one step that needs all approvers (*all-of*). V1 steps are *any-of*.
- A visual workflow designer, arbitrary scripting in conditions, or conditions on fields other than declared subject attributes.
- Web push, SMS, WhatsApp, and native mobile push.
- Editable email templates (P1). Templates ship in code with organisation name and logo.
- Calendar-aware escalation using business days or public holidays. V1 counts calendar days.
- Approving by replying to an email.

## Impact

- `packages/core`:
  - new `workflows/`, `notifications/` and `jobs/` modules, with schema `workflows.ts` and `notifications.ts`;
  - a `SubjectAdapter` interface that leave, claims, OT, timesheet, profile-change, shift-swap and payroll implement;
  - an `InboxSource` interface for checklists, setup and payroll due;
  - a `ReminderSource` interface.
- `apps/server`: SMTP env (`SMTP_URL`, `MAIL_FROM`), a `Mailer` using nodemailer, and a `setInterval` tick.
- `packages/demo`: interval tick and the demo mailbox.
- `apps/web`: Home inbox (replacing foundation fixtures), notification bell, Settings → Approvals and Notifications, and "Out of office" delegation in My profile.
