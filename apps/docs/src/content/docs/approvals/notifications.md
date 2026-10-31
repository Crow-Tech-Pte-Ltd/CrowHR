---
title: Notifications and reminders
description: In-app and email notifications in Crow HR, what reminders are sent and what emails never contain.
---

## In the app

The bell at the top right shows unread notifications. You are notified when:

- a task is assigned, escalated or reassigned to you;
- someone decides or withdraws one of your requests;
- your payslips are released, or HR asks you to read and acknowledge a document;
- a reminder is due (below).

Each notification links to what it is about. Notifications are kept for 180 days.

## By email

Email is optional. When `SMTP_URL` and `MAIL_FROM` are set ([configuration](/docs/self-hosting/configuration/#email)), notifications are also emailed. Each person chooses which categories to receive in **Settings → Notifications** (all on by default).

- Emails carry the organisation name, a short summary and a link. They **never** contain salary or other amounts, NRIC/FIN, bank or medical details.
- They go through an outbox: a failed send is retried after 1, 5, 30, 120 and 720 minutes, then marked failed. Owners see failed emails and the SMTP status in Settings → Notifications.
- Without SMTP, everything works in the app, and invitation and password-reset links are shown to copy.

Invitation and password-reset emails are always sent when email is configured, but currently directly rather than through the outbox, so they are not retried.

## Reminders

Reminders are created once per subject and threshold, and stop when the condition is resolved:

| Reminder | When | To |
| --- | --- | --- |
| Work pass expiry | 90, 60, 30 and 7 days before, and on the day | HR admins |
| Probation ending | 14 days before | The employee's manager and HR admins |
| Payroll cutoff | 3 days before the cutoff day in payroll settings (or the pay day), until the month's regular run is approved | Payroll admins |
| Backups | Last successful scheduled backup more than 48 hours old (on Home) | Owners |
| Document expiry | 30 and 7 days before, and on the day | HR admins, and the employee when the category is visible to them |
| Acknowledgement | 3 and 7 days after HR asked, while not yet acknowledged | The employee |

## Home

Home lists your actionable items from every source: approval tasks (including delegated and escalated ones), checklist items for your role, reminders, organisation setup steps and payroll due. With nothing to do it says "Nothing waiting for you". It never shows placeholder statistics.

## Not available yet

- Notification email templates are fixed in code and do not carry the company logo.
- Notifications for "sign-in attempts blocked", "new MFA method" and "recovery code used" are not sent yet.
