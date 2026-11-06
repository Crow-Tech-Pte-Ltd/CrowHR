## 1. Crypto and schema

- [x] 1.1 packages/core: write `crypto/secret-box.test.ts` (round-trip, tamper → error, key-id prefix, blind index stable and case-normalised for NRIC) then implement `SecretBox` on Web Crypto and the `deps.secretBox` injection
- [x] 1.2 packages/core: write `testing/schema.auth.test.ts` (tables exist, unique constraints, composite FKs reject cross-org rows) then add schema files `auth.ts`, `access.ts`, `audit.ts` and generate the migration
- [x] 1.3 apps/server: write `src/config.test.ts` cases for missing/short `CROWHR_SECRET_KEY` and `PUBLIC_URL` (names shared with `add-self-hosting`, which owns key generation) then add them to env validation and inject the SecretBox — key generation on first boot stays with add-self-hosting; the startup check against `secret_key_checks` is in `apps/server/src/main.ts`

## 2. Audit log

- [x] 2.1 packages/core: write `audit/audit.test.ts` (event shape, sensitive-field diff records names only, secrets never present, hash chain links, UPDATE/DELETE rejected by trigger, `verifyChain` finds the first broken row) then implement `audit.record()` and `verifyChain`
- [x] 2.2 apps/server: write `src/cli/verify-audit.test.ts` then add `crowhr admin verify-audit` — `node apps/server/src/cli/main.ts admin verify-audit` (WS7 wraps it as `crowhr admin`)

## 3. Access control

- [x] 3.1 packages/core: write `access/scope.test.ts` against a `ReportingScopeResolver` test double (direct, indirect, cycle terminates, self excluded) then implement effective-role resolution (assigned + implicit employee + derived manager)
- [x] 3.2 packages/core: write `access/matrix.http.test.ts` (table-driven: every matrix row × role × in-scope/out-of-scope → expected status) using a stub route per resource, then implement `matrix.ts`, `authorize()` and `scopeFilter()`
- [x] 3.3 packages/core: write `access/redact.test.ts` (each sensitivity class per role, medical approver exception, `redactedFields` populated) then implement the response-schema annotation and `redact()`
- [x] 3.4 packages/core: write `access/nric.test.ts` (mask format for S/T/F/G/M prefixes, reveal requires re-auth, 31st reveal in an hour → 429, audit event) then implement masking and reveal endpoints for NRIC and bank — DONE: masking + `revealSensitive()` (re-auth, 30/h, audit) tested via a stub route; the people module mounts `POST /employees/:id/nric/reveal` and `/bank/reveal` on it (`employees/reveal.http.test.ts`)
- [x] 3.5 packages/core: write `access/self-change.test.ts` (own compensation/bank update → 403 `self_change_requires_approval`; sole owner self-approval flagged) then implement the guard
- [x] 3.6 packages/core: write `testing/cross-org.ts` helper plus `access/cross-org.test.ts` (every registered route with a foreign-org ID → 404) then implement org-scoped data access helpers; document the helper for other modules in `docs/architecture.md` (note for foundation owner)

## 4. Password authentication and sessions

- [x] 4.1 packages/core: write `auth/password-policy.test.ts` (length 12–128, common list, equals-email) then implement the policy with the bundled list
- [x] 4.2 apps/server: extend `src/argon2-hasher.test.ts` (parameters, needsRehash, rejects `$demo-pbkdf2$` hashes) then implement rehash detection
- [x] 4.3 packages/core: write `auth/sign-in.http.test.ts` (success sets cookie with the right flags, identical failure responses for unknown and wrong, timing-equalising dummy verify called) then implement `POST /api/v1/auth/sign-in` and `POST /api/v1/auth/sign-out`
- [x] 4.4 packages/core: write `auth/throttle.test.ts` (10 failures per account/IP → progressive 1–30 second delays; 50 across IPs → one non-extending 30-second new-device pause per 15 minutes, reset on success, IP 31/min → 429 with Retry-After, owner clears lockout) then implement `auth_throttle` — "sign-in attempts blocked" is emailed when a mailer exists; in-app notification NOT IMPLEMENTED (notifications workstream)
- [x] 4.5 packages/core: write `auth/session.test.ts` (idle and absolute expiry with injected clock, `last_seen_at` throttled to 60 s, rotation on sign-in/MFA/org switch, revoke one/all-others, revoked on password change and suspension) then implement session middleware making `requireAuth` real
- [x] 4.6 packages/core: write `auth/csrf.http.test.ts` (cross-origin POST → 403, same-origin OK, `Sec-Fetch-Site: cross-site` → 403, GET unaffected) then implement the middleware
- [x] 4.7 packages/core: write `auth/reauth.test.ts` (each sensitive action > 10 min since auth → 403 `reauth_required`) then implement `requireRecentAuth`
- [x] 4.8 packages/core: write `auth/reset.http.test.ts` (same 202 for unknown, 60-min expiry, single use, sessions revoked, admin-generated link when no mailer, audit) then implement reset
- [x] 4.9 apps/server: write `src/cli/reset-owner-password.test.ts` then implement the CLI command — prints a one-time reset link (no password typed into the shell), `--reset-mfa` optional

