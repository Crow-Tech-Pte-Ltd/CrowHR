---
title: Members and roles
description: Invite people to Crow HR, grant owner, HR admin and payroll admin roles, suspend members and handle former employees.
---

A **member** is a person who can sign in to your organisation. Most members are linked to an employee record; some (an external accountant, for example) are not. Manage them in **Settings → Members**.

## Roles

Roles combine: one person can be both HR admin and payroll admin.

| Role | How you get it | In short |
| --- | --- | --- |
| Owner | Granted by an owner | Everything, including security settings, SSO and approving payroll runs. At least one active owner must always exist. |
| HR admin | Granted by an owner | Employee records, structure, lifecycle, approval policies. No compensation, bank details or payroll. |
| Payroll admin | Granted by an owner | Payroll runs, compensation, bank details, payslips and statutory files. |
| Manager | Automatic, while the member's employee record has at least one active direct report | Their team (direct and indirect reports), and requests routed to them. |
| Employee | Automatic, when the member is linked to an employee record | Their own records and payslips. |

The full permission matrix, generated from the code, is on [roles and permissions](/docs/roles-and-permissions/).

Rules worth knowing:

- Only owners grant or revoke owner, HR admin and payroll admin. HR admins may invite members with no assigned roles only.
- Revoking the last owner role, or suspending the last owner, fails with `409 last_owner`.
- Nobody changes their own compensation or bank details directly, even an owner or payroll admin: those go through a change request decided by someone else. When nobody else is eligible, an owner may approve their own request and the decision is marked self-approved.
- Granting or revoking roles needs a recent sign-in (within 10 minutes). If yours is older, Crow HR asks for your password (and code) again.

## Inviting people

Hiring an employee in People sends their invitation automatically (see [adding employees](/docs/people/adding-employees/)). To invite someone without an employee record, use **Invite** in Settings → Members.

- An invitation link is valid for 7 days. Resending replaces the link; revoking makes it unusable.
- The invitee sets a password or uses any enabled SSO method. An invitation link also binds a first SSO sign-in to that member, which is how Singpass identities are linked.
- **Without email configured**, the inviter gets the link to copy and send themselves. Invitations from a CSV import are sent after you confirm the import; without SMTP their links are not shown there, so resend them from Settings → Members.
- Inviting an email that already has an active membership, or linking a second live account to the same employee, fails with `409 conflict`. Former memberships do not prevent rehiring. Only owners may link an invitation to an employee who holds roles or manages people. Existing accounts with two-step verification must enter their code to accept.

## Member status

| Status | Meaning |
| --- | --- |
| Invited | Invitation sent, not accepted yet. |
| Active | Can sign in. |
| Suspended | Cannot sign in; their sessions are revoked. |
| Former | The employee's last working day has passed. The membership becomes former the day after, automatically, and keeps read-only access to their own released payslips. |

Owners can clear lockouts, reset two-step verification and sign members out everywhere (also removing their SSO links in this organisation). Only an owner, after re-authentication within 10 minutes, may create a password reset link. The target must have no assigned roles and no memberships in other organisations, because passwords are shared across organisations. With SMTP the affected member receives the link by email; otherwise the owner gets a copyable link, valid 60 minutes. The action is audited.

## Audit log

Every sign-in, role change, configuration change and change to employee or payroll data is recorded in **Settings → Audit log**, with actor, time, IP address and a field diff (sensitive fields record only that they changed). The log is append-only, with each event linked to the previous one by a SHA-256 hash chain that `crowhr admin verify-audit` checks; it is filterable and exportable to CSV.

- Owners see all events.
- HR admins see everything except security settings, SSO configuration and payroll events.
- Payroll admins see payroll, compensation and bank events.
