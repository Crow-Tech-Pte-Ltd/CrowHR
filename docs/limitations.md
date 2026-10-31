# Known limitations

Everything listed here is stubbed, placeholder or missing. Nothing on this list
may be described as working. Remove an entry only in the change that fixes it.

## Authentication and access (identity workstream)

- **Singpass is not verified against real Singpass.** The FAPI 2.0 flow (PAR, PKCE, `private_key_jwt`, DPoP, encrypted ID tokens) is implemented to the published spec and tested only against the in-process mock IdP (`packages/core/testing/mock-oidc.ts`). Issuer defaults (`https://stg-id.singpass.gov.sg`, `https://id.singpass.gov.sg`) must be checked against the current Singpass docs. Tasks 8.3 (setup guide + manual staging sign-in) is open.
- **Singpass button is not brand-compliant yet.** Singpass's [button design specification](https://docs.developer.singpass.gov.sg/docs/getting-started/singpass-button-design-specification) (effective 1 Sep 2026) requires the official Singpass logo inside the button. The logo is not published under a licence that allows redistribution in this MIT repository, so it is not bundled; the button renders plain text "Log in with Singpass" (no imitation of the wordmark colouring). `ProviderButton` accepts `singpassLogoSrc` for a deployer-supplied official asset. Do not go live with Singpass without it.
- **No SMTP mailer.** `deps.mailer` is never set by `apps/server` yet (the notifications workstream owns the outbox). Invitations and password resets therefore always offer a copyable link; "sign-in attempts blocked" and "recovery code used" notifications are not sent (in-app notifications are also not built).
- **JIT provisioning does not notify HR**; the `member.jit_provisioned` audit event is the only record.
- **Common-password list is curated, not a breach corpus**: a few hundred entries plus pattern rules (`packages/core/src/auth/common-passwords.ts`).
- **Client IP** comes from the socket only. `X-Forwarded-For` from `TRUSTED_PROXIES` is not honoured yet (self-hosting workstream), so behind a reverse proxy every request has the proxy's IP and the per-IP sign-in limit (30/min) applies to everyone together.
- **Organisation logo** in `GET /api/v1/meta` is always `null` until the company profile exists.
- **NRIC/bank reveal endpoints** are not mounted: `revealSensitive()` (re-auth, 30/hour, audit) exists, and the employees module mounts `POST /employees/:id/nric/reveal` once employee records exist. Same for the change-request flow behind `self_change_requires_approval`.
- **No email change** endpoint yet (it would be a `recentAuth` action).
- **Native apps**: the token endpoints exist and are tested; the apps themselves (M4) do not. No browser session is created during a native sign-in at all (stricter than the design's create-then-revoke).
- **No RLS**: isolation is app-level (`orgScope`) plus composite FKs, as designed.
- **Org switcher** in the web shell lists only the current organisation.

## Screens

- **Home** shows fixture data (`apps/web/src/fixtures/`), labelled "Sample data" on screen. Approve/Decline/View all only show a "not connected" toast.
- **Command palette** "People" results are fixture names; selecting one shows a toast.
- **Every module** (People, Payroll, Leave, Attendance, Schedules, Claims, Documents, Reports) is an empty-state placeholder. Settings lists future sections as "Not available yet".
- **No dark mode.** The landing site's dark tokens were not ported.

## Platform

- **`packages/sg-rules`** is a skeleton with a placeholder `CountryRules` interface and no statutory rules.
- **Browser demo** (`apps/demo`, `packages/demo`) does not exist. Core's migrations are applied with Drizzle's filesystem migrator; the demo will need to bundle the SQL.
- **PGlite server mode** (`DATABASE_URL=pglite:…`) is for local development and e2e only: single process, no pooling, no backups.
- **No `docker-compose.yml`** yet.
- **Dependency audit**: `bun audit` reports one moderate, dev-only advisory (GHSA-67mh-4wv8-2f99, esbuild ≤ 0.24.2 dev server) via drizzle-kit's `@esbuild-kit` loader. It is never shipped or run as a server. CI fails on high/critical only.
- **CI has not run**: the workflow exists but nothing has been pushed.