## 5. MFA

- [x] 5.1 packages/core: write `auth/totp.test.ts` with RFC 6238 Appendix B vectors, ±1 step and replay rejection, then implement TOTP on Web Crypto HMAC
- [x] 5.2 packages/core: write `auth/mfa.http.test.ts` (enrol requires confirm code, pending-sign-in token 5 min, 5 wrong codes end it, recovery codes 10 × single use, regenerate invalidates, owner resets member MFA) then implement the endpoints
- [x] 5.3 packages/core: write `auth/mfa-policy.test.ts` (default roles, 7-day grace from role grant, `mfa_enrolment_required` afterwards, device sessions included, SSO exempt only with explicit MFA assertion) then implement the policy

## 6. Memberships and invitations

- [x] 6.1 packages/core: write `access/roles.http.test.ts` (who can grant which role, last-owner 409 on revoke and suspend, takes effect next request) then implement member and role endpoints
- [x] 6.2 packages/core: write `auth/invitations.http.test.ts` (7-day expiry, resend replaces token, revoke, accept with password, 409 on existing active email, copy-link without mailer) then implement invitations
- [x] 6.3 packages/core: write `access/former.test.ts` (termination → former, roles dropped, own payslips readable, create leave → 403) against a lifecycle-event stub, then implement the transition hook consumed by `add-organisation-and-people`

## 7. OIDC (Google, Entra, generic)

- [x] 7.1 packages/core: build `testing/mock-oidc.ts` (in-process IdP with discovery, JWKS, code flow, configurable claims) and verify it with `testing/mock-oidc.test.ts`
- [x] 7.2 packages/core: write `auth/oidc-config.http.test.ts` (discovery fetched and issuer checked, secrets encrypted and never echoed, Entra `common` rejected, owner-only, re-auth required, audit) then implement provider CRUD with presets
- [x] 7.3 packages/core: write `auth/oidc-flow.http.test.ts` against the mock (PKCE S256, state/nonce, TTL 10 min, state mismatch, bad signature, wrong audience, `hd` and `tid` mismatch → failure with audit reason) then implement start and callback routes — ID-token signatures are verified (openid-client `enableNonRepudiationChecks`), not just trusted over TLS
- [x] 7.4 packages/core: write `auth/oidc-linking.test.ts` (verified-email first link, unverified email refused, invitation-bound link, `(issuer, sub)` match afterwards, unlink blocked when it is the last method, JIT off by default, JIT domain allow-list) then implement linking
- [x] 7.5 packages/core: write `auth/sign-in-methods.http.test.ts` (public methods endpoint lists only enabled + configured, cannot disable password before a successful SSO test, staff refused with method names, owner break-glass audited) then implement method configuration

## 8. Singpass (milestone M3)

- [x] 8.1 packages/core: extend the mock IdP with PAR, DPoP and JWE ID tokens; write `auth/singpass.test.ts` (PAR used, `private_key_jwt` assertion valid, DPoP proof bound, encrypted ID token decrypted, link only by invitation or profile) then enable the Singpass preset — tested only against the mock IdP; NOT verified against real Singpass (8.3 open)
- [x] 8.2 packages/core: write `auth/jwks.http.test.ts` (public keys only, no private members) then implement RP key generation and the JWKS route
- [ ] 8.3 apps/docs: Singpass relying-party setup guide — verified by review; manual staging sign-in recorded in the guide before this task is ticked — PARTIAL: guide written (`apps/docs/src/content/docs/admin/sso/singpass.mdx`, onboarding requirements, keys/JWKS, linking, button limitation, "not verified against real Singpass"); the staging sign-in has not been done

