---
title: Introduction
description: What Crow HR is, who it is for, how it is licensed and what it means that you host it and own the data.
---

Crow HR is an HR and payroll platform for small and medium companies in Singapore. It is made by Crow Tech Pte. Ltd., released under the MIT licence, and designed to run on a server you control.

## Who it is for

A Singapore company with a handful to a few hundred employees and one person who is comfortable running a Docker container. That person does not need to be a DevOps engineer: the install is three steps, backups and database upgrades run on their own, and every startup error says which setting to fix.

Typical users inside the company:

| Who | What they do in Crow HR |
| --- | --- |
| Owner | Sets up the company and sign-in, grants roles, approves payroll runs. |
| HR admin | Keeps employee records, imports staff, handles lifecycle events and change requests, sets leave, attendance and claim policies, issues letters and documents. |
| Payroll admin | Runs payroll, reviews the CPF working, releases payslips, pays claims and downloads the statutory files. |
| Manager | Sees their team, builds rosters, corrects timesheets, approves leave, overtime, claims and swaps routed to them. |
| Employee | Signs in to see their own profile, payslips and documents, applies for leave, clocks in, files claims, sees their shifts and asks for changes to their details. |

The exact rights of each role are on the [roles and permissions](/docs/roles-and-permissions/) page.

## Free and open source

The code is MIT-licensed: you may use, change and redistribute it, including commercially, without paying anyone. There is no paid tier hidden behind the open version and no feature flag that phones home. Contributions are welcome; see [contributing](/docs/developers/contributing/).

### Licence

Crow HR is © Crow Tech Pte. Ltd. and contributors, under the [MIT licence](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/blob/main/LICENSE). It ships with open-source packages under their own permissive licences (MIT, Apache-2.0, ISC, BSD and similar; no GPL-family licences) and with the Azeret Mono, Ubuntu and Noto fonts (SIL Open Font License 1.1 and Ubuntu Font Licence 1.0). Every package, version and licence is listed in [THIRD-PARTY-NOTICES.md](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/blob/main/THIRD-PARTY-NOTICES.md), which is also in the Docker image at `/app/THIRD-PARTY-NOTICES.md` next to `/app/LICENSE`.

## Self-hosted: you own the data

Crow HR runs as one app container and a PostgreSQL 17 database on your machine, in your office or with the cloud provider you choose. Crow Tech does not run a hosted service for it and receives nothing from your install:

- no analytics, telemetry or usage reporting;
- no calls to third-party services unless you configure them (your SMTP server, your identity provider);
- fonts, icons and the web app are served from your server, not from a CDN.

Sensitive identifiers (NRIC/FIN, passport and work pass numbers, bank account numbers) and secrets (two-step verification, SSO) are encrypted in the database with a key that stays in your data volume and your backups. Your company remains the organisation responsible for the personal data under the PDPA; see [privacy and PDPA](/docs/help/privacy-pdpa/).

## What it does today

Crow HR is early software. Built and tested today:

- sign-in with password and two-step verification, Google Workspace, Microsoft Entra ID and generic OpenID Connect; Singpass is implemented but not yet tested against real Singpass;
- members, roles and a server-enforced permission matrix, with an append-only audit log;
- company profile, departments, teams, locations, cost centres and work schedules;
- employee records with effective-dated history, CSV import (including year-to-date opening balances), lifecycle events, work passes and self-service change requests;
- an approvals engine with policies, delegation and escalation, in-app and email notifications, and a Home page that lists work to do;
- [leave](/docs/leave/leave/) with the statutory and Government-paid types, policies, a team calendar and a report of Government-paid leave to claim;
- [attendance and overtime](/docs/attendance/attendance/): clocking in (also offline), timesheets and overtime claims checked against Part 4 of the Employment Act;
- [expense claims](/docs/claims/claims/) with receipts, caps and foreign currency, reimbursed through payroll;
- [shift scheduling](/docs/scheduling/scheduling/) with weekly rosters, hour warnings and shift swaps;
- monthly payroll with CPF, SHG, SDL and an FWL estimate, fed by approved leave, overtime, rosters and claims, with itemised payslips, the CPF EZPay file, a generic ISO 20022 bank file and an IR8A export;
- [employee documents](/docs/documents/documents/), HR letters and KETs, and [reports](/docs/reports/running-reports/) with CSV and Excel export;
- self-hosting with automatic migrations, scheduled backups (encrypted when you set `BACKUP_PASSPHRASE`, which you should) and a `crowhr` CLI.

An [in-browser demo](/docs/demo/) runs at [hr.crow.sg](https://hr.crow.sg/), and native [iOS and Android apps](/docs/coming-soon/mobile-apps/) are built but not in the app stores yet. The [project status](/docs/status/) page lists what is built and what is not.

## Not legal advice

Crow HR implements Singapore's statutory rules from cited official sources and records how they were checked (see [how we verify statutory calculations](/docs/payroll/verification/)). It is not endorsed or approved by CPF Board, IRAS or MOM, and it does not replace your own judgement or professional advice. The [limitations](/docs/payroll/limitations/) page lists what you need to check yourself.
