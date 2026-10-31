## Context

The foundation (`add-foundation`) gives us `createApp(deps)` with injected `Db`, `PasswordHasher`, `FileStore`, `Clock`, `IdGenerator` and `Logger`. It also gives a request context `auth: { user, orgId, roles } | null`, a fail-closed `requireAuth`, and global `users` plus `organisations` tables. Core must stay free of Node imports because the demo runs it in the browser against PGlite. Requirements are in `specs/auth` and `specs/access-control`; this document covers how.

## Goals / Non-Goals

**Goals:** one authorisation entry point that every module uses; auth that works the same in Node, Vitest and the browser; secrets never in plaintext at rest; fast enough for a 1–200-person organisation on a small VPS.

**Non-Goals:** horizontal scaling of sessions or rate limits across several app instances. The self-host target is one app container, and both live in Postgres anyway, so a second instance would still be correct, just not tuned.

## Decisions

1. **Global users, per-org memberships.** `users` stays global: email, password hash, MFA. A person can belong to several organisations, and roles live on the membership. The session holds one active `org_id`, and switching organisations rotates the token. *Alternative:* per-org users. That duplicates passwords and MFA for accountants who serve several clients.

2. **Sessions in the database, opaque token in the cookie.** The `sessions` row is keyed by `sha256(token)`. A request does one indexed lookup. `last_seen_at` is written at most once per 60 s to limit writes. Idle and absolute expiry are checked on read. *Alternative:* a stateless JWT. It cannot be revoked instantly, and revocation is a requirement.

3. **Cookie flags.** The cookie is `__Host-crowhr_session; HttpOnly; Secure; SameSite=Lax; Path=/`. Lax rather than Strict means a link from email into the app keeps the user signed in. CSRF is handled separately (decision 4). When `PUBLIC_URL` is plain `http://` (local dev or a LAN install without TLS, which `add-self-hosting` allows), the cookie becomes `crowhr_session` without `Secure`, because browsers drop `Secure` cookies over HTTP on non-localhost hosts.

4. **CSRF uses Fetch Metadata and Origin checks** (Hono `csrf()`-style middleware plus a `Sec-Fetch-Site` check) on non-safe methods, together with SameSite=Lax. No token is needed because the SPA is same-origin and every mutation is `fetch` with JSON or multipart. *Alternative:* a double-submit token, which adds friction with no gain over Fetch Metadata in supported browsers. OIDC uses `response_mode=query`, so the callback is a top-level GET (the Lax cookie is sent and `state` protects it). `form_post` would need SameSite=None.

5. **Authorisation is code, not config.**
   - `access/matrix.ts` is a typed constant mirroring the spec table: `resource × action → role → scope`.
   - `authorize(resource, action, { targetEmployeeId? })` middleware resolves effective roles and the scope, then returns 403/404 per spec.
   - `scopeFilter(ctx, resource)` returns a Drizzle `where` fragment (all, an employee-ID set, or self) so list endpoints never load out-of-scope rows.
   - `GET /api/v1/me` returns the member's effective permissions so the UI can hide controls. Hiding is cosmetic only.
   - A single table-driven test, `access/matrix.http.test.ts`, seeds one record per scope and asserts every cell.

6. **Manager scope through an interface.** `ReportingScopeResolver.teamOf(orgId, employeeId, onDate)` is defined here. `add-organisation-and-people` implements it with a recursive CTE over current `employment_records.manager_employee_id`, with a depth cap of 20 to detect cycles. This change ships a test double so identity work does not wait on employees. Results are cached per request, not across requests, so reporting-line changes apply immediately.

7. **Field sensitivity at the serialiser.** Response schemas annotate fields with `sensitivity: 'salary' | 'nric' | 'bank' | 'medical'`. A shared `redact(ctx, schema, value)` strips the fields and fills `redactedFields`. Reports and exports call the same function. *Alternative:* per-route checks, which are easy to forget.

8. **SecretBox.**
   - A new injected dependency: AES-256-GCM via Web Crypto, with the key from HKDF(`CROWHR_SECRET_KEY`, info=`crowhr/v1/<purpose>`).
   - Ciphertext format: `v1.<keyId>.<iv>.<ct>`, base64url.
   - Blind index: HMAC-SHA-256 with a separate HKDF purpose, over a normalised value (uppercased NRIC; bank numbers stripped of spaces and dashes).
   - The demo generates a random key per visitor and keeps it in IndexedDB.

9. **One OIDC module on `openid-client` v6.** It uses `fetch` and Web Crypto, so it is runtime-agnostic.
   - Presets are data: issuer template, scopes, extra checks (`hd`, `tid`) and features (`par`, `dpop`, `privateKeyJwt`, `idTokenEncrypted`).
   - Generic OIDC is the base preset. Singpass turns on PAR, DPoP, `private_key_jwt` (ES256) and JWE ID-token decryption. RP keys are generated with Web Crypto and the public JWKS is served at `/api/v1/auth/oidc/<providerId>/jwks.json`.
   - The callback URL is fixed per provider: `/api/v1/auth/oidc/<providerId>/callback`.
   - Transactions (`state`, `nonce`, PKCE verifier, DPoP key, invitation ID) live in `oidc_transactions` with a 10-minute TTL.
   - A mock IdP (`testing/mock-oidc.ts`, an in-process Hono app with its own JWKS) drives the integration tests. The Singpass suite runs against it with FAPI features on. A real Singpass staging check is a manual task.

10. **Throttling lives in Postgres.** The `auth_throttle (key, window_start, count, locked_until)` table uses keys `acct:<userId>` and `ip:<ip>`, updated with `INSERT … ON CONFLICT`. The table is not org-scoped (it is security infrastructure). A sweep removes rows older than 1 day. *Alternative:* in-memory counters, which reset on restart and do not exist in the demo.

