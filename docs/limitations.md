# Known limitations

Everything listed here is stubbed, placeholder or missing. Nothing on this list
may be described as working. Remove an entry only in the change that fixes it.

## Authentication and access (identity workstream)

- **Singpass is not verified against real Singpass.** The FAPI 2.0 flow (PAR, PKCE, `private_key_jwt`, DPoP, encrypted ID tokens) is implemented to the published spec and tested only against the in-process mock IdP (`packages/core/testing/mock-oidc.ts`). Issuer defaults (`https://stg-id.singpass.gov.sg`, `https://id.singpass.gov.sg`) must be checked against the current Singpass docs. Tasks 8.3 (setup guide + manual staging sign-in) is open.
- **Singpass button is not brand-compliant yet.** Singpass's [button design specification](https://docs.developer.singpass.gov.sg/docs/getting-started/singpass-button-design-specification) (effective 1 Sep 2026) requires the official Singpass logo inside the button. The logo is not published under a licence that allows redistribution in this MIT repository, so it is not bundled; the button renders plain text "Log in with Singpass" (no imitation of the wordmark colouring). `ProviderButton` accepts `singpassLogoSrc` for a deployer-supplied official asset. Do not go live with Singpass without it.
- **Security emails bypass the outbox.** With `SMTP_URL` set, invitations and password resets are sent directly by the identity code (no retry); without it they offer a copyable link. "Sign-in attempts blocked", "new MFA method" and "recovery code used" notices are not sent yet (neither in-app nor by email).
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

## Approvals and notifications (workflows workstream)

- **No module but profile changes submits requests yet.** Leave, claims, OT, timesheets, shift swaps and payroll register their `SubjectAdapter` when they land; until then Settings → Approvals lists those types as "Not in use yet".
- **Default policies are not stored per org.** Organisations without a saved policy use the built-in defaults at submission (same behaviour as seeding them); they are listed as "Default" in Settings → Approvals until edited.
- **Payroll-cutoff reminders** are off until the payroll change supplies its `ReminderSource` (task 4.3).
- **Out-of-office cover** is set from the Inbox (and by HR in Settings → Approvals), not from My profile.
- **Email templates are fixed in code** (spec non-goal); they carry the organisation name but not its logo yet.
- **Browser demo tick** is not wired (the demo does not exist); `createManualScheduler` is ready for it (task 5.4).
- **Inbox speed** is tested with 40 open tasks (< 1 s on PGlite), not benchmarked at 200 employees.
- **Work-pass reminders read the latest pass per employee**: a renewal must be added as a new pass (with a later expiry) to stop the old pass's reminders.

## Screens

- **Home** shows real work from `GET /api/v1/inbox`; its payroll card always says "Payroll isn't set up yet" until the payroll module supplies a source.
- **Command palette** "People" results come from the live directory (people module).
- **Every module** except People and Payroll (Leave, Attendance, Schedules, Claims, Documents, Reports) is an empty-state placeholder. Settings lists future sections as "Not available yet".
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
- **Scheduled backups** are checked on the shared in-process scheduler (`apps/server/src/scheduler.ts`, every 60 s with the workflows sweep) but stay in `apps/server`: `pg_dump` is Node-only, so the backup is a host job rather than a core `tick` sweep. One attempt per day; a failed attempt is retried the next day.
- **Restore restarts the app** by signalling PID 1 inside the container; under `docker compose run` (or outside Docker) it prints "restart the app" instead.
- **Self-hosting docs** are drafts in `docs/self-hosting/`; the docs site (`apps/docs`) does not exist yet.
- **Dependency audit**: `bun audit` reports one moderate, dev-only advisory (GHSA-67mh-4wv8-2f99, esbuild ≤ 0.24.2 dev server) via drizzle-kit's `@esbuild-kit` loader. It is never shipped or run as a server. CI fails on high/critical only.
- **CI has not run**: the workflow exists but nothing has been pushed.

## Organisation and people (add-organisation-and-people)

