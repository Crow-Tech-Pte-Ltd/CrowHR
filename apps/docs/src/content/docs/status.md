---
title: Project status
description: Which Crow HR modules are built and tested, which are partly done, and what is not built yet.
---

Status as of 10 November 2026. Requirements and task lists live in `openspec/changes/` in the repository; a module is listed as built only when its tasks are done and tested. Crow HR has not been used for a real company's payroll yet.

## Built

| Area | What works | Guide |
| --- | --- | --- |
| Self-hosting | Docker Compose install, setup wizard, automatic migrations with a lock, scheduled and manual backups (encrypted when `BACKUP_PASSPHRASE` is set, which is strongly recommended), restore, `crowhr` CLI, **Settings → System** | [Install](/docs/self-hosting/install/) |
| Sign-in and security | Email and password, TOTP two-step verification and recovery codes, MFA policy for privileged roles, sessions and device list, Google Workspace, Microsoft Entra ID and generic OpenID Connect SSO, an append-only audit log with hash chaining | [Sign-in methods](/docs/admin/sign-in-methods/) |
| Members and roles | Invitations, owner / HR admin / payroll admin roles, derived manager and employee roles, permission matrix enforced on the server | [Roles and permissions](/docs/roles-and-permissions/) |
| Company and people | Company profile, structure, work schedules, employee records with history, CSV import, export, lifecycle events, work passes, checklists, self-service change requests | [Adding employees](/docs/people/adding-employees/) |
| Approvals and notifications | Approval policies, delegation, escalation, Home work-to-do list, inbox, in-app and email notifications, reminders | [Approvals](/docs/approvals/approvals/) |
| Leave | Statutory and Government-paid leave types, policies with the statutory floor, accrual and carry-forward, applications with half days and documents, approval and cancellation, team calendar, public holidays in lieu, part-timers in hours, Government-paid leave report, year-end close | [Leave](/docs/leave/leave/) |
| Attendance and overtime | Clock in and out with an offline queue, optional location and office-network checks, timesheets and corrections, lateness rules, overtime claims with the Part 4 test and the 72-hour warning | [Attendance](/docs/attendance/attendance/) |
| Claims | Claim types with caps and eligibility, multi-line claims with receipts, foreign currency at manual rates, approvals, reimbursement through payroll or recorded as paid outside it | [Claims](/docs/claims/claims/) |
| Scheduling | Shift templates, weekly rosters with a keyboard-driven grid, conflicts and hour warnings, publishing with notifications, swaps and open shifts | [Scheduling](/docs/scheduling/scheduling/) |
| Payroll | Monthly, off-cycle and adjustment runs; CPF, SHG, SDL and FWL estimate; no-pay leave, overtime, scheduled days and claims fed from the other modules; review with CPF working; approval; payslips (web and PDF) with a notification on release; CPF EZPay file; ISO 20022 bank file; IR8A export | [Running payroll](/docs/payroll/running-payroll/) |
| Documents | Per-employee documents in categories with access rules, versions, expiry reminders, soft delete; HR letters and KETs from templates; acknowledgements; employment letter requests; retention review flags | [Employee documents](/docs/documents/documents/) |
| Reports | Headcount, headcount over time, turnover, work pass expiry, leave taken and balances with liability, attendance exceptions, scheduled hours, claims, payroll cost; CSV and XLSX export | [Reports](/docs/reports/running-reports/) |
| In-browser demo | The real app and API running in the visitor's browser with a fictional company, personas and a resettable local database, live at [hr.crow.sg](https://hr.crow.sg/) | [Demo](/docs/demo/) |

## Partly done

| Item | State |
| --- | --- |
| Singpass login | Implemented to the published FAPI 2.0 profile. A test sign-in against **Singpass staging** passed on 9 Nov 2026; production Singpass has not been tried yet (the public demo's production Singpass app was submitted on 9 Nov 2026 and is under review), and the official Singpass logo for the button has to be added by whoever runs the server (it can't ship in the repository). See the [Singpass guide](/docs/admin/sso/singpass/). |
| Virus scanning | A scanner hook exists for receipts and documents, but no scanner ships with Crow HR, so uploads are stored unscanned. |
| Payroll inputs from other modules | Fed overtime can't be priced for staff outside Part 4 or paid by the hour; rest-day and public-holiday work premiums need separate inputs. Approved leave encashment feeds payroll at the gross rate; active allowances need classification through the payroll settings API. See [payroll limitations](/docs/payroll/limitations/#payroll-inputs). |
| Docker images | Built from the checkout; nothing is published to a registry yet. |
| Mobile apps | Native [iOS and Android apps](/docs/coming-soon/mobile-apps/) are built and tested against a real server. Only internal test builds exist (TestFlight internal testing, a Google Play internal draft); they are not in the App Store or Google Play. |

## Not built yet

- Direct submission to CPF, IRAS or banks: Crow HR produces the CPF EZPay file, the ISO 20022 bank file and the IR8A export for you to upload.

The [limitations](/docs/payroll/limitations/) page lists the known gaps inside the built modules, and each module's guide ends with its own.
