---
title: Project status
description: Which Crow HR modules are built and tested, which are partly done, and which are planned but not built yet.
---

Status as of 31 October 2026. Requirements and task lists live in `openspec/changes/` in the repository; a module is listed as built only when its tasks are done and tested.

## Built

| Area | What works | Guide |
| --- | --- | --- |
| Self-hosting | Docker Compose install, setup wizard, automatic migrations with a lock, scheduled and manual backups (optionally encrypted), restore, `crowhr` CLI, **Settings → System** | [Install](/docs/self-hosting/install/) |
| Sign-in and security | Email and password, TOTP two-step verification and recovery codes, MFA policy for privileged roles, sessions and device list, Google Workspace, Microsoft Entra ID and generic OpenID Connect SSO, audit log with a tamper-evident hash chain | [Sign-in methods](/docs/admin/sign-in-methods/) |
| Members and roles | Invitations, owner / HR admin / payroll admin roles, derived manager and employee roles, permission matrix enforced on the server | [Roles and permissions](/docs/roles-and-permissions/) |
| Company and people | Company profile, structure, work schedules, employee records with history, CSV import, export, lifecycle events, work passes, checklists, self-service change requests | [Adding employees](/docs/people/adding-employees/) |
| Approvals and notifications | Approval policies, delegation, escalation, Home work-to-do list, inbox, in-app and email notifications, reminders | [Approvals](/docs/approvals/approvals/) |
| Payroll | Monthly, off-cycle and adjustment runs; CPF, SHG, SDL and FWL estimate; review with CPF working; approval; payslips (web and PDF) with a notification on release; CPF EZPay file; ISO 20022 bank file; IR8A export | [Running payroll](/docs/payroll/running-payroll/) |
| Documents | Per-employee documents in categories with access rules, versions, expiry reminders, soft delete and owner purge; HR letters and KETs from templates; acknowledgements; employment letter requests; retention review flags | [Employee documents](/docs/documents/documents/) |
| Reports | Headcount, headcount over time, turnover, work pass expiry, leave taken and balances with liability, attendance exceptions, claims, payroll cost; CSV and XLSX export | [Reports](/docs/reports/running-reports/) |

## Partly done

| Item | State |
| --- | --- |
| Singpass login | Implemented to the published FAPI 2.0 profile and tested against a mock identity provider only. Not tested against real Singpass, and the button does not include the official Singpass logo. See the [Singpass guide](/docs/admin/sso/singpass/). |
| Payroll inputs | Overtime, hours and no-pay leave are entered by hand per run until attendance and leave exist. Claims reimbursement is not wired. |
| Docker images | Built from the checkout; nothing is published to a registry yet. |
| CI | The workflow exists but has not run on a hosted runner yet. |

## Not built yet

These modules appear in the app's navigation as empty placeholders. Each has a short page explaining the plan:

- [Leave](/docs/coming-soon/leave/)
- [Attendance and overtime](/docs/coming-soon/attendance/)
- [Claims](/docs/coming-soon/claims/)
- [Scheduling](/docs/coming-soon/scheduling/)
- [Public demo](/docs/coming-soon/demo/)
- [Mobile apps](/docs/coming-soon/mobile-apps/)

The [limitations](/docs/payroll/limitations/) page lists the known gaps inside the built modules.