- **No first-run setup yet**, so a fresh server has no organisation or members to sign in with. The people screens are exercised by `packages/core/testing/people-dev-server.ts` (DEV ONLY, 127.0.0.1): the real app with real sessions, seeded with fictional staff, where `/__dev/as/<persona>` creates a session for a seeded member. The people e2e (`e2e/people/`) runs against it.
- **Invitations sent by an import** go out after the import is confirmed; without SMTP their one-time links are not shown, so HR resends them from Settings → Members (a single hire shows its link).
- **Legacy change-request decision endpoint**: `POST /api/v1/people/change-requests/:id/decision` (no screen uses it) still decides directly; it then closes the approval request so no task lingers. `GET /api/v1/people/inbox` duplicates what the Home inbox shows.
- **Payroll stand-in**: no period is ever finalised, so the retroactive-change guard only triggers in tests, and back-pay notices go nowhere.
- **Minimum employment age and default notice** come from `packages/sg-rules` (MOM-cited, rules from 1 Jan 2025): hires under 13 are refused (the Employment Act's family-only industrial undertaking exception is not supported; start dates before 2025 are not checked), and a resignation without a contractual notice period gets the statutory minimum by service. The under-16 conditions (light duties, MOM notification for industrial work, hour limits) are returned as warnings by `checkEmploymentAge` but not shown in the hire flow yet.
- **Personal-details change requests apply from the approval date only** (no future-dated personal details). Bank changes honour the approver's effective date.
- **Cancelling a scheduled hire or rehire** is not supported; record a termination instead.
- **Statutory lookups** (CSN payment types, rest-day rule, work pass types) are cited in `packages/core/src/organisation/statutory.ts` and should move to `packages/sg-rules`.
- **NRIC/bank reveal** (`POST /api/v1/employees/:id/nric/reveal`, `/bank/reveal`) has no web unit test: apps/web has no DOM test environment; it is covered by Playwright (`e2e/people/reveal.people.ts`).
- **Company logo** upload has an API only; there is no upload control on the Company screen yet.
- **Error codes** `duplicate_id_number`, `in_use`, `reporting_cycle` are sent as `409 conflict` with `details.reason` until they are added to `ERROR_STATUS`.

## Payroll (add-payroll)

- **Approvals are local until the workflows engine is wired**: `localPayrollApprovals` stores the request on the run and an owner or payroll admin decides with `POST /api/v1/payroll/runs/:id/decision` (the submitter cannot, except an owner, marked self-approved). No approval task, inbox item or notification is created. WS3 replaces `PayrollApprovals` and registers `payrollRunSubject` (`packages/core/src/payroll/approval.ts`).
- **Overtime, hours and no-pay leave are entered by hand** per run. `OvertimeSource` (attendance) and the leave module are not wired; `manualOvertimeOnly` is the default.
- **Claims reimbursement is NOT IMPLEMENTED in production**: `noClaimsYet` returns nothing payable until WS6 implements `ReimbursementSource`.
- **People's `PayrollPort`** (`lastFinalisedPeriodEnd`, `notifyBackPay`) still uses `noPayrollYet`; back pay is entered as a "Back pay" item.
- **No direct submission** to CPF Board, IRAS or banks (no public APIs): payroll produces the CPF EZPay (FTP) file and a generic ISO 20022 `pain.001.001.03` file for upload. The bank file is not a DBS, OCBC or UOB format (not public) and has not been tested with any bank; it validates against the official ISO 20022 XSD.
- **CPF EZPay file**: SHG for foreigners without an S/T account number is left out (keyed in EZPay by hand); a CPF shortfall on earlier AW is reported in the current month's CPF amount; an adjustment or off-cycle run produces a supplementary file with the next advice code. These choices are not confirmed by CPF Board.
- **Employee share of a CPF shortfall on earlier AW is not recovered from pay** (CPF Act s 7 not verified); the employer bears it and the run warns.
- **Employment Act deduction limits and payment deadlines** are cited in `packages/core/src/payroll/rules.ts` and should move to `packages/sg-rules`. Employee CPF counts toward the 50% limit (MOM does not list it as excluded; ambiguous).
- **Pro-ration** for shift schedules (no fixed week) assumes a Monday–Friday week and warns; part-time leave in hours is not handled.
- **FWL** is an estimate from org-level sector, tier and skill in payroll settings; MOM's bill is authoritative.
- **Adjustments do not recompute later months**: a reopened month after later months were finalised warns, and CPF's December (or last-month) AW recomputation absorbs the difference.
- **IR8A / Appendix 8A export is NOT IMPLEMENTED.**
- **Allowance CPF and pro-ration treatment** has an API (`/payroll/allowance-settings`) but no screen yet; the default is CPF-liable OW, pro-rated.
- **Payroll dev server**: like the people screens, payroll e2e and screenshots run against `packages/core/testing/payroll-dev-server.ts` (DEV ONLY, 127.0.0.1).
