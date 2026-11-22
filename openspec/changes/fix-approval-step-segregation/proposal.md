## Why
A member who could decide two steps of the same request approved both: a manager who is also an HR admin approved a claim's manager step and then its HR step, so one person's judgement passed as two. Segregation of duties needs a different person on every step.

## What Changes
- **A later step never goes to an earlier step's approver** (as assignee or as a delegate): not by its rule, out-of-office cover, escalation or reassignment, and a decision by them is refused with 403 `forbidden` on every path (single, bulk, Home inline). The eligibility rule (`decideBlocker`) takes the step's position.
- **Where the step goes instead**: when only earlier approvers matched its rule, to eligible HR admins, then owners, who haven't approved the request (owners only for a role step, a payroll run or a bank change).
- **No deadlock**: when nobody else may decide the step, the earlier approver decides it too. The task is marked `repeat_approval`, the decision's `approval.decided` audit event carries `repeatApproval: true`, and the request detail shows "also approved an earlier step: no one else could decide". This mirrors the existing `self_approved` fallback for a sole owner.
- Migration `0022_approval_repeat_approval`: the `approval_tasks.repeat_approval` column, and in-flight requests whose later-step task already sits with its earlier approver are marked when nobody else holds that step, so nothing waiting at the upgrade gets stuck.
- API: `repeatApproval` on the tasks in `GET /api/v1/approvals/requests/{id}` (additive).

## Capabilities
### Modified Capabilities
- `workflows`: approver resolution and fallback.

## Non-goals
- Moving in-flight repeat tasks to owners at the upgrade.
- Barring the requester's delegator, or anyone who only held an earlier task without deciding it.
- Showing the repeat-approval mark in the mobile apps (they don't show `selfApproved` either).

## Impact
`packages/core` workflows (engine, escalation, inbox, views, schema, migration); `apps/web` request chain; approvals and roles docs, limitations.
