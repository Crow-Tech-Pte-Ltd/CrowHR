---
title: Two-step verification (MFA)
description: How TOTP two-step verification, recovery codes and the MFA policy for privileged roles work in Crow HR.
---

Crow HR supports two-step verification with an authenticator app (TOTP) for password and SSO sign-in.

## Enrolling

Each person enrols from **My sessions** (the banner's **Set up now** goes there). Scan the QR code with an authenticator app (any app that supports standard TOTP: 6 digits, 30-second codes) and enter a code to finish. The QR code is drawn in your browser; nothing is sent to a third party.

Enrolment shows **10 recovery codes** once. Each works once, in place of an authenticator code. Store them somewhere safe. Regenerating codes invalidates the old set.

After enrolment, password sign-in and accepting an invitation to another organisation require a code. SSO also requires it unless the identity provider explicitly asserts MFA (`amr` contains `mfa`). A used code is refused. Five wrong TOTP or recovery codes across sign-in challenges, re-authentication and invitation acceptance pause codes for the account for 15 minutes. Starting another challenge does not reset this budget. MFA verification also allows at most 30 requests per minute per IP. Password failure counters clear only after the complete sign-in succeeds.

## MFA policy for privileged roles

In **Settings → Security → Two-step verification policy**, owners choose which roles must use two-step verification for password and SSO sign-in. By default: **owner, HR admin and payroll admin**.

- A member who gets such a role has **7 days** from the role grant to enrol. During that time every page shows a banner with the deadline.
- After 7 days without enrolment, they can only enrol or sign out until they do (`403 mfa_enrolment_required` for everything else).
- The policy also covers **SSO and native app sessions**. An SSO session satisfies the policy when its validated ID token explicitly asserts MFA (`amr` contains `mfa`; [RFC 8176](https://www.rfc-editor.org/rfc/rfc8176.html)). A single OTP or key claim does not establish multiple factors. Without that assertion, enrol a Crow HR authenticator. Native token exchange is refused while enrolment is blocked; enrol in the browser first.

## When someone loses their device

- They can sign in with a recovery code and enrol again.
- An owner can reset another member's two-step verification in **Settings → Members**. The reset is audited.
- If the only owner is locked out, the server operator runs `crowhr reset-owner-mfa --email <owner email>` (see the [CLI reference](/docs/self-hosting/cli/#reset-owner-mfa)).

## Not available yet

- Turning two-step verification on or off, an owner resetting it, a recovery code being used and a lockout after wrong codes each send you a [security notice](/docs/approvals/notifications/#security-notices) in the app, and by email when SMTP is set. Recovery-code use is also audited.
- Only TOTP is supported. There are no passkeys, WebAuthn security keys or SMS codes.
