---
title: Setup wizard
description: Create your organisation and its owner on a fresh Crow HR server with the one-time setup code.
---

A new server has no organisation and nobody who can sign in. The setup wizard creates both. Until it is done, every page redirects to `/setup`, and the API answers `409 setup_required`.

## Before you start

You need the one-time setup code from the server log:

```sh
docker compose logs app | grep -A3 'SETUP CODE'
```

The code is 16 characters from an alphabet without look-alikes (no `0`/`O`, `1`/`I`), shown in four groups such as `ACDE-FGHJ-KMNP-QRTU`. It changes on every restart. `docker compose exec app crowhr setup-code` prints a fresh one and invalidates the old. Only a hash of the code is stored.

## The three steps

1. **Setup code.** Paste the code from the log. Five wrong codes from one IP address block that address for 15 minutes.
2. **Company's registered name**, as on ACRA BizFile (for example `Kampong Kopi Pte. Ltd.`). The UEN, CPF submission number and address come later in [company and structure](/docs/admin/company-and-structure/).
3. **The owner account**: your name, work email and a password. Passwords are 12 to 128 characters, must not be on the common-password list and must not equal the email. There are no character-class rules: a few random words work well.

The organisation and the owner are created in one transaction, the code stops working, `setup.completed` is written to the audit log and you are signed in. `/setup` then answers 404.

## Protect the owner account

The last screen offers two-step verification. Owners, HR admins and payroll admins must enrol by default ([MFA policy](/docs/admin/mfa/)), with a 7-day grace period, so it is easiest to do it now with an authenticator app. You can also choose **Later, go to Home**.

## After setup

Home shows **Finish setting up** until the company profile, at least one department, the default work schedule and at least one employee exist. Each step links to the screen that completes it, and its tick comes from the data, not from a checkbox.

Recommended order:

1. [Company profile](/docs/admin/company-and-structure/#company-profile): UEN, CSN and address (payroll is blocked without them).
2. [Structure and work schedules](/docs/admin/company-and-structure/#structure).
3. [Invite your HR and payroll admins](/docs/admin/members-and-roles/).
4. [Add](/docs/people/adding-employees/) or [import](/docs/people/importing/) employees.
5. [Payroll settings](/docs/payroll/settings/).

For a scripted install, set `SETUP_CODE` in `.env` to a fixed code (see the [configuration reference](/docs/self-hosting/configuration/#other)).
