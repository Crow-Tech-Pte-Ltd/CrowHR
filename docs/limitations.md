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

- **Only profile changes and payroll runs submit requests yet.** Leave, claims, OT, timesheets and shift swaps register their `SubjectAdapter` when they land; until then Settings → Approvals lists those types as "Not in use yet".
- **Default policies are not stored per org.** Organisations without a saved policy use the built-in defaults at submission (same behaviour as seeding them); they are listed as "Default" in Settings → Approvals until edited.
- **Payroll-cutoff reminders** (`payroll_cutoff`, 3 days before the cutoff day in payroll settings, or the pay day when none is set) go to active payroll admins until the month's regular run is approved.
- **Out-of-office cover** is set from the Inbox (and by HR in Settings → Approvals), not from My profile.
- **Email templates are fixed in code** (spec non-goal); they carry the organisation name but not its logo yet.
- **Browser demo tick** is not wired (the demo does not exist); `createManualScheduler` is ready for it (task 5.4).
- **Inbox speed** is tested with 40 open tasks (< 1 s on PGlite), not benchmarked at 200 employees.
- **Work-pass reminders read the latest pass per employee**: a renewal must be added as a new pass (with a later expiry) to stop the old pass's reminders.

## Screens

- **Home** shows real work from `GET /api/v1/inbox`; its payroll card lists open runs and the month's run when not started, or "Payroll isn't set up yet" before payroll settings are saved.
- **Command palette** "People" results come from the live directory (people module).
- **Every module** except People and Payroll (Leave, Attendance, Schedules, Claims, Documents, Reports) is an empty-state placeholder. Settings lists future sections as "Not available yet".
- **No dark mode.** The landing site's dark tokens were not ported.

## Platform

