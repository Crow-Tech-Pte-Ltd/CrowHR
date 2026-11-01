---
title: Troubleshooting
description: Fixes for common Crow HR problems with sign-in, single sign-on, invitations, people imports and payroll runs.
---

For problems with the server itself (startup errors, setup code, backups, proxies), see [troubleshooting the server](/docs/self-hosting/troubleshooting/).

## Signing in

| Symptom | What to do |
| --- | --- |
| Sign-in keeps failing for someone who is sure of their password | After 10 failed attempts in 15 minutes an account is locked for 15 minutes, with the same message. Wait, or an owner clears the lockout in Settings → Members. |
| Everyone in the office is rate-limited at once | The server sees one IP for everyone because it does not trust your proxy. Set `TRUSTED_PROXIES` ([reverse proxy](/docs/self-hosting/reverse-proxy/)). |
| "You were signed out after a period of inactivity" | The idle timeout (default 30 minutes) passed. Owners can change it in Settings → Security. |
| Signed out immediately after signing in | `PUBLIC_URL` does not match the address in the browser, or it is `https` while the browser uses `http`. |
| Every page says to set up two-step verification | Your role requires it and the 7-day grace period is over. Enrol, or ask an owner to change the [MFA policy](/docs/admin/mfa/). |
| "Password sign-in is disabled" | Your organisation uses single sign-on; use the provider's button. Owners can always use their password. |
| Asked for the password again before saving | Sensitive actions need a sign-in within the last 10 minutes. This is expected. |
| The owner lost their password and authenticator | On the server: `crowhr reset-owner-mfa --email <owner>` ([CLI](/docs/self-hosting/cli/#reset-owner-mfa)). |

## Single sign-on

| Symptom | What to do |
| --- | --- |
| "Sign-in with Google/Microsoft/… failed" | The reason is in Settings → Audit log, event `auth.sso_failed`: `state_mismatch` (expired or replayed attempt, try again), `hd_mismatch`, `tid_mismatch`, `email_not_verified`, `not_provisioned`. |
| "Your account has not been set up in …" | No member with that email. Invite them, or have them use the invitation link. |
| The provider's button is missing on the sign-in page | It is switched off, or not fully configured (Singpass without a client ID or keys). Test it and switch it on in Settings → Security. |
| Redirect URI mismatch at the provider | Register exactly the URI Crow HR showed; it is built from `PUBLIC_URL`. |

## Invitations and email

| Symptom | What to do |
| --- | --- |
| Invitation emails do not arrive | Without `SMTP_URL`, nothing is emailed: copy the link from Settings → Members. With SMTP, check Settings → Notifications for failures and your provider's SPF/DKIM for `MAIL_FROM`. |
| "Invitation expired" | Links last 7 days. Resend from Settings → Members; the old link stops working. |
| Imported employees got no invitation link | Without SMTP, import invitations are not shown. Resend them from Settings → Members. |

## People

| Symptom | What to do |
| --- | --- |
| "This NRIC's check letter does not match" | Check the last letter against the card. FINs starting with M are supported. |
| `duplicate_id_number` on a new hire | The person worked here before. Use **Rehire** to keep their history. |
| Cannot archive a department | Current employees use it; the message links to them. Move them first. |
| A foreigner cannot be hired | Add a work pass valid on the start date first. |
| A salary change is refused for a past month | That month's payroll is approved or paid. Mark the change retroactive; the next run flags the back pay. |

## Payroll

| Issue code or symptom | What to do |
| --- | --- |
| Run cannot be submitted: company profile | Add UEN, CSN and address in Settings → Company. |
| `409` "recompute the run" on submit | Records or items changed after computing. Recompute, review, submit again. |
| `OT_NOT_STATUTORY` | The employee is not covered by Part 4 of the Employment Act (basic pay above the limit, or flagged as a manager or executive on the Job tab). Enter the contractual overtime amount. |
| `YTD_BEFORE_CROWHR_MISSING` | Import [YTD opening balances](/docs/people/importing/#year-to-date-opening-balances) for months paid before Crow HR. |
| `CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED` | A case CPF has no rule for. Compute that employee's CPF with CPF Board's guidance and pay outside Crow HR, or adjust the AW timing. |
| Scheduled days / days worked missing | The employee has no fixed working week. Add both items for the month. |
| Deduction over the limit | Reduce the deduction by the amount shown; the 50% overall limit is only a warning on final pay. |
| `CPF_RATES_ASSUMED_CARRIED_FORWARD` | The month is beyond CPF's published tables. Check the rates when CPF publishes them. |
| Payslips cannot be released, naming an item | A mandatory payslip item is missing, often the employer's legal name. Fix the record. |
| Employee cannot see their payslip | It is not released yet, or the run is not approved. |
| An employee is missing from the bank file | They have no bank account current on the pay date; the download lists excluded employees. |
| An employee is missing from the EZPay file | Foreign employees with SHG and no S/T number are listed for you to key in EZPay. |

## Still stuck

Collect `docker compose exec app crowhr doctor`, the request ID shown with the error (every API error carries one) and the matching lines of `docker compose logs app`, and open an issue. Do not post NRIC numbers, salaries or other personal data in public issues.
