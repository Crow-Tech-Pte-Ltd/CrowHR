---
title: Two-step verification (MFA)
description: How TOTP two-step verification, recovery codes and the MFA policy for privileged roles work in Crow HR.
---

Crow HR supports two-step verification with an authenticator app (TOTP) for password sign-in.

## Enrolling

Each person enrols from **My sessions** (the banner's **Set up now** goes there). Scan the QR code with an authenticator app (any app that supports standard TOTP: 6 digits, 30-second codes) and enter a code to finish. The QR code is drawn in your browser; nothing is sent to a third party.

Enrolment shows **10 recovery codes** once. Each works once, in place of an authenticator code. Store them somewhere safe. Regenerating codes invalidates the old set.

After enrolment, password sign-in asks for a code after the password. Five wrong codes end that sign-in attempt; a code that was already used is refused.

## MFA policy for privileged roles

In **Settings → Security → Two-step verification policy**, owners choose which roles must use two-step verification for password sign-in. By default: **owner, HR admin and payroll admin**.

- A member who gets such a role has **7 days** from the role grant to enrol. During that time every page shows a banner with the deadline.
- After 7 days without enrolment, they can only enrol or sign out until they do (`403 mfa_enrolment_required` for everything else).
- **SSO sign-ins are exempt**: the identity provider is responsible for MFA there. Enforce MFA in Google Workspace, Entra ID or your OIDC provider if staff sign in that way.

## When someone loses their device

- They can sign in with a recovery code and enrol again.
- An owner can reset another member's two-step verification in **Settings → Members**. The reset is audited.
- If the only owner is locked out, the server operator runs `crowhr reset-owner-mfa --email <owner email>` (see the [CLI reference](/docs/self-hosting/cli/#reset-owner-mfa)).

## Not available yet

- Notifications for "new MFA method" and "recovery code used" are not sent yet (in-app or by email). Using a recovery code is recorded in the audit log (`auth.recovery_code_used`).
- Only TOTP is supported. There are no passkeys, WebAuthn security keys or SMS codes.