- **`packages/sg-rules`** implements effective-dated, cited rule tables and calculators for CPF (2025–2027 tables, OW/AW ceilings, SPR phases), SDL, SHG funds, FWL estimates, Employment Act Part IV coverage, overtime, rest-day and public-holiday pay, incomplete-month salary, annual and sick leave entitlements and the 2026–2027 public holidays. How it was checked is in `packages/sg-rules/VERIFICATION.md` (91/91 research vectors, all 16 CPF AW-ceiling examples, 15/15 cases against CPF's online calculator; `bun run check` enforces ≥ 95% line coverage). Its limits:
  - **CPF rates from 2028** are not published: the 2027 tables are carried forward with warning `CPF_RATES_ASSUMED_CARRIED_FORWARD`.
  - **Low-wage months (TW $50–$750) with AW above the ceiling** are refused (`CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED`); no official rule exists.
  - **Open CPF questions** (VERIFICATION.md "Open legal and design questions"): delayed AW across years, a known leaving month in the AW-ceiling projection, SPR F/G election timing, mid-month residency changes.
  - **Not encoded yet**: parental leave (maternity, paternity, shared parental, childcare, infant care, adoption), part-time leave in hours, income tax, IR21, CPF late-payment interest, work-pass salary thresholds.
  - **Overtime rounding** has no MOM rule; the default reproduces MOM's published example ($13.60/h cap for non-workmen).
- **Browser demo** (`apps/demo`, `packages/demo`) does not exist. Core's migrations are applied with Drizzle's filesystem migrator; the demo will need to bundle the SQL.
- **PGlite server mode** (`DATABASE_URL=pglite:…`) is for local development and e2e only: single process, no pooling, no backups.

## Self-hosting

- **Images are not published.** `docker-compose.yml` names `ghcr.io/crow-tech-pte-ltd/crowhr:1` (registry unconfirmed) and builds it from the checkout; publishing needs Daniel's approval. arm64 was verified once locally under QEMU (build, argon2, start against PostgreSQL 17); CI builds amd64 only.
- **Reverse proxies:** only Caddy is exercised by `e2e/self-host.sh` (HTTP, Caddy container on the compose network). The nginx, Traefik and Cloudflare Tunnel examples in the docs site's reverse-proxy page (`apps/docs/src/content/docs/self-hosting/reverse-proxy.md`) have not been run.
- **Scheduled backups** are checked on the shared in-process scheduler (`apps/server/src/scheduler.ts`, every 60 s with the workflows sweep) but stay in `apps/server`: `pg_dump` is Node-only, so the backup is a host job rather than a core `tick` sweep. One attempt per day; a failed attempt is retried the next day.
- **Restore restarts the app** by signalling PID 1 inside the container; under `docker compose run` (or outside Docker) it prints "restart the app" instead.
- **Dependency audit**: `bun audit` reports one moderate, dev-only advisory (GHSA-67mh-4wv8-2f99, esbuild ≤ 0.24.2 dev server) via drizzle-kit's `@esbuild-kit` loader. It is never shipped or run as a server. CI fails on high/critical only.
- **CI has not run**: the workflow exists but nothing has been pushed.

## Documentation site (apps/docs)

- **Not deployed.** It builds to static files for `https://hr.crow.sg/docs` (`base: /docs`), but nothing is published, and the repository URL used in install commands (`https://github.com/Crow-Tech-Pte-Ltd/crow-hr`) is a placeholder.
- **Placeholder contacts**: `security@crow.sg` (SECURITY.md) and `conduct@crow.sg` (CODE_OF_CONDUCT.md) are not confirmed.
- **Generated, not hand-kept**: the permission matrix and import-template columns are rendered from `packages/core` sources at build time, and the API reference from the OpenAPI snapshot. The configuration and CLI pages are hand-written and checked by `apps/docs/tests/` against the code.
- **SSO guides** describe the provider consoles from their public documentation; only the mock identity provider has been exercised. The Singpass guide's staging sign-in has not been done (identity task 8.3).
- **Starlight's `<Steps>` component is not used**: it renders with satteri, whose native binding cannot be resolved from Astro's prerender chunks under bun's isolated `node_modules`.

## Organisation and people (add-organisation-and-people)

- **No first-run setup yet**, so a fresh server has no organisation or members to sign in with. The people screens are exercised by `packages/core/testing/people-dev-server.ts` (DEV ONLY, 127.0.0.1): the real app with real sessions, seeded with fictional staff, where `/__dev/as/<persona>` creates a session for a seeded member. The people e2e (`e2e/people/`) runs against it.
- **Invitations sent by an import** go out after the import is confirmed; without SMTP their one-time links are not shown, so HR resends them from Settings → Members (a single hire shows its link).
- **Legacy change-request decision endpoint**: `POST /api/v1/people/change-requests/:id/decision` (no screen uses it) still decides directly; it then closes the approval request so no task lingers. `GET /api/v1/people/inbox` duplicates what the Home inbox shows.
- **Payroll guard**: a compensation change effective in a period with an approved or paid payroll run is refused unless it is marked retroactive; a retroactive change records a back-pay notice that the next run shows as a warning (the amount is entered as a "Back pay" item).
- **Minimum employment age and default notice** come from `packages/sg-rules` (MOM-cited, rules from 1 Jan 2025): hires under 13 are refused (the Employment Act's family-only industrial undertaking exception is not supported; start dates before 2025 are not checked), and a resignation without a contractual notice period gets the statutory minimum by service. The under-16 conditions (light duties, MOM notification for industrial work, hour limits) are returned as warnings by `checkEmploymentAge` but not shown in the hire flow yet.
- **Personal-details change requests apply from the approval date only** (no future-dated personal details). Bank changes honour the approver's effective date.
- **Cancelling a scheduled hire or rehire** is not supported; record a termination instead.
- **Statutory lookups** (CSN payment types, rest-day rule, work pass types) live in `packages/sg-rules/src/tables/registrations.ts` with citations; the 90-day work-pass reminder lead is a Crow HR default.
- **NRIC/bank reveal** (`POST /api/v1/employees/:id/nric/reveal`, `/bank/reveal`) has no web unit test: apps/web has no DOM test environment; it is covered by Playwright (`e2e/people/reveal.people.ts`).
- **Company logo** upload has an API only; there is no upload control on the Company screen yet.
- **Error codes** `duplicate_id_number`, `in_use`, `reporting_cycle` are sent as `409 conflict` with `details.reason` until they are added to `ERROR_STATUS`.

## Payroll (add-payroll)

- **Approvals** go through the workflows engine (`payroll_run` subject, default policy: an owner approves; an owner who submitted may self-approve, which is recorded). There is no payroll-specific decision endpoint.
- **Overtime, hours and no-pay leave are entered by hand** per run. `OvertimeSource` (attendance) and the leave module are not wired; `manualOvertimeOnly` is the default.
- **Claims reimbursement is NOT IMPLEMENTED in production**: `noClaimsYet` returns nothing payable until WS6 implements `ReimbursementSource`.
- **Back pay from people's retroactive changes** is flagged on the next run (`BACKPAY_OWED`) but not computed; the amount is entered as a "Back pay" item, and approving the run closes the notice.
- **No direct submission** to CPF Board, IRAS or banks: payroll produces the CPF EZPay (FTP) file and a generic ISO 20022 `pain.001.001.03` file for upload. IRAS's AIS API needs an approved software vendor and CorpPass authorisation, so IR8A is exported for manual upload (below).
- **Bank file is generic**: Singapore's SS611 standard adopts pain.001.001.03 and leaves the details to each bank, and banks publish guides (ANZ's Singapore MIG, for example), so service level (FAST or GIRO), charge bearer and 11-character BICs depend on the bank's profile. The file is not mapped to any bank's guide and has not been tested with any bank; it validates against the official ISO 20022 XSD.
- **CPF EZPay file** (not confirmed by CPF Board): SHG for foreigners (MBMF/SINDA/CDAC/ECF for non-SC/PR staff) is written as a summary record only; a CPF top-up on earlier AW is reported in the current month's amount with no new AW in that month's AW column; each run gets its own advice code (the regular run keeps the settings code, others the next free one) and a month past code 99 is refused rather than reusing a code.
- **AW top-up recovery** (CPF Act s 7(9)): the employee share may be deducted with a "CPF AW recovery" item up to 30 June of the following year; otherwise the employer bears it, shown as "Employee share absorbed" apart from statutory employer CPF. Remittance never waits for recovery. Recovery of other CPF arrears caused by the employer is blocked; the s 7(6A) route (non-negligent error, recovery with consent) and a waiver workflow for leavers' unrecoverable shares are not supported.
- **Deduction limits** (`packages/sg-rules`): accommodation, amenities and services share one 25% cap (EA s 30(2)); employee CPF and SHG count toward the 50% limit (s 32), which is lifted on final pay. Whether a deduction is one s 27 permits (and has the employee's consent) is HR's responsibility.
- **Payment deadlines**: salary is checked against 7 days after the period (EA s 21(1)) and each OT entry against 14 days after the salary period in which it was performed (s 21(2)). Interpretation Act s 50 (a deadline on a Sunday or public holiday moves to the next day) is not applied, so a run can be flagged a day early. Paying on a non-working day is allowed (s 25(2)) and only noted.
- **Pro-ration for staff without a fixed week** (rostered or shift): the run needs "Scheduled days" and "Days worked" items (EA s 20A) and blocks without them; Crow HR does not guess a week. Scheduled days will come from the attendance module later. A mid-month rate change and SPR graduated-to-full conversion are blocked for these staff. Part-time leave in hours, daily-rated and piece-rated pay (payslip units) are not handled.
- **FWL** is an estimate from org-level sector, tier and skill in payroll settings; MOM's bill is authoritative.
- **Adjustments do not recompute later months**: a reopened month after later months were finalised warns, and CPF's December (or last-month) AW recomputation absorbs the difference.
- **IR8A** is exported as CSV rows in the column layout of IRAS's IR8A import template (version 1.0), at most 200 records per part, to paste at row 6 of the template's IR8A sheet and import in myTax Portal. Crow HR does not fill or redistribute IRAS's workbook itself (its licence is unconfirmed), and **direct AIS-API submission is not available** (it needs IRAS's approval of the software, Corppass and APEX credentials and whitelisted servers). Filled from approved payslips plus YTD opening balances: basic pay after no-pay leave, overtime, back pay and "other earnings" go to (a), bonuses to (b) dated by their last pay date, allowances to d1, commissions to d2, employee CPF (with AW top-up recoveries) and SHG to the deduction columns. Not filled: residential address (not recorded), director's fees, d3 gratuity/notice pay (other earnings must be moved by hand), d6 excess employer CPF, tax borne by employer, remission or exempt income. Employees with an ID type other than NRIC/FIN or without a recorded sex are left out and listed; IR21-cleared leavers are only flagged. Back pay is reported in the year paid.
- **Appendix 8A and 8B are NOT IMPLEMENTED**: Crow HR records no benefits-in-kind or share plans, so the export says to fill those sheets by hand.
- **Allowance CPF and pro-ration treatment** has an API (`/payroll/allowance-settings`) but no screen yet; the default is CPF-liable OW, pro-rated.
- **Payslip release notifications** are not sent (found while writing the docs; the `payslip_released` notification kind exists; payroll does not emit it).
- **Payroll dev server**: like the people screens, payroll e2e and screenshots run against `packages/core/testing/payroll-dev-server.ts` (DEV ONLY, 127.0.0.1).
