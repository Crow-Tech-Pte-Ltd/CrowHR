## Why
A member could not change their own sign-in email. The address is one per person across every organisation they belong to, and invitations, SSO linking by verified email, password resets and security notices all trust it, so a change has to prove the new address is reachable.

## What Changes
- `POST /me/email-change` (needs a sign-in within 10 minutes): stores a one-time token (hash only, 24 hours) and emails a link to the new address; the old address is told, with the new one masked. A newer request replaces the old link. `GET` shows the pending change and whether the server can change it; `DELETE` cancels.
- `POST /auth/email-change/confirm` (public, from the link): the new address becomes the sign-in email, verified, in every organisation; the old address is told; audited as `auth.email_change_requested` and `auth.email_changed`. Refused if another account took the address meanwhile.
- **Without SMTP the change is refused** (`409`, `reason: email_unavailable`) and the web app explains why instead of offering it: an unverified address could claim someone else's.
- Web: "Sign-in email" on Sign-in and devices; `/email/<token>` confirms with a click (so mail scanners that open links don't use it up).
- Migration `0021_email_changes`.

## Capabilities
### Modified Capabilities
- `auth`: members change their own sign-in email.

## Non-goals
- An owner changing another member's sign-in email.
- Changing the email without SMTP (for example by an owner's confirmation).
- Changing the work email on the employee record.

## Impact
`packages/core` auth (routes, schema, migration); `apps/web` Me and a public route; docs and limitations.
