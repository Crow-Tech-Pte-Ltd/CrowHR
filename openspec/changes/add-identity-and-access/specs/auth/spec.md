## Purpose

Defines how people prove who they are to a Crow HR organisation: password and single sign-on, multi-factor authentication, sessions, invitations and the per-organisation choice of sign-in methods.

## ADDED Requirements

### Requirement: Organisation-scoped sign-in page
The sign-in page SHALL be scoped to one organisation (`/sign-in/<org-slug>`; plain `/sign-in` resolves to the only organisation when the install has exactly one, and otherwise asks for the organisation). It SHALL show only the sign-in methods that organisation has enabled and fully configured, and SHALL NOT reveal whether an email address belongs to a member.

#### Scenario: Only enabled methods shown
- **WHEN** an organisation has password and Google enabled and Entra configured but disabled
- **THEN** its sign-in page shows the email/password form and a Google button, and no Entra button

#### Scenario: Singpass not configured
- **WHEN** an owner has enabled Singpass but has not uploaded the relying-party client ID and keys
- **THEN** the sign-in page shows no Singpass button and Settings → Security shows Singpass as "Not configured" with a link to the setup guide

### Requirement: Password sign-in
A user SHALL sign in with email and password when the organisation allows password sign-in for them. Any failure (unknown email, wrong password, suspended membership, locked account) SHALL return the same 401 response `invalid_credentials` with the same message, and password verification SHALL run even for unknown emails so response time does not reveal membership.

#### Scenario: Wrong password
- **WHEN** a member submits a correct email and wrong password
- **THEN** the response is 401 `invalid_credentials`, no session is created, and an audit event `auth.sign_in_failed` is recorded

#### Scenario: Unknown email
- **WHEN** someone submits an email with no membership in the organisation
- **THEN** the response is byte-identical in body and status to the wrong-password case

### Requirement: Password policy and hashing
Passwords SHALL be 12 to 128 characters, SHALL NOT appear in the bundled common-password list, and SHALL NOT equal the user's email. No character-class composition rules apply. Passwords SHALL be stored only as argon2id hashes (memory 19 456 KiB, iterations 2, parallelism 1, or stronger). A hash with weaker parameters SHALL be transparently re-hashed on the next successful sign-in. The production hasher SHALL reject any stored hash that is not argon2id.

#### Scenario: Common password rejected
- **WHEN** a user sets the password `password1234`
- **THEN** the request fails with 400 `validation_failed` and a message saying the password is too common and to choose a longer, less predictable one

#### Scenario: Demo hash refused by server
- **WHEN** the production hasher is asked to verify a hash produced by the demo hasher
- **THEN** verification fails without throwing a hash-format detail to the client

### Requirement: Sign-in throttling and lockout
After 10 consecutive failed sign-ins for one account within 15 minutes, further password attempts for that account SHALL fail with `invalid_credentials` for 15 minutes, even if the password is correct. More than 30 sign-in attempts per minute from one IP address SHALL receive 429 `rate_limited` with a `Retry-After` header. A successful sign-in SHALL reset the account counter. Owners SHALL be able to clear a member's lockout.

#### Scenario: Account locked after ten failures
- **WHEN** 10 wrong passwords are submitted for an account within 15 minutes and then the correct password is submitted
- **THEN** the 11th attempt fails with `invalid_credentials`, the user receives a "sign-in attempts blocked" notification, and an audit event `auth.locked` is recorded

#### Scenario: Lockout expires
- **WHEN** 15 minutes pass after the lockout began and the correct password is submitted
- **THEN** sign-in succeeds

#### Scenario: IP rate limit
- **WHEN** one IP address sends a 31st sign-in attempt within a minute
- **THEN** the response is 429 `rate_limited` with `Retry-After`

