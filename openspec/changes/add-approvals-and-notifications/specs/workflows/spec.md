## Purpose

Defines the single approval engine every module uses, plus the notifications, reminders and Home "work to do" inbox that tell people what needs their attention.

## ADDED Requirements

### Requirement: Approval subjects
Modules SHALL submit approval requests for these subject types: `leave`, `leave_cancellation`, `claim`, `overtime`, `timesheet`, `profile_change`, `shift_swap` and `payroll_run`. Each request carries the requester (an employee), the subject ID and declared attributes: `amountCents` (an integer, optional) and a type code (such as the leave or claim type, optional). The engine SHALL call the module's `approved`, `rejected`, `withdrawn` or `cancelled` callback in the same transaction as the final decision. A failing callback SHALL roll back the decision.

#### Scenario: Callback failure rolls back
- **WHEN** the final approver approves a leave request and the leave module's callback throws because the balance is now insufficient
- **THEN** the task stays pending, the approver sees the module's error message, and no audit event `approval.decided` is recorded

### Requirement: Approval policies
Owners and hr_admins SHALL configure policies per subject type, except `payroll_run`, which only owners configure. A policy has:
- an optional condition, either `amountCents >= N` or type code in a list;
- a priority;
- 1 to 5 ordered steps.

Each step's approver SHALL be one of: `manager` (the requester's manager), `manager_of_manager`, a role (`hr_admin`, `payroll_admin` or `owner`, where any member holding it may decide), or a specific member. The engine SHALL choose the highest-priority policy whose condition matches, and otherwise the default. Defaults:
- `payroll_run`: owner;
- `profile_change`: bank fields to payroll_admin, others to hr_admin;
- every other type: manager, then hr_admin.

The resolved chain SHALL be snapshotted on the request, so editing a policy does not affect requests already submitted.

#### Scenario: Amount threshold adds a step
- **WHEN** claims policy "Over S$500" (condition `amountCents >= 50000`; steps manager, then owner) exists and a S$620.00 claim is submitted
- **THEN** the request's chain is manager, then owner

#### Scenario: Policy edit does not change in-flight request
- **WHEN** a policy gains a step while a request under it is pending
- **THEN** the pending request keeps its original chain

### Requirement: Approver resolution and fallback
When a step resolves to the requester themselves, to nobody (for example, no manager), or to a suspended or former member, the step SHALL be skipped and recorded as `skipped` with the reason. If every step is skipped, the request SHALL go to hr_admins. For `payroll_run`, and when the requester is the only hr_admin, it SHALL go to owners. If no eligible member other than the requester exists, an owner who is the requester SHALL be allowed to decide, and the decision SHALL be marked `self_approved`. A request SHALL never be approved without a recorded decision by a member.

#### Scenario: Employee without manager
- **WHEN** an employee with no manager submits leave under the default policy
- **THEN** the manager step is skipped with reason `no_manager` and the hr_admins receive the task

#### Scenario: Manager applies for own leave
- **WHEN** a department head whose manager is the owner submits leave
- **THEN** the owner receives the task, and the department head cannot approve it themselves

### Requirement: Deciding tasks
Each active step SHALL create a task for every eligible approver. The first decision closes the step and the other tasks become `superseded`. Rejection SHALL require a comment of 1 to 500 characters. Approval comments are optional. The approver SHALL see the subject summary, the requester's relevant context provided by the module (such as remaining balance or cap), the chain with its progress, and earlier comments. A decision on a task that is no longer pending SHALL fail with 409 `already_decided`.

#### Scenario: Two HR admins race
- **WHEN** two hr_admins approve the same step within a second of each other
- **THEN** one succeeds and the other receives 409 `already_decided` with who decided and when

### Requirement: Withdraw and cancel
A requester SHALL be able to withdraw a pending request. It ends `withdrawn`, open tasks become `superseded`, and approvers who had a task are notified. For an approved subject, the module SHALL decide whether cancellation is immediate or needs approval. When it needs approval, the module submits a separate `*_cancellation` request, and the original stays approved until that request is approved.

#### Scenario: Withdraw pending leave
- **WHEN** an employee withdraws a leave request awaiting their manager
- **THEN** the request is `withdrawn`, the manager's inbox item disappears, and the manager gets an in-app notice

### Requirement: Delegation
A member SHALL be able to set out-of-office delegation: a delegate member, a start date and an end date (inclusive), and optionally a set of subject types. While delegation is active, tasks for the delegator SHALL also be assigned to the delegate, and the delegator keeps theirs. A delegate SHALL NOT receive tasks for their own requests. Role-based steps SHALL delegate only to members who also hold that role. A delegate SHALL gain read access only to the subjects of tasks delegated to them, for as long as the task is open. Hr_admins SHALL be able to set delegation on behalf of any member.

#### Scenario: Delegation during leave
- **WHEN** manager M delegates to N from 1 to 5 Dec 2026 and M's report submits a claim on 2 Dec
- **THEN** both M and N have the task, and N's decision is recorded as "N on behalf of M"

