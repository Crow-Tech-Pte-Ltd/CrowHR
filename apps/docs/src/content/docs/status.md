---
title: Project status
description: Which Crow HR modules are built and tested, which are partly done or only reachable through the API, and what is not built.
---

This page describes Crow HR 1.0.0. A module is listed as built when it works end to end and is tested. Crow HR has not yet been used for a real company's payroll, so check every result before you pay or file it.

## Built

| Area | What works | Guide |
| --- | --- | --- |
| Self-hosting | Docker Compose install with the published multi-arch image (amd64 and arm64), setup wizard, automatic migrations with a lock, scheduled and manual backups (encrypted when `BACKUP_PASSPHRASE` is set, which is strongly recommended), restore, `crowhr` CLI, **Settings → System** | [Install](/docs/self-hosting/install/) |
| Sign-in and security | Email and password, TOTP two-step verification and recovery codes, MFA policy for privileged roles, sessions and device list, security notices, Google Workspace, Microsoft Entra ID and generic OpenID Connect SSO, an append-only audit log with hash chaining | [Sign-in methods](/docs/admin/sign-in-methods/) |
| Members and roles | Invitations, owner / HR admin / payroll admin roles, derived manager and employee roles, permission matrix enforced on the server | [Roles and permissions](/docs/roles-and-permissions/) |
| Company and people | Company profile, structure, work schedules, employee records with history, CSV import, export, lifecycle events, work passes, checklists, self-service change requests | [Adding employees](/docs/people/adding-employees/) |
| Approvals and notifications | Approval policies, delegation, escalation, Home work-to-do list, inbox, in-app and email notifications, reminders | [Approvals](/docs/approvals/approvals/) |
| Leave | Statutory and Government-paid leave types, policies with the statutory floor, accrual and carry-forward, applications with half days and documents, approval and cancellation, team calendar, public holidays in lieu, part-timers in hours, encashment, Government-paid leave report, year-end close | [Leave](/docs/leave/leave/) |
| Attendance and overtime | Clock in and out with an offline queue, optional location and office-network checks, timesheets and corrections, optional timesheet approval that locks approved periods, lateness rules, overtime claims with the Part 4 test and the 72-hour warning | [Attendance](/docs/attendance/attendance/) |
| Claims | Claim types with caps and eligibility, multi-line claims with receipts, foreign currency at manual rates, approvals, reimbursement through payroll or recorded as paid outside it | [Claims](/docs/claims/claims/) |
| Scheduling | Shift templates, weekly rosters with a keyboard-driven grid, conflicts and hour warnings, publishing with notifications, swaps and open shifts | [Scheduling](/docs/scheduling/scheduling/) |
| Payroll | Monthly, off-cycle and adjustment runs; CPF, SHG, SDL and FWL estimate; no-pay leave, overtime, scheduled days, holiday pay, leave encashment and claims fed from the other modules; review with CPF working; approval; payslips (web and PDF) with a notification on release; CPF EZPay file; ISO 20022 bank file; IR8A export with Appendix 8A (benefits-in-kind) and 8B (share gains) | [Running payroll](/docs/payroll/running-payroll/) |
| Documents | Per-employee documents in categories with access rules, versions, expiry reminders, soft delete; HR letters and KETs from templates; acknowledgements; employment letter requests; retention review flags | [Employee documents](/docs/documents/documents/) |
| Reports | Headcount, headcount over time, turnover, work pass expiry, leave taken and balances with liability, attendance exceptions, scheduled hours, claims, payroll cost; CSV and XLSX export | [Reports](/docs/reports/running-reports/) |
| Mobile apps | Native Android and iPhone/iPad apps for payslips, leave, clocking in, claims, schedules and approvals, connecting only to your own server. The Android app is on Google Play; the iPhone and iPad app is in App Store review. | [Mobile apps](/docs/mobile-apps/) |
| In-browser demo | The real app and API running in the visitor's browser with a fictional company, personas and a resettable local database, at [hr.crow.sg](https://hr.crow.sg/) | [Demo](/docs/demo/) |

## Partly done

| Item | State |
| --- | --- |
| Singpass login | Implemented to Singpass's FAPI 2.0 login profile and tested against **Singpass staging**; not yet against Singpass production. The official Singpass logo for the button has to be added by whoever runs the server, because it can't ship in the repository. See the [Singpass guide](/docs/admin/sso/singpass/). |
| Virus scanning | Receipts, documents and medical certificates are scanned by your own ClamAV when you set `CLAMAV_HOST` ([configuration](/docs/self-hosting/configuration/#optional-virus-scanning)). No scanner ships with Crow HR, so without one uploads are stored unscanned. |
| Payroll inputs from other modules | Rest-day and public-holiday work premiums are entered by hand, and overtime fed from attendance for staff outside Part 4 or paid by the hour needs its contractual amount entered on the run. See [payroll limitations](/docs/payroll/limitations/#payroll-inputs). |
| Features without a screen | These work through the [API](/docs/api/) but have no control in the web app yet: adding allowance types and recurring allowances, per-schedule start times for lateness, leave balance adjustments, editing a child's record, and filing overtime for another employee. |

## Not built

- Direct submission to CPF, IRAS or banks: Crow HR produces the CPF EZPay file, the ISO 20022 bank file and the IR8A export for you to upload.
- API keys or service accounts for server-to-server integrations.
- The other integrations listed under [not available](/docs/integrations/#not-available).

The [limitations](/docs/payroll/limitations/) page lists the known gaps inside the built modules, and each module's guide ends with its own.