### Requirement: Password reset
A reset request SHALL always return the same 202 response. When the email belongs to a member and email is configured, a single-use reset link SHALL be emailed. The token SHALL be 256 bits, stored only as a SHA-256 hash, and SHALL expire after 60 minutes. Completing a reset SHALL revoke all of that user's sessions and record `auth.password_reset`. When email is not configured, an owner or `hr_admin` SHALL be able to generate a reset link for a member, shown once, with the same expiry. Server operators SHALL be able to reset an owner's password with the server CLI.

#### Scenario: Reset link reused
- **WHEN** a reset link that has already been used is opened
- **THEN** the page says the link has expired or was already used and offers to request a new one

#### Scenario: Reset without SMTP
- **WHEN** email is not configured and an hr_admin generates a reset link for an employee
- **THEN** the link is displayed once with a copy button and an audit event `auth.reset_link_generated` names the admin and the employee

### Requirement: TOTP multi-factor authentication
Users SHALL be able to enrol an authenticator app using TOTP (RFC 6238: SHA-1, 6 digits, 30-second step, accepting ±1 step). Enrolment SHALL complete only after a valid code is entered. A code SHALL be accepted at most once (the last used time step is stored). The TOTP secret SHALL be encrypted at rest. When MFA is enrolled, password sign-in SHALL require a TOTP or recovery code before a session is created. Five wrong codes SHALL end the pending sign-in.

#### Scenario: Replayed code
- **WHEN** a valid TOTP code that was already used to sign in is submitted again within its time window
- **THEN** it is rejected with `invalid_mfa_code`

#### Scenario: MFA required after password
- **WHEN** a user with MFA enrolled submits a correct password
- **THEN** the response is 200 with `mfaRequired: true` and a pending-sign-in token valid for 5 minutes, and no session cookie is set

### Requirement: Recovery codes
MFA enrolment SHALL generate 10 single-use recovery codes of 10 characters each from an unambiguous alphabet. They SHALL be shown once and stored hashed. Regenerating codes SHALL invalidate all previous codes. Using a recovery code SHALL notify the user and record `auth.recovery_code_used`. An owner SHALL be able to reset another member's MFA, and that action SHALL record an audit event.

#### Scenario: Recovery code single use
- **WHEN** a recovery code is used to sign in and later submitted again
- **THEN** the second use is rejected and the user's remaining-code count is 9

### Requirement: MFA policy for privileged roles
Each organisation SHALL have an MFA policy listing the roles that must use MFA for password sign-in. The default SHALL be `owner`, `hr_admin` and `payroll_admin`. A member whose role requires MFA and who has not enrolled SHALL be allowed to sign in during a 7-day grace period from the role grant. Every request during that period SHALL show an enrolment banner. After the grace period the member SHALL be sent to MFA enrolment, with no other access, until enrolment completes. Sign-ins through SSO SHALL NOT be subject to this policy, because the identity provider is responsible for MFA.

#### Scenario: Grace period over
- **WHEN** an hr_admin without MFA signs in by password 8 days after being granted the role
- **THEN** every API request except MFA enrolment and sign-out returns 403 `mfa_enrolment_required`

### Requirement: Sessions
A successful sign-in SHALL create a server-side session record and set a cookie named `__Host-crowhr_session` with `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`. The cookie value SHALL be a 256-bit random token, and the database SHALL store only its SHA-256 hash. When `PUBLIC_URL` uses plain HTTP (localhost or a LAN install), the cookie SHALL instead be named `crowhr_session` without `Secure`, and owners SHALL see a "Not using HTTPS" warning in Settings → Security. A session SHALL expire after the organisation's idle timeout (default 30 minutes, settable 15 to 240) and absolute timeout (default 12 hours, settable 1 to 24). The session token SHALL be rotated on sign-in, on MFA completion and when the session's organisation changes.

#### Scenario: Idle timeout
- **WHEN** a session has made no request for longer than the idle timeout
- **THEN** the next request returns 401 `session_expired` and the web app shows the sign-in page with "You were signed out after a period of inactivity"

#### Scenario: Absolute timeout despite activity
- **WHEN** a session has been active continuously for 12 hours under default settings
- **THEN** the next request returns 401 `session_expired`

