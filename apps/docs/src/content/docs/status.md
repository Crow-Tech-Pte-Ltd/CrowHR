---
title: Project status
description: What Crow HR supports and which workflows still need manual work or external services.
---

This page describes the current Crow HR source. See the [release notes](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/releases) for the features in your installed version.

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
| Mobile apps | Native Android and iPhone/iPad apps for payslips, leave, clocking in, claims, schedules and approvals, connecting only to your own server. The Android app is on Google Play and the iPhone and iPad app on the App Store. | [Mobile apps](/docs/mobile-apps/) |
| In-browser demo | The real app and API running in the visitor's browser with a fictional company, personas and a resettable local database, at [hr.crow.sg](https://hr.crow.sg/) | [Demo](/docs/demo/) |

## Partly done

| Item | State |
| --- | --- |
| Singpass login | Implements the Singpass FAPI 2.0 login profile and has passed an end-to-end Singpass staging test. Crow Tech has an active production registration for the public demo. The shared app for Crow Tech-hosted employee sign-in is pending staging verification and production approval. Self-hosted installations use their own registration and add the official Singpass button logo. See the [Singpass guide](/docs/admin/sso/singpass/). |
| Virus scanning | Receipts, documents and medical certificates are scanned by your own ClamAV when you set `CLAMAV_HOST` ([configuration](/docs/self-hosting/configuration/#optional-virus-scanning)). No scanner ships with Crow HR, so without one uploads are stored unscanned. |
| Payroll inputs from other modules | Approved timesheets can feed regular hourly work. Exceptions such as incomplete approvals, overtime or special-day work may require manual hours. Rest-day and public-holiday work premiums and some overtime amounts are entered by hand. See [payroll limitations](/docs/payroll/limitations/#payroll-inputs). |

## Not built

- Direct submission to CPF, IRAS or banks: Crow HR produces the CPF EZPay file, the ISO 20022 bank file and the IR8A export for you to upload.
- API keys or service accounts for server-to-server integrations.
- The other integrations listed under [not available](/docs/integrations/#not-available).

The [limitations](/docs/payroll/limitations/) page lists the known gaps inside the built modules, and each module's guide ends with its own.
