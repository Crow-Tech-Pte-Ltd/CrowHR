---
title: Privacy and PDPA for operators
description: Guidance for companies that run Crow HR on how the Personal Data Protection Act applies to the employee data they keep in it.
---

:::note
This is practical guidance, not legal advice. For your obligations under the Personal Data Protection Act 2012 (PDPA), read the PDPC's guidance and get advice where you need it.
:::

## Who is responsible

When you self-host Crow HR, **your company** collects, uses and keeps your employees' personal data, so your company is the organisation responsible for it under the PDPA. Crow Tech provides software and does not receive, host or process your data, so it is not your data intermediary. A cloud or hosting provider you use may be one; check your contract with them.

## What Crow HR stores

| Data | Why | Protection |
| --- | --- | --- |
| Names, contact details, emergency contacts | Employment administration | Role-based access |
| NRIC/FIN, passport and work pass numbers | CPF, IR8A, work-pass compliance | Encrypted at rest, masked, reveal audited |
| Date of birth, residency, PR start date | CPF rates and age bands | Personal-details permission |
| Race and religion | Self-help group fund contributions | Personal-details permission |
| Bank account | Salary payment | Encrypted at rest, masked to last 4 digits |
| Pay, allowances, payslips | Payroll | Owners, payroll admins and the employee only |
| Sign-in data (sessions, IP addresses, user agents) | Security | Audit log, session list |
| Medical certificates, sick leave and medical claim receipts, medical documents | Leave, claims and records | Only owners, HR admins, the employee and the current approver |
| Children's names, dates of birth and citizenship | Parental and childcare leave | Leave permissions |
| Clock-in times, IP address and, if you turn it on, location | Attendance | Employee, their manager and HR; location is off by default and needs a [PDPA notice](/docs/attendance/attendance/#location-and-office-network-optional) |

NRIC numbers: the PDPC's advisory guidelines limit collecting, using and disclosing NRIC numbers to cases required by law or where they are necessary to verify identity to a high degree of fidelity. Employment and CPF, tax and work-pass obligations are such cases. Crow HR masks NRIC/FIN by default and logs every reveal; do not put NRIC numbers anywhere else in the app (notes, free-text fields) or in exports you do not need.

## Practical steps

- **Purpose and consent**: tell employees what HR data you keep and why (your employee privacy notice). Collect race and religion only for the SHG fund, as the app does.
- **Access**: give owner, HR admin and payroll admin roles only to people who need them. Managers see the directory and their team's employment records and emergency contacts, not pay, bank or personal details. Review **Settings → Members** when people change jobs.
- **Protection**: run Crow HR over HTTPS, keep two-step verification on for privileged roles, set `BACKUP_PASSPHRASE`, and store backups somewhere access-controlled. Exported CSV, XLSX, bank and IR8A files contain personal data; delete them when done.
- **Accuracy and correction**: employees can see their own records and update contact details directly, and request corrections to legal and bank details through change requests.
- **Access requests**: an employee's data is on their profile, payslips and the audit log; owners see all of it (HR admins the profile, payroll admins the pay records) and can export the employee list for a PDPA access request.
- **Retention**: keep records as long as the law and your purposes need. Crow HR keeps former employees' records and history (rehires depend on it) and does not erase anything automatically; the [document retention review](/docs/documents/documents/#retention-review) flags ex-employees' documents for HR to keep or delete. Notifications are deleted after 180 days; the audit log is append-only by design.
- **Breaches**: if you suspect a data breach, assess it and, where the PDPA requires, notify the PDPC and affected employees within the required time. The audit log (who viewed or changed what, from which IP) helps with the assessment.
- **Transfers**: if your server or backups are outside Singapore, the PDPA's transfer limitation obligation applies.

## What Crow HR does not send anywhere

The app does not send employee data to Crow Tech or to analytics or advertising services. It contacts only what you configure: your SMTP server (emails contain no salary, NRIC/FIN, bank or medical details), your identity provider during sign-in and, if you set it up, your own error-monitoring service ([what it receives](/docs/self-hosting/configuration/#optional-error-monitoring)).