## 9. Web UI

- [x] 9.1 apps/web: write `e2e/auth.spec.ts` (sign in, wrong password message, MFA enrol and sign in with code, idle timeout message with mocked clock, revoke other session) then build the sign-in, MFA, reset and invitation-acceptance screens — e2e: password sign-in, wrong-password message, MFA enrol + code sign-in, revoke other session, admin sign-out-everywhere, invite → accept → sign in; the idle-timeout message is unit-tested (`sign-in/notices.test.ts`) and server-tested with an injected clock, since the e2e server clock cannot be mocked
- [ ] 9.2 apps/web: write `e2e/security-settings.spec.ts` (owner adds a generic OIDC provider against the mock IdP, test sign-in, disable password, staff sees the SSO-only message) then build Settings → Security, Members and My sessions — PARTIAL: Security (methods, per-provider setup with guidance, test sign-in, MFA policy, timeouts, HTTPS warning), Members and roles, and My sessions are built; e2e covers the settings screens and validation but not the mock-IdP round trip, which is covered by `auth/oidc-flow.http.test.ts`
- [ ] 9.3 apps/web: write `e2e/audit-log.spec.ts` (filter, export CSV, hr_admin cannot see SSO events) then build the Audit log screen — PARTIAL: Audit log screen built (filters, detail, CSV export); filter/export/hr_admin visibility are covered by `audit/routes.test.ts`, e2e checks rendering only
- [x] 9.4 apps/web: write `src/lib/nric-reveal.test.tsx` (masked by default, reveal prompts re-auth, value cleared on navigation) then build the reveal control — DONE by the people module: `routes/_app/people/-lib/reveal.tsx` on the employee profile; apps/web has no DOM test environment, so the behaviour is covered by Playwright (`e2e/people/reveal.people.ts`) instead of a unit test

## 10. Demo substitution

- [x] 10.1 packages/demo: `DemoPasswordHasher`, demo SecretBox key and the no-op Mailer — `createDemoPasswordHasher()` lives in core (`auth/demo-hasher.ts`, tested) and is injected by `packages/demo/src/deps.ts`; the per-browser SecretBox key and the Demo outbox mailer are in `packages/demo` (WS8b)
- [x] 10.2 packages/core: write `auth/demo-mode.http.test.ts` (SSO start returns 403 `disabled_in_demo` without outbound fetch; persona list endpoint only in demo mode) then implement the demo flags

## Security review follow-up (sign-in and member access)

- [x] Require recent authentication at SSO link/test start and callback; email new links; remove links on reset/sign-out-everywhere; enforce MFA after SSO.
- [x] Restrict admin reset links to recently authenticated owners and single-org, unprivileged targets; notify the target when SMTP exists.
- [x] Enforce one live membership per employee with a generated partial unique index; protect privileged/manager invitation links in the shared service.
- [x] Apply enrolment policy to native exchange and device sessions; rotate refresh tokens with compare-and-set and revoke on reuse.
- [x] Share a serialized per-user TOTP/recovery failure budget across verification, re-authentication and invitation acceptance; rate-limit MFA verification by IP; clear password failures only after MFA.
- [x] Require TOTP for invitation acceptance by an enrolled account; require Entra xms_edov for automatic email linking.
- [x] Replace account-wide password denial with per-account/IP progressive delays and a bounded new-device ceiling; preserve known-browser access on other networks.
- [x] Parse forwarded source ports and stop at unknown hops; require SMTP STARTTLS by default on port 587 with an explicit override.
- [x] Security notices in the in-app inbox and retryable outbox delivery — `auth/security-notices.ts`: every security notice is an in-app `security_notice` notification (works without SMTP) and, with SMTP, an outbox email (retried 1/5/30/120/720 min); added notices for new-browser sign-in, new app device, password changed, MFA on/off/reset, identity unlinked, refresh-token reuse, sign-in settings changes (owners) and JIT members (HR); tested in `auth/security-notices.http.test.ts` and `auth/oidc-flow.http.test.ts`. Invitation and reset-link emails stay direct (their tokens are never stored); see docs/limitations.md.
