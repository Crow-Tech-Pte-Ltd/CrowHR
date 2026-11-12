---
title: Notifications and reminders
description: In-app and email notifications in Crow HR, what reminders are sent and what emails never contain.
---

## In the app

The bell at the top right shows unread notifications. You are notified when:

- a task is assigned, escalated or reassigned to you;
- someone decides or withdraws one of your requests;
- your payslips are released, or HR asks you to read and acknowledge a document;
- a reminder is due (below);
- something happens to your account's security, such as a sign-in from a new browser ([security notices](#security-notices)).

Each notification links to what it is about. Notifications are kept for 180 days.

## By email

Email is optional. When `SMTP_URL` and `MAIL_FROM` are set ([configuration](/docs/self-hosting/configuration/#email)), notifications are also emailed. Each person chooses which categories to receive in **Settings → Notifications** (all on by default).

- Emails carry the organisation name, a short summary and a link. They **never** contain salary or other amounts, NRIC/FIN, bank or medical details.
- They go through an outbox: a failed send is retried after 1, 5, 30, 120 and 720 minutes, then marked failed. Owners see failed emails and the SMTP status in Settings → Notifications.
- Without SMTP, everything works in the app, and invitation and password-reset links are shown to copy.

Invitation and password-reset emails are sent directly rather than through the outbox, because their links carry one-time tokens that Crow HR never stores; they are not retried. If one doesn't arrive, resend the invitation, or an owner creates a reset link to hand over.

## Security notices

Security notices are in the **Security** category: they always appear in the app, with or without email, and are always emailed when SMTP is set (you can't turn them off). Each one says what happened and what to do if it wasn't you, and links to **My sessions**. You get one when:

| Notice | Sent to |
| --- | --- |
| Someone signs in from a browser that hasn't been used with your account before (not your very first sign-in) | You |
| The mobile app signs in on a new device, or an app session is ended because an old sign-in token was reused | You |
| Your password is changed or reset, or an owner creates a reset link for you | You |
| Sign-in from new devices is paused after many wrong passwords, or two-step verification is paused after wrong codes | You |
| Two-step verification is turned on or off, or an owner resets it; a recovery code is used | You |
| A single sign-on method is linked to or unlinked from your account | You |
| Sign-in settings change: password sign-in on or off, who must use two-step verification, session timeouts, single sign-on methods added, changed or removed | Every owner, including the one who made the change |
| Someone joins through single sign-on automatic sign-up (JIT) | HR admins (owners if there are none) |

Notices never contain passwords, codes, IP addresses or other personal details. Every one of these events is also in the [audit log](/docs/admin/members-and-roles/#audit-log).

## Reminders

Reminders are created once per subject and threshold, and stop when the condition is resolved:

| Reminder | When | To |
| --- | --- | --- |
| Work pass expiry | 90, 60, 30 and 7 days before, and on the day | HR admins |
| Probation ending | 14 days before | The employee's manager and HR admins |
| Payroll cutoff | 3 days before the cutoff day in payroll settings (or the pay day), until the month's regular run is approved (a cutoff on the 1st to 3rd is reminded at the end of the month before) | Payroll admins |
| Backups | Last successful backup more than 48 hours old, or scheduled backups disabled without `BACKUP_PASSPHRASE` (on Home) | Owners |
| Document expiry | 30 and 7 days before, and on the day | HR admins, and the employee when the category is visible to them |
| Acknowledgement | 3 and 7 days after HR asked, while not yet acknowledged | The employee |

## Home

Home lists your actionable items from every source: approval tasks (including delegated and escalated ones), checklist items for your role, reminders, organisation setup steps and payroll due. With nothing to do it says "Nothing waiting for you". It never shows placeholder statistics.

## Not available

Notification emails use fixed wording and do not carry the company logo.
