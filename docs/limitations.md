# Known limitations

Everything listed here is stubbed, placeholder or missing. Nothing on this list
may be described as working. Remove an entry only in the change that fixes it.

## Authentication and access (identity workstream)

- **Singpass is not verified against real Singpass.** The FAPI 2.0 flow (PAR, PKCE, `private_key_jwt`, DPoP, encrypted ID tokens) is implemented to the published spec and tested only against the in-process mock IdP (`packages/core/testing/mock-oidc.ts`). Issuer defaults (`https://stg-id.singpass.gov.sg`, `https://id.singpass.gov.sg`) must be checked against the current Singpass docs. Tasks 8.3 (setup guide + manual staging sign-in) is open.
- **Singpass button is not brand-compliant yet.** Singpass's [button design specification](https://docs.developer.singpass.gov.sg/docs/getting-started/singpass-button-design-specification) (effective 1 Sep 2026) requires the official Singpass logo inside the button. The logo is not published under a licence that allows redistribution in this MIT repository, so it is not bundled; the button renders plain text "Log in with Singpass" (no imitation of the wordmark colouring). `ProviderButton` accepts `singpassLogoSrc` for a deployer-supplied official asset. Do not go live with Singpass without it.
- **No SMTP mailer.** `deps.mailer` is never set by `apps/server` yet (the notifications workstream owns the outbox). Invitations and password resets therefore always offer a copyable link; "sign-in attempts blocked" and "recovery code used" notifications are not sent (in-app notifications are also not built).
- **JIT provisioning does not notify HR**; the `member.jit_provisioned` audit event is the only record.
- **Common-password list is curated, not a breach corpus**: a few hundred entries plus pattern rules (`packages/core/src/auth/common-passwords.ts`).
- **Organisation logo** in `GET /api/v1/meta` is always `null` until the company profile exists.
- **No email change** endpoint yet (it would be a `recentAuth` action).
- **Native apps**: the token endpoints exist and are tested; the apps themselves (M4) do not. No browser session is created during a native sign-in at all (stricter than the design's create-then-revoke).
- **No RLS**: isolation is app-level (`orgScope`) plus composite FKs, as designed.
- **Org switcher** in the web shell lists only the current organisation (the API supports `POST /api/v1/auth/switch-organisation`).
- **Admin/employee view** in the web shell is still a client-side preview toggle (user menu or `?view=employee`), not derived from roles. The server enforces roles on every request regardless.
- **E2E gaps**: the SSO round trip, audit-log filtering/export and device sessions are covered by core integration tests (mock IdP, PGlite), not by Playwright. The idle-timeout message is unit-tested; an e2e with a mocked server clock is not feasible against the real server.
- **QR code** for authenticator enrolment is generated in the browser (`qrcode` package); nothing is sent to a third party.

## Screens

- **Home** shows fixture data (`apps/web/src/fixtures/`), labelled "Sample data" on screen. Approve/Decline/View all only show a "not connected" toast.
- **Command palette** "People" results come from the live directory (people module).
- **Every module** except People (Payroll, Leave, Attendance, Schedules, Claims, Documents, Reports) is an empty-state placeholder. Settings lists future sections as "Not available yet".
- **No dark mode.** The landing site's dark tokens were not ported.

## Platform

- **`packages/sg-rules`** implements effective-dated, cited rule tables and calculators for CPF (2025–2027 tables, OW/AW ceilings, SPR phases), SDL, SHG funds, FWL estimates, Employment Act Part IV coverage, overtime, rest-day and public-holiday pay, incomplete-month salary, annual and sick leave entitlements and the 2026–2027 public holidays. How it was checked is in `packages/sg-rules/VERIFICATION.md` (91/91 research vectors, all 16 CPF AW-ceiling examples, 15/15 cases against CPF's online calculator; `bun run check` enforces ≥ 95% line coverage). Its limits:
  - **CPF rates from 2028** are not published: the 2027 tables are carried forward with warning `CPF_RATES_ASSUMED_CARRIED_FORWARD`.
  - **Low-wage months (TW $50–$750) with AW above the ceiling** are refused (`CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED`); no official rule exists.
  - **Open CPF questions** (VERIFICATION.md "Open legal and design questions"): delayed AW across years, a known leaving month in the AW-ceiling projection, SPR F/G election timing, mid-month residency changes.
  - **Not encoded yet**: parental leave (maternity, paternity, shared parental, childcare, infant care, adoption), part-time leave in hours, income tax / IR8A / IR21, CPF late-payment interest, work-pass salary thresholds.
  - **Overtime rounding** has no MOM rule; the default reproduces MOM's published example ($13.60/h cap for non-workmen).
- **Browser demo** (`apps/demo`, `packages/demo`) does not exist. Core's migrations are applied with Drizzle's filesystem migrator; the demo will need to bundle the SQL.
- **PGlite server mode** (`DATABASE_URL=pglite:…`) is for local development and e2e only: single process, no pooling, no backups.

## Self-hosting

- **Images are not published.** `docker-compose.yml` names `ghcr.io/crow-tech-pte-ltd/crowhr:1` (registry unconfirmed) and builds it from the checkout; publishing needs Daniel's approval. arm64 was verified once locally under QEMU (build, argon2, start against PostgreSQL 17); CI builds amd64 only.
- **Reverse proxies:** only Caddy is exercised by `e2e/self-host.sh` (HTTP, Caddy container on the compose network). The nginx, Traefik and Cloudflare Tunnel examples in `docs/self-hosting/reverse-proxy.md` have not been run.
- **Home backup warning:** the "last successful backup older than 48 hours" warning appears on Settings → System and in `crowhr doctor`, but not on Home yet: it needs the workflows `InboxSource` (add-approvals-and-notifications).
- **Scheduled backups** run on an in-process one-minute timer in `apps/server`, not as a sweep of the workflows `tick` (not built yet). One attempt per day; a failed attempt is retried the next day.
- **Setup checklist on Home** after the wizard is not shown (organisation setup checklist and Home belong to other workstreams).
- **Restore restarts the app** by signalling PID 1 inside the container; under `docker compose run` (or outside Docker) it prints "restart the app" instead.
- **Self-hosting docs** are drafts in `docs/self-hosting/`; the docs site (`apps/docs`) does not exist yet.
- **Dependency audit**: `bun audit` reports one moderate, dev-only advisory (GHSA-67mh-4wv8-2f99, esbuild ≤ 0.24.2 dev server) via drizzle-kit's `@esbuild-kit` loader. It is never shipped or run as a server. CI fails on high/critical only.
- **CI has not run**: the workflow exists but nothing has been pushed.

## Organisation and people (add-organisation-and-people)

- **No first-run setup yet**, so a fresh server has no organisation or members to sign in with. The people screens are exercised by `packages/core/testing/people-dev-server.ts` (DEV ONLY, 127.0.0.1): the real app with real sessions, seeded with fictional staff, where `/__dev/as/<persona>` creates a session for a seeded member. The people e2e (`e2e/people/`) runs against it.
- **Invitations sent by an import** go out after the import is confirmed; without SMTP their one-time links are not shown, so HR resends them from Settings → Members (a single hire shows its link).
- **Workflows stand-ins**: change requests wait in `profile_change_requests` and are decided through `POST /api/v1/people/change-requests/:id/decision`; no approval task, inbox item or notification is created. Checklist and setup-checklist inbox items are exposed by people endpoints, not yet by a workflows `InboxSource`.
- **Payroll stand-in**: no period is ever finalised, so the retroactive-change guard only triggers in tests, and back-pay notices go nowhere.
- **The `former` transition** (`runFormerTransitions`) is implemented with identity's `markMembershipFormer`, but nothing calls it until the workflows `tick(now)` sweep exists.
- **Minimum employment age and default notice** come from `packages/sg-rules` (MOM-cited, rules from 1 Jan 2025): hires under 13 are refused (the Employment Act's family-only industrial undertaking exception is not supported; start dates before 2025 are not checked), and a resignation without a contractual notice period gets the statutory minimum by service. The under-16 conditions (light duties, MOM notification for industrial work, hour limits) are returned as warnings by `checkEmploymentAge` but not shown in the hire flow yet.
- **Personal-details change requests apply from the approval date only** (no future-dated personal details). Bank changes honour the approver's effective date.
- **Sole-owner self-approval** of change requests (`self_approved`) belongs to workflows and is NOT IMPLEMENTED; nobody can decide their own request.
- **Cancelling a scheduled hire or rehire** is not supported; record a termination instead.
- **Statutory lookups** (CSN payment types, rest-day rule, work pass types) are cited in `packages/core/src/organisation/statutory.ts` and should move to `packages/sg-rules`.
- **NRIC/bank reveal** (`POST /api/v1/employees/:id/nric/reveal`, `/bank/reveal`) has no web unit test: apps/web has no DOM test environment; it is covered by Playwright (`e2e/people/reveal.people.ts`).
- **Company logo** upload has an API only; there is no upload control on the Company screen yet.