### Requirement: Session management and revocation
Users SHALL see their active sessions (device summary from the user agent, IP address, created and last-active time, and which one is current) and SHALL be able to revoke any one session or all sessions except the current one. Changing a password, resetting a password, suspending a membership, or an owner's "sign out everywhere" for a member SHALL revoke the affected sessions. A revoked session SHALL fail on its next request.

#### Scenario: Revoke another device
- **WHEN** a user revokes their session on another device
- **THEN** the next request from that device returns 401 and `auth.session_revoked` is recorded

### Requirement: Recent re-authentication
Sensitive actions SHALL require that the session authenticated within the last 10 minutes. Otherwise they SHALL fail with 403 `reauth_required`, and the client SHALL prompt for the password plus MFA, or an SSO round-trip. Sensitive actions are: changing the password, MFA settings or email; changing security settings or SSO configuration; granting or revoking roles; revealing an unmasked NRIC/FIN or bank account number; and exports containing sensitive fields.

#### Scenario: Stale session changes SSO config
- **WHEN** an owner whose last authentication was 25 minutes ago saves an SSO provider
- **THEN** the response is 403 `reauth_required` and nothing is saved

### Requirement: CSRF protection
State-changing API requests (any method other than GET, HEAD or OPTIONS) SHALL be rejected with 403 `csrf_rejected` when the `Origin` header is present and does not match the origin of `PUBLIC_URL`, or when `Sec-Fetch-Site` is `cross-site`. Requests authenticated by a bearer token (see `api-platform`) carry no cookie and are exempt. The API SHALL NOT perform state changes on GET. The OIDC callback is the only cookie-authenticated GET with side effects, and it is protected by `state`.

#### Scenario: Cross-site form post
- **WHEN** a request `POST /api/v1/employees` arrives with a valid session cookie and `Origin: https://evil.example`
- **THEN** it is rejected with 403 `csrf_rejected`

### Requirement: Sign-in method configuration
The owner SHALL be able to enable or disable each method (password, Google, Microsoft Entra ID, Singpass, generic OIDC) in Settings → Security. Password sign-in SHALL NOT be disabled until at least one SSO provider is enabled and has had a successful test sign-in. When password sign-in is disabled, members other than owners SHALL be refused password sign-in with a message naming the enabled SSO methods. Owners SHALL always be able to sign in with password (break-glass), still subject to MFA.

#### Scenario: Break-glass owner
- **WHEN** password sign-in is disabled and the owner signs in with email, password and TOTP
- **THEN** sign-in succeeds and `auth.break_glass_sign_in` is recorded

#### Scenario: Staff password refused
- **WHEN** password sign-in is disabled and an employee submits correct credentials
- **THEN** the response is 403 `password_sign_in_disabled` with the names of the enabled SSO methods

### Requirement: OIDC provider configuration
SSO providers SHALL be configured per organisation from presets: `google` (issuer fixed; optional allowed hosted domains checked against the `hd` claim), `entra` (tenant ID required; tokens whose `tid` differs are rejected; `common` and `organizations` tenants are not allowed), `singpass` (environment staging or production; client ID; signing and encryption keys generated by Crow HR or uploaded), and `oidc` (any issuer URL with discovery). Saving a provider SHALL fetch its discovery document and fail with a readable error when it cannot be retrieved or its issuer does not match. Client secrets and private keys SHALL be encrypted at rest and never returned by the API after saving. The API SHALL show only whether they are set. Public keys for Singpass SHALL be published at a per-provider JWKS URL.

#### Scenario: Secret never echoed
- **WHEN** an owner reads a saved Google provider configuration
- **THEN** the response contains `clientSecretSet: true` and no secret value

#### Scenario: Bad issuer
- **WHEN** a generic OIDC provider is saved with an issuer URL whose discovery document is unreachable
- **THEN** the save fails with 400 `validation_failed` explaining that the discovery document at `<issuer>/.well-known/openid-configuration` could not be fetched