### Requirement: Escalation and reassignment
Each step SHALL have escalation after N calendar days (default 3; 0 disables it). When a pending task passes its due time, the engine SHALL send a reminder to the assignees. It SHALL also add a task for the next level: the assignee's manager, or the hr_admins if the assignee has no manager or is an hr_admin. Escalation happens once per step. Owners and hr_admins SHALL be able to reassign any pending task to another eligible member, with a reason. When a requester's manager changes, open `manager` and `manager_of_manager` tasks for their requests SHALL move to the new resolution.

#### Scenario: Escalation after three days
- **WHEN** a manager has not acted on a leave task for 3 days
- **THEN** the manager gets a reminder, the hr_admins get a task marked "Escalated", and either can decide

#### Scenario: Manager change reroutes
- **WHEN** an employee's manager changes from B to D while B has their pending claim task
- **THEN** B's task becomes `superseded` and D receives the task

### Requirement: In-app notifications
The system SHALL create in-app notifications for: tasks assigned, escalated or reassigned to the member; decisions on the member's requests; withdrawals; reminders; and module events (payslip released, roster published, document shared, acknowledgement requested). Each notification SHALL have a title, a link to the subject and a read state. The top bar SHALL show the unread count. Notifications SHALL be kept for 180 days.

#### Scenario: Decision notice
- **WHEN** a manager rejects a claim
- **THEN** the requester's unread count increases by 1, and the notification links to the claim and shows the comment

### Requirement: Email notifications
When a mailer is configured, notifications SHALL also be emailed according to each member's preferences (per category; default on). Security emails (password reset, invitation, lockout, new MFA, recovery code used) SHALL always be sent. Emails SHALL go through an outbox with up to 5 attempts at increasing intervals (1, 5, 30, 120 and 720 minutes); after that the email is marked `failed` and owners see it in Settings → Notifications. Emails SHALL contain the organisation name, a short subject-neutral summary and a link. They SHALL NOT contain salary amounts, NRIC/FIN, bank details or medical details. When no mailer is configured, the app SHALL work in full with in-app notifications only, and owners SHALL see "Email is not configured" in Settings with setup instructions.

#### Scenario: SMTP outage
- **WHEN** the SMTP server refuses connections for 3 hours
- **THEN** queued emails are retried on the schedule and sent once the server recovers, and in-app notifications are unaffected

#### Scenario: No sensitive data in payslip email
- **WHEN** a payslip-released email is generated
- **THEN** its body contains no money amount and links to the payslip in the app

### Requirement: Reminders
The system SHALL generate de-duplicated reminders, one per subject per threshold:
- Work pass expiry: 90, 60, 30 and 7 days before, and on the expiry date, to hr_admins.
- Probation end: 14 days before, to the employee's manager and the hr_admins.
- Payroll cutoff: 3 days before the cutoff date in payroll settings, to payroll_admins. This source is supplied by the payroll module and stays inactive until it exists.
- Document expiry: thresholds defined by `documents`.

Reminders stop when the underlying condition is resolved, for example when a new pass is added or probation is confirmed.

#### Scenario: Work pass renewed
- **WHEN** a 30-day expiry reminder was sent and HR then adds a renewed pass
- **THEN** no 7-day or expiry-day reminder is generated for the old pass

#### Scenario: Reminder not duplicated
- **WHEN** the sweep runs 1 440 times during the day a 30-day threshold is reached
- **THEN** exactly one 30-day reminder exists for that pass

### Requirement: Scheduled sweep
The core SHALL expose an idempotent `tick(now)` that processes due escalations, reminders, the email outbox and date-triggered transitions (such as the membership becoming `former`). Concurrent ticks SHALL NOT double-process, because each claims its work with a row lock. The server SHALL call it every 60 seconds. If the app was down, the next tick SHALL catch up all work that became due in the meantime.

#### Scenario: Downtime catch-up
- **WHEN** the server was stopped for 2 days and restarts
- **THEN** the first tick sends the escalations and reminders that fell due during those days, once each

### Requirement: Home work-to-do inbox
Home SHALL list the current member's actionable items from all sources: open approval tasks (including delegated and escalated ones), checklist items assigned to their role, active reminders, organisation setup steps and payroll due. Overdue items SHALL come first, then items ordered by due date ascending, then items without a due date ordered by age. Each item SHALL show what it is, who it concerns, its due state ("Overdue 2 days", "Due 3 Dec 2026") and a primary action. Leave, claim and profile-change tasks SHALL be approvable or rejectable inline. The inbox SHALL show only items the member may act on. With nothing to do, it SHALL show "Nothing waiting for you" and SHALL NOT show placeholder statistics.

#### Scenario: Manager's Home
- **WHEN** a manager has 2 pending leave tasks (one overdue, one due in 2 days) and an onboarding checklist item due tomorrow
- **THEN** Home lists the overdue leave task first, then the item due tomorrow, then the other leave task

#### Scenario: Employee with nothing to do
- **WHEN** an employee with no tasks opens Home
- **THEN** it shows "Nothing waiting for you" plus links to apply for leave and submit a claim