11. **The audit hash chain uses an `audit_heads (org_id, last_hash, last_seq)` row** locked `FOR UPDATE` inside the writing transaction. The event commits with the domain change or not at all. A `BEFORE UPDATE OR DELETE` trigger raises an exception. Canonical content is JSON with sorted keys, excluding `hash`. Contention is negligible at SME write rates. Verification is a core function used by `crowhr admin verify-audit` in `apps/server`.

12. **Demo hasher.** `packages/demo` injects `DemoPasswordHasher`: PBKDF2-SHA-256 via Web Crypto at 10 000 iterations, output `$demo-pbkdf2$…`. The low cost is acceptable because the data is fictional and never leaves the browser. Argon2 WASM would add about 1 MB and slow page load. The production argon2id hasher verifies only `$argon2id$` strings, so a demo hash can never authenticate on a server. The demo also injects `demoMode: true` (SSO disabled, persona picker), a no-op `Mailer` that writes to a "Demo mailbox" panel, and the per-visitor SecretBox key.

13. **Mailer is optional.** `deps.mailer?: Mailer`. Auth flows check `mailerConfigured`. Without it, the UI offers copy-link for invitations and resets, and the admin Home shows "Email is not configured". The queue and retries are specified in `add-approvals-and-notifications`. This change only sends through that outbox.

## Data model sketch

`org_id` is present on every tenant table, and FKs to tenant rows are `(org_id, id)`.

| Table | Key columns |
| --- | --- |
| `users` (exists, global) | + `password_hash`, `password_changed_at`, `mfa_totp_secret_enc`, `mfa_last_step`, `mfa_enrolled_at`, `email_verified_at` |
| `memberships` | `id`, `org_id`, `user_id`, `employee_id?` (FK added by org-and-people), `status` (invited, active, suspended, former), `created_at`; unique (`org_id`, `user_id`) |
| `membership_roles` | `org_id`, `membership_id`, `role` (owner, hr_admin, payroll_admin), `granted_by`, `granted_at`; PK (`membership_id`, `role`) |
| `invitations` | `id`, `org_id`, `email`, `membership_id`, `token_hash`, `expires_at`, `invited_by`, `accepted_at`, `revoked_at` |
| `sessions` | `id` = sha256(token), `user_id`, `org_id`, `created_at`, `last_seen_at`, `authenticated_at`, `expires_at`, `ip`, `user_agent`, `revoked_at`, `mfa_satisfied` |
| `recovery_codes` | `user_id`, `code_hash`, `used_at` |
| `password_resets` | `token_hash`, `user_id`, `org_id`, `expires_at`, `used_at`, `created_by?` |
| `auth_throttle` | `key`, `window_start`, `count`, `locked_until` |
| `org_security_settings` | `org_id` PK, `password_enabled`, `mfa_required_roles[]`, `idle_timeout_min`, `absolute_timeout_h` |
| `sso_providers` | `id`, `org_id`, `kind`, `display_name`, `issuer`, `client_id`, `client_secret_enc?`, `private_jwks_enc?`, `allowed_domains[]`, `tenant_id?`, `environment?`, `jit_enabled` (default false), `enabled`, `last_test_ok_at` |
| `user_identities` | `id`, `org_id`, `user_id`, `provider_id`, `issuer`, `subject`, `email_at_link`, `linked_at`, `last_used_at`; unique (`issuer`, `subject`, `org_id`) |
| `oidc_transactions` | `state_hash`, `org_id`, `provider_id`, `nonce`, `code_verifier_enc`, `dpop_jwk_enc?`, `invitation_id?`, `link_user_id?`, `expires_at` |
| `audit_events` | `id`, `org_id`, `seq`, `at`, `actor_type`, `actor_membership_id?`, `action`, `target_type`, `target_id`, `request_id`, `ip`, `user_agent`, `diff jsonb`, `prev_hash`, `hash` |
| `audit_heads` | `org_id` PK, `last_seq`, `last_hash` |

## Risks / Trade-offs

- [Singpass FAPI 2.0 details change, such as the JWE algorithms or DPoP nonce handling] → presets are data. The Singpass suite pins the expected behaviour against the mock IdP, and the setup guide records the Singpass doc version checked. The UI never claims Singpass works until a test sign-in succeeds.
- [Entra `email` claims are mutable] → email matching is used only on first link, only from the configured tenant, and only to an existing pre-provisioned membership. Later sign-ins match by `(issuer, sub)`.
- [The MFA default could lock out a solo owner who ignores the banner] → the 7-day grace period, Home warnings, and the server CLI owner reset as last resort.
- [Losing `CROWHR_SECRET_KEY` makes NRIC, bank and SSO secrets unreadable] → the setup docs make backing up the key a top-level step, and startup refuses to run if the key's check value does not match the stored one.
- [A hash-chain lock serialises audit writes per org] → acceptable at SME volume. Measure in the payroll finalise test (200 employees).

## Migration Plan

Additive migrations only. Existing dev databases get `org_security_settings` defaults through the migration. First-run setup (an install with no organisation) is specified in `add-self-hosting`: a browser wizard guarded by a one-time setup code printed in the container logs. It calls this change's membership and password services to create the first owner.

## Open Questions

- Should hr_admins see the compensation fields they need to generate offer letters? The current answer is no; they would need payroll_admin too. The lead should confirm, since it affects only matrix data, not structure.
- Whether 10 failed attempts and 15 minutes are the right lockout numbers for shared-device shops (constants, easy to tune).