### Requirement: OIDC sign-in flow
All providers SHALL use the authorization code flow with PKCE (S256), a random `state` and `nonce` stored server-side for at most 10 minutes, and `response_mode=query`. The ID token signature, issuer, audience, expiry and nonce SHALL be validated. Singpass SHALL additionally use pushed authorization requests, `private_key_jwt` client authentication and DPoP-bound tokens, and SHALL decrypt an encrypted ID token with the relying party's key. Any validation failure SHALL end on the sign-in page with a generic "Sign-in with <provider> failed" message, and the specific reason SHALL be recorded in the audit event.

#### Scenario: State mismatch
- **WHEN** the callback arrives with a `state` that does not match a stored transaction
- **THEN** no session is created and `auth.sso_failed` is recorded with reason `state_mismatch`

### Requirement: SSO identity linking
An SSO sign-in SHALL succeed only for an identity linked to an active membership of that organisation. Once linked, the identity is matched by `(issuer, subject)`. An unlinked identity SHALL be linked on first sign-in only when one of these holds: (a) the IdP asserts a verified email (`email_verified: true`, or an Entra token from the configured tenant) equal to the email of an existing active or invited membership; or (b) the sign-in started from an invitation link, which binds the identity to that invitation. Singpass identities SHALL link only by (b) or by an already signed-in user choosing "Link Singpass" in their profile, never by email or NRIC. Users SHALL be able to unlink an identity unless it is their only remaining sign-in method. Link and unlink SHALL be audit-logged.

#### Scenario: No pre-provisioned user
- **WHEN** someone signs in with Google using a verified email that has no membership and JIT is off
- **THEN** sign-in fails with "Your account has not been set up in <org>. Ask your HR team for an invitation" and `auth.sso_failed` is recorded with reason `not_provisioned`

#### Scenario: Singpass linked via invitation
- **WHEN** an invited employee chooses "Accept with Singpass" on the invitation page and completes Singpass
- **THEN** the Singpass subject is stored against their membership and later Singpass sign-ins match by it

### Requirement: Just-in-time provisioning
JIT provisioning SHALL be off by default and configurable per SSO provider (not Singpass). When on, a verified email whose domain is in the provider's allowed-domain list and that has no membership SHALL create a user and a membership with role `employee` and status `active`, linked to no employee record. HR SHALL be notified to link or remove it. Emails outside the allowed domains SHALL be refused as if JIT were off.

#### Scenario: Domain outside allow list
- **WHEN** JIT is on with allowed domain `acme.sg` and a user signs in as `x@gmail.com`
- **THEN** no user is created and the sign-in fails with reason `not_provisioned`

### Requirement: Invitations
Owners and hr_admins SHALL invite people by email, optionally linked to an employee record, with the roles they are allowed to grant. An invitation token SHALL be 256 bits, stored hashed, and valid for 7 days. Resending SHALL replace the token. Revoking SHALL invalidate it. Accepting SHALL let the invitee set a password or use any enabled SSO method, and SHALL activate the membership. Without email configured, the inviter SHALL be able to copy the link. Inviting an email that already has an active membership SHALL fail with 409 `conflict`.

#### Scenario: Expired invitation
- **WHEN** an invitation link older than 7 days is opened
- **THEN** the page says it has expired and to ask HR to resend it, and the membership stays `invited`

### Requirement: Demo-mode sign-in
When the core runs in demo mode, SSO buttons SHALL be visible on the sign-in page, disabled, and labelled "Not available in the demo. Self-hosted installs can enable this in Settings → Security." Password sign-in SHALL work against seeded fictional accounts, and the sign-in page SHALL offer one-click persona selection (owner, HR admin, payroll admin, manager, employee). Demo password hashes SHALL use a format the production hasher rejects.

#### Scenario: SSO in demo
- **WHEN** a demo visitor clicks the Microsoft button
- **THEN** no network request is made to any identity provider and the explanation is shown
