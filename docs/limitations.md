# Known limitations

Everything listed here is stubbed, placeholder or missing. Nothing on this list
may be described as working. Remove an entry only in the change that fixes it.

## Authentication and access (identity workstream)

- **Singpass is not verified against real Singpass.** The FAPI 2.0 flow (PAR, PKCE, `private_key_jwt`, DPoP, encrypted ID tokens) is implemented to the published spec and tested only against the in-process mock IdP (`packages/core/testing/mock-oidc.ts`). Issuer defaults (`https://stg-id.singpass.gov.sg`, `https://id.singpass.gov.sg`) must be checked against the current Singpass docs. Tasks 8.3 (setup guide + manual staging sign-in) is open.
- **Singpass button is not brand-compliant yet.** Singpass's [button design specification](https://docs.developer.singpass.gov.sg/docs/getting-started/singpass-button-design-specification) (effective 1 Sep 2026) requires the official Singpass logo inside the button. The logo is not published under a licence that allows redistribution in this MIT repository, so it is not bundled; the button renders plain text "Log in with Singpass" (no imitation of the wordmark colouring). `ProviderButton` accepts `singpassLogoSrc` for a deployer-supplied official asset. Do not go live with Singpass without it.
- **Security notices** (new sign-in from an unknown browser, new app device, password changed or reset, reset link created, sign-in attempts blocked, two-step verification on/off/paused/reset, recovery code used, sign-in method linked/unlinked, app session ended by token reuse, sign-in settings changed to owners, JIT-provisioned members to HR) are in-app notifications for every install and, with `SMTP_URL`, emails through the retryable outbox (`packages/core/src/auth/security-notices.ts`). "New browser" relies on the known-device cookie, so clearing cookies reports the next sign-in again; a member's first sign-in is never reported. **Invitation and password-reset link emails are still sent directly**, not through the outbox: their links carry one-time tokens that are only ever stored hashed, so they are not queued and not retried; a failed send falls back to a link to copy (reset by an owner) or a resend. Without SMTP an owner must hand over reset links securely.
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

- **Only profile changes, payroll runs and claims submit requests yet.** Leave, OT, timesheets and shift swaps register their `SubjectAdapter` when they land; until then Settings → Approvals lists those types as "Not in use yet".
- **Default policies are not stored per org.** Organisations without a saved policy use the built-in defaults at submission (same behaviour as seeding them); they are listed as "Default" in Settings → Approvals until edited.
- **Payroll-cutoff reminders** (`payroll_cutoff`, 3 days before the cutoff day in payroll settings, or the pay day when none is set) go to active payroll admins until the month's regular run is approved.
- **Out-of-office cover** is set from the Inbox (and by HR in Settings → Approvals), not from My profile.
- **Email templates are fixed in code** (spec non-goal); they carry the organisation name but not its logo yet.
- **Browser demo tick** runs every 30 s and on navigation while a demo tab is open (`createManualScheduler` in the demo worker); nothing runs while no demo tab is open, so reminders and escalations catch up on the next visit.
- **Inbox speed** is tested with 40 open tasks (< 1 s on PGlite), not benchmarked at 200 employees.
- **Work-pass reminders read the latest pass per employee**: a renewal must be added as a new pass (with a later expiry) to stop the old pass's reminders.

## Screens

- **Home** shows real work from `GET /api/v1/inbox`; its payroll card lists open runs and the month's run when not started, or "Payroll isn't set up yet" before payroll settings are saved.
- **Command palette** "People" results come from the live directory (people module).
- **Every module** has real screens now (People, Payroll, Claims, Leave, Attendance, Schedules, Documents, Reports). Settings lists future sections as "Not available yet".
- **No dark mode.** The landing site's dark tokens were not ported.

## Platform

- **`packages/sg-rules`** implements effective-dated, cited rule tables and calculators for CPF (2025–2027 tables, OW/AW ceilings, SPR phases), SDL, SHG funds, FWL estimates, Employment Act Part IV coverage, overtime, rest-day and public-holiday pay, incomplete-month salary, annual and sick leave entitlements and the 2026–2027 public holidays. How it was checked is in `packages/sg-rules/VERIFICATION.md` (91/91 research vectors, all 16 CPF AW-ceiling examples, 15/15 cases against CPF's online calculator; `bun run check` enforces ≥ 95% line coverage). Its limits:
  - **CPF rates from 2028** are not published: the 2027 tables are carried forward with warning `CPF_RATES_ASSUMED_CARRIED_FORWARD`.
  - **Low-wage months (TW $50–$750) with AW above the ceiling** are refused (`CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED`); no official rule exists.
  - **Open CPF questions** (VERIFICATION.md "Open legal and design questions"): delayed AW across years, a known leaving month in the AW-ceiling projection, SPR F/G election timing, mid-month residency changes.
  - **Not encoded yet**: parental leave (maternity, paternity, shared parental, childcare, infant care, adoption), part-time leave in hours, income tax, IR21, CPF late-payment interest, work-pass salary thresholds.
  - **Overtime rounding** has no MOM rule; the default reproduces MOM's published example ($13.60/h cap for non-workmen).
- **Browser demo**: see "Public demo" below.
- **PGlite server mode** (`DATABASE_URL=pglite:…`) is for local development and e2e only: single process, no pooling, no backups.

## Self-hosting

- **Images are not published.** `docker-compose.yml` names `ghcr.io/crow-tech-pte-ltd/crowhr:1` (registry unconfirmed) and builds it from the checkout; publishing needs Daniel's approval. arm64 was verified once locally under QEMU (build, argon2, start against PostgreSQL 17); CI builds amd64 only.
- **Reverse proxies:** only Caddy is exercised by `e2e/self-host.sh` (HTTP, Caddy container on the compose network). The nginx, Traefik and Cloudflare Tunnel examples in the docs site's reverse-proxy page (`apps/docs/src/content/docs/self-hosting/reverse-proxy.md`) have not been run.
- **Scheduled backups** are checked on the shared in-process scheduler (`apps/server/src/scheduler.ts`, every 60 s with the workflows sweep) but stay in `apps/server`: `pg_dump` is Node-only, so the backup is a host job rather than a core `tick` sweep. One attempt per day; a failed attempt is retried the next day.
- **Restore restarts the app** by signalling PID 1 inside the container; under `docker compose run` (or outside Docker) it prints "restart the app" instead.
- **Dependency audit**: `bun audit` reports one moderate, dev-only advisory (GHSA-67mh-4wv8-2f99, esbuild ≤ 0.24.2 dev server) via drizzle-kit's `@esbuild-kit` loader. It is never shipped or run as a server. CI fails on high/critical only.
- **CI runs on GitHub-hosted runners** for now (private repo, free-plan minutes). The unit and integration suite is split into four shards because one 4-core runner takes over 15 minutes; a self-hosted runner with more cores can use fewer.

## Documentation site (apps/docs)

- **Not deployed.** It builds to static files for `https://hr.crow.sg/docs` (`base: /docs`), but nothing is published. The repository (`https://github.com/Crow-Tech-Pte-Ltd/CrowHR`) is private until Daniel approves making it public, so the install commands only work for collaborators until then.
- **Placeholder contacts**: `security@crow.sg` (SECURITY.md) and `conduct@crow.sg` (CODE_OF_CONDUCT.md) are not confirmed.
- **Generated, not hand-kept**: the permission matrix and import-template columns are rendered from `packages/core` sources at build time, and the API reference from the OpenAPI snapshot. The configuration and CLI pages are hand-written and checked by `apps/docs/tests/` against the code.
- **SSO guides** describe the provider consoles from their public documentation; only the mock identity provider has been exercised. The Singpass guide's staging sign-in has not been done (identity task 8.3).
- **Starlight's `<Steps>` component is not used**: it renders with satteri, whose native binding cannot be resolved from Astro's prerender chunks under bun's isolated `node_modules`.

## Organisation and people (add-organisation-and-people)

- **People dev server**: besides the first-run setup wizard, the people screens are exercised by `packages/core/testing/people-dev-server.ts` (DEV ONLY, 127.0.0.1): the real app with real sessions, seeded with fictional staff, where `/__dev/as/<persona>` creates a session for a seeded member. The people e2e (`e2e/people/`) runs against it.
- **Invitations sent by an import** go out after the import is confirmed; without SMTP their one-time links are not shown, so HR resends them from Settings → Members (a single hire shows its link).
- **No eligible approver**: explicit filer/beneficiary exclusions never fall back to self-approval. If every eligible member is excluded, the request stays pending; appoint an uninvolved approver, then withdraw and resubmit it. Role grants do not automatically re-resolve a chain with no open tasks.
- **Duplicate people inbox**: `GET /api/v1/people/inbox` still duplicates the Home inbox. The direct change-request decision endpoint has been removed; decisions use the approval engine.
- **Payroll guard**: a compensation change effective in a period with an approved or paid payroll run is refused unless it is marked retroactive; a retroactive change records a back-pay notice that the next run shows as a warning (the amount is entered as a "Back pay" item).
- **Minimum employment age and default notice** come from `packages/sg-rules` (MOM-cited, rules from 1 Jan 2025): hires under 13 are refused (the Employment Act's family-only industrial undertaking exception is not supported; start dates before 2025 are not checked), and a resignation without a contractual notice period gets the statutory minimum by service. The under-16 conditions (light duties, MOM notification for industrial work, hour limits) are returned as warnings by `checkEmploymentAge` but not shown in the hire flow yet.
- **Personal-details change requests apply from the approval date only** (no future-dated personal details). Bank changes through the approval engine apply on the approval date.
- **Cancelling a scheduled hire or rehire** is not supported; record a termination instead.
- **Statutory lookups** (CSN payment types, rest-day rule, work pass types) live in `packages/sg-rules/src/tables/registrations.ts` with citations; the 90-day work-pass reminder lead is a Crow HR default.
- **NRIC/bank reveal** (`POST /api/v1/employees/:id/nric/reveal`, `/bank/reveal`) has no web unit test: apps/web has no DOM test environment; it is covered by Playwright (`e2e/people/reveal.people.ts`).
- **Company logo** upload has an API only; there is no upload control on the Company screen yet.
- **Error codes** `duplicate_id_number`, `in_use`, `reporting_cycle` are sent as `409 conflict` with `details.reason` until they are added to `ERROR_STATUS`.

## Payroll (add-payroll)

- **Approvals** go through the workflows engine (`payroll_run` subject, default policy: an owner approves; an owner who submitted may self-approve, which is recorded). There is no payroll-specific decision endpoint.
- **Overtime, hours and no-pay leave are entered by hand** per run. `OvertimeSource` (attendance) and the leave module are not wired; `manualOvertimeOnly` is the default.
- **Claims reimbursement** comes from the claims module by default (`createClaimsReimbursementSource`); `noClaimsYet` is now only a test double.
- **Back pay from people's retroactive changes** is flagged on the next run (`BACKPAY_OWED`) but not computed; the amount is entered as a "Back pay" item, and approving the run closes the notice.
- **No direct submission** to CPF Board, IRAS or banks: payroll produces the CPF EZPay (FTP) file and a generic ISO 20022 `pain.001.001.03` file for upload. IRAS's AIS API needs an approved software vendor and CorpPass authorisation, so IR8A is exported for manual upload (below).
- **Bank file is generic**: Singapore's SS611 standard adopts pain.001.001.03 and leaves the details to each bank, and banks publish guides (ANZ's Singapore MIG, for example), so service level (FAST or GIRO), charge bearer and 11-character BICs depend on the bank's profile. The file is not mapped to any bank's guide and has not been tested with any bank; it validates against the official ISO 20022 XSD.
- **CPF EZPay file** (not confirmed by CPF Board): SHG for foreigners (MBMF/SINDA/CDAC/ECF for non-SC/PR staff) is written as a summary record only; a CPF top-up on earlier AW is reported in the current month's amount with no new AW in that month's AW column; each run gets its own advice code (the regular run keeps the settings code, others the next free one) and a month past code 99 is refused rather than reusing a code.
- **AW top-up recovery** (CPF Act s 7(9)): the employee share may be deducted with a "CPF AW recovery" item up to 30 June of the following year; otherwise the employer bears it, shown as "Employee share absorbed" apart from statutory employer CPF. Remittance never waits for recovery. Recovery of other CPF arrears caused by the employer is blocked; the s 7(6A) route (non-negligent error, recovery with consent) and a waiver workflow for leavers' unrecoverable shares are not supported.
- **Deduction limits** (`packages/sg-rules`): accommodation, amenities and services share one 25% cap (EA s 30(2)); employee CPF and SHG count toward the 50% limit (s 32), which is lifted on final pay. Whether a deduction is one s 27 permits (and has the employee's consent) is HR's responsibility.
- **Payment deadlines**: salary is checked against 7 days after the period (EA s 21(1)) and each OT entry against 14 days after the salary period in which it was performed (s 21(2)). Interpretation Act s 50 (a deadline on a Sunday or public holiday moves to the next day) is not applied, so a run can be flagged a day early. Paying on a non-working day is allowed (s 25(2)) and only noted.
- **Pro-ration for staff without a fixed week** (rostered or shift): the run needs "Scheduled days" and "Days worked" items (EA s 20A) and blocks without them; Crow HR does not guess a week. Scheduled days come from published rosters (scheduling's `ScheduledDaysSource`) when the whole period is published and the employee is employed for all of it; otherwise HR enters them. A mid-month rate change and SPR graduated-to-full conversion are blocked for these staff. Part-time leave in hours, daily-rated and piece-rated pay (payslip units) are not handled.
- **FWL** is an estimate from org-level sector, tier and skill in payroll settings; MOM's bill is authoritative.
- **Adjustments do not recompute later months**: a reopened month after later months were finalised warns, and CPF's December (or last-month) AW recomputation absorbs the difference.
- **IR8A** is exported as CSV rows in the column layout of IRAS's IR8A import template (version 1.0), at most 200 records per part, to paste at row 6 of the template's IR8A sheet and import in myTax Portal. Crow HR does not fill or redistribute IRAS's workbook itself (its licence is unconfirmed), and **direct AIS-API submission is not available** (it needs IRAS's approval of the software, Corppass and APEX credentials and whitelisted servers). Filled from approved payslips plus YTD opening balances: basic pay after no-pay leave, overtime, back pay and "other earnings" go to (a), bonuses to (b) dated by their last pay date, allowances to d1, commissions to d2, employee CPF (with AW top-up recoveries) and SHG to the deduction columns. Not filled: residential address (not recorded), director's fees, d3 gratuity/notice pay (other earnings must be moved by hand), d6 excess employer CPF, tax borne by employer, remission or exempt income. Employees with an ID type other than NRIC/FIN or without a recorded sex are left out and listed; IR21-cleared leavers are only flagged. Back pay is reported in the year paid.
- **Appendix 8A and 8B are NOT IMPLEMENTED**: Crow HR records no benefits-in-kind or share plans, so the export says to fill those sheets by hand.
- **Allowance CPF and pro-ration treatment** has an API (`/payroll/allowance-settings`) but no screen yet; the default is CPF-liable OW, pro-rated.
- **Payslip release notifications** go to each employee with an active sign-in when the run's payslips are released (in-app, and by email when SMTP is set; month and pay date only, no amounts).
- **Payroll dev server**: like the people screens, payroll e2e and screenshots run against `packages/core/testing/payroll-dev-server.ts` (DEV ONLY, 127.0.0.1).

## Claims (add-claims)

- **Money rule**: foreign lines convert as `roundHalfUp(amountMinor × rateMicros × 100 / (10^exponent × 10^6))` with BigInt, rounded once per line to the cent; the claim total is the sum of rounded lines (`packages/core/src/claims/money.ts`). Rates are manual (no FX feed), at most 6 decimal places.
- **ClamAV is optional and externally operated**: the server reads `CLAMAV_HOST` / `CLAMAV_PORT` and scans through INSTREAM on the existing upload sweep. Crow HR does not bundle clamd or FreshClam. Without configuration, uploads are explicitly unscanned.
- **Polyglot detection is heuristic**: HTML/script/SVG/PHP markers in the first kilobyte and a ZIP end-of-central-directory record near the end are refused. Downloads are always served with the detected type, `nosniff` and a sandbox CSP; PDFs and HEIC as attachments.
- **HEIC receipts** are accepted and stored but not previewed ("Preview not available. Download to view").
- **Approval type code**: the workflows engine takes one `typeCode`, so a claim with several types sends its largest type by SGD amount (first on a tie). A `typeCodes` policy condition therefore matches on that type only.
- **Reports**: registered with reporting as `claims.summary`, `claims.ageing`, `claims.cap_usage` (monthly and yearly caps; per-claim caps are checked on each claim and not listed), `claims.payouts` and `claims.lines`. Organisation scope only (no manager team view). The older `/claims/reports/*` export routes remain.
- **FX sanity warning NOT IMPLEMENTED**: the design's "rate deviates more than 20% from the last rate" warning to approvers is not built; approvers see the original amount, rate and SGD amount.
- **On-behalf claims**: owners and hr_admins can create claims for an employee through the API (`employeeId`); the web form only files claims for yourself.
- **Uploaded but unattached receipts** are kept until the uploader deletes them; there is no cleanup sweep.

## Leave (add-leave, WS5)

- **Leave year is the calendar year.** Annual leave is pro-rated by completed months in the first calendar year of service and the year of leaving; later years use the service year reached by 31 Dec. This is an interpretation of MOM's service-year rules for calendar leave years, explained on every balance.
- **No-pay leave and service**: whether a single unpaid day excludes a whole month is ambiguous in MOM's guidance; the org setting defaults to `whole_month` (a month counts as excluded only when every working day was no-pay leave).
- **Shift schedules**: dates in a week covered by the employee's published roster count only when they have a shift. Dates without a published roster still count every day except the gazetted holiday date, with a warning on the quote. Leave already applied for keeps the count from when it was applied, even if the roster is published or changed later. Parental leave assumes a 5-day week for shift workers.
- **Part-time leave in hours** rounds to 1 decimal place, matching MOM's examples; the regulation's own rounding could not be read (sg-rules warning `PT_LEAVE_ROUNDING_UNVERIFIED`). The comparable full-timer is the org's default fixed schedule unless Settings names another.
- **Government-paid leave claims** are not submitted (the MSF portal has no API). The report lists employer-paid and Government-paid days and the claim deadline; amounts are not computed. Shared parental leave weeks are shared between the parents as the employee declares; the other parent's usage is not known.
- **EA maternity leave** for a non-citizen child approximates "fewer than 2 living children" by birth order.
- **Encashment setup and corrections**: encashment uses effective basic pay plus fixed recurring allowances classified for the [MOM gross rate](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary). Active allowances require an explicit `grossRateIncluded` classification through the payroll settings API; there is no dedicated classification screen yet. A fixed workweek supplies the rate denominator; shift staff must supply contractual average workdays per week for the approver to verify. Pending requests can be withdrawn; approved payouts require a payroll correction. Existing requests retain their original rate snapshot, including requests made on the former basic-salary basis; correct those before paying if necessary.
- **Payroll inputs**: approved no-pay and unpaid infant care leave and approved OT reach the run automatically (payroll's port defaults). A manual `unpaid_leave` item on the same date, or a manual `days_worked` item, takes precedence over the fed one. Rostered staff's **scheduled days** come from published rosters (a manual `scheduled_days` item wins); attendance supplies days worked, only for staff who clock in.
- **Manager/executive flag**: Part 4 coverage (carry-forward floor) reads the flag on the employment record in force at year end. The flag is set by HR from the duties; Crow HR does not infer it from the job title or pay.
- **Scheduling conflicts**: leave approved after a roster was published notifies the roster's last publisher and hr_admins; the affected shifts show `on_leave` on the grid. Shifts are not removed automatically.
- **The NDR 2026 childcare changes** are recorded in sg-rules with no effective date and are not applied.

## Attendance (WS5)

- **Statutory (Part 4) OT** is never applied to employees flagged as a manager or executive on their employment record (HR sets the flag; it is not inferred from the job title). The CSV import has no column for it yet: set it on the profile after importing. Hourly-rated staff are checked against a monthly equivalent (rate × weekly hours × 52 / 12).
- **Overnight work** is split at 04:00 SGT: an out punch before 04:00 closes the previous day's open shift; anything later starts a new day. A published overnight shift uses the same rule, so a shift ending after 04:00 splits its punches across two work dates.
- **Shift schedules**: on a date covered by a published roster, lateness, early out and OT are measured against the shift (its own break replaces the default break); work on an unrostered or rest day is all OT. Without a published roster there is no start time, so lateness and early-out are not computed, and OT is worked minutes beyond a fifth of the weekly hours. Fixed-week staff are always measured against their work schedule, even when they also appear on a roster.
- **Geolocation accuracy** comes from the browser; up to 50 m of the reported accuracy is credited towards an office radius. Location is spoofable on a rooted device; IP ranges are the stronger control.
- **Clock skew** is estimated as server time minus the device's send time, so slow networks add their latency to the estimate (default threshold 2 minutes; flags never block).
- **Rest-day and public-holiday base pay** is not passed to payroll; the OT feed carries OT minutes only, and payroll prices rest-day work from day rates.
- **Punches older than 7 days** are refused; a manager or HR adds them as corrections.

## Public demo (packages/demo, apps/demo — WS8b)

The demo is the real web app and the real core API running in the visitor's browser (see docs/architecture.md "The public demo"). These behaviours exist only in the demo; the About page (`/about-demo`) lists them for visitors too.

- **Not deployed.** The Cloudflare Pages config, `_headers`, `_redirects` and the site build exist; deploying needs Daniel's approval (docs/deploy-demo.md).
- **Demo-only sign-in**: one-click personas (`/api/v1/auth/demo/*`, 404 outside demo mode), a shared password `kopi-kaki-demo` for every seeded account, and no MFA requirement (the demo org's `mfa_required_roles` is empty). Google, Microsoft and Singpass are seeded with placeholder client IDs so their buttons show; core refuses to start them in demo mode without any network call.
- **Email** goes to the "Demo outbox" (a `demo_outbox` table in the visitor's database), shown from the banner and the notifications popover. Nothing is sent.
- **Password hashing** is PBKDF2 (10,000 rounds, `$demo-pbkdf2$`), which a real server refuses. **Encryption at rest** uses a throwaway key included with the fictional build snapshot and stored in the same IndexedDB database as the data it protects; the browser-seeding fallback generates a fresh key (fine for fictional data; never a pattern for real data).
- **Clock**: the demo company lives on 31 Oct 2026. The demo clock maps the visitor's real time onto that date at the same Singapore time of day, then runs normally; reset re-anchors it. Without this, a visit months later would show October as a stale "current" run.
- **One tab at a time**: a Web Lock keeps a second tab from opening the same PGlite database (two writers would corrupt it); the second tab offers "Use it here instead".
- **Durability**: PGlite runs with relaxed durability; the worker writes the database back to IndexedDB after every state-changing request and after each scheduled tick. A tab killed mid-request can lose that one request.
- **Cookies** never reach the browser's cookie store. Browsers forbid script-set `Cookie` and script-read `Set-Cookie` headers, so the worker keeps a small cookie jar (persisted with the database) and the bridge captures `Set-Cookie` where Hono writes it. Core sees an ordinary cookie session (same CSRF and session code as the server); there is no bearer-token special case.
- **Non-fetch API requests** (receipt `<img>` previews, PDF/CSV download links, an API URL opened in a new tab) go through a service worker (`/demo-sw.js`) to the open demo tab. Where service workers are unavailable (e.g. some private-browsing modes), those previews and downloads fail; everything else works.
- **Seed shortcuts**: historical onboarding checklist items (from hires backdated to 2019–2025) are closed by one SQL update at seed time rather than one audited completion each, so the audit log has no entries for them. Everything else (hires, payroll runs, approvals, claims, leave, change requests) goes through the real services or the public API as the person who would do it.
- **Seed coverage**: October clock-ins follow published outlet rosters (including late arrivals); workflow-approved OT feeds the October draft. Current and next-week rosters, a pending manager shift swap, generated KETs, employee acknowledgements, an expiring fictional work-pass attachment and payroll cost reports are populated. July–September OT remains historical run input. The part-month joiner and leaver get explicit full-month denominators counted from the outlet roster because core's scheduled-days feed covers whole-month tenures. The YTD opening balances for January–June are deliberately not imported, so every run shows the `YTD_BEFORE_CROWHR_MISSING` warning, as it would for a company that moved to Crow HR mid-year.
- **Startup** restores a gzip PGlite snapshot generated at build time from the real migrations and seed, skipping initdb and seeding. Missing, corrupt or stale snapshots fall back to browser seeding. A seed-source/migration hash versions the asset and IndexedDB copy. The snapshot adds approximately 7.6 MiB to the first-visit download; optional language fonts load only when needed. Clock anchoring happens on first restore and reset; subsequent opens preserve it. Local first-visit median: 1.20 s versus 4.93 s before (three fresh Chromium contexts each; docs/deploy-demo.md records the method and samples).
- **Docs site under /docs** has a looser CSP than the app (`script-src 'unsafe-inline'` for Starlight's inline scripts); it holds no user data.
- **Name display**: demo accounts and people use preferred names (for example Jun Jie and Hafiz); legal names remain in payroll and statutory records.

## Scheduling (add-scheduling, WS5b)

- **No real-time collaboration.** Two editors on one roster see each other's changes on reload; editing a shift someone else changed answers 409 `stale`.
- **Hour warnings are planning checks only.** The 12-hour day, 44-hour week, rest-day and 72-hour monthly OT warnings use rostered paid time. The 72-hour projection counts rostered overtime only; approved OT claims are checked by attendance separately. Part 4 coverage is not checked: the warnings show for everyone.
- **Rest day**: one marked rest cell per week. Without one, the work schedule's rest day applies (fixed week), or Sunday (shift schedules). The rule that a non-Sunday rest-day roster must be issued before the month starts is not checked.
- **Pay implications** of rest-day and public-holiday shifts are shown as text from sg-rules; payroll does not price them from the roster.
- **Scheduled days for payroll** are omitted, and HR enters them, when any date of the period has no published roster for the employee or the employee joined or left during the period (MOM's denominator is the whole month). Days worked on an unrostered day count as worked in attendance's figure, so they can exceed the scheduled days and block the run (`ROSTER_DAYS_INVALID`) for HR to decide.
- **Swaps** stay within one roster. A shift with unpublished edits can't be offered until the roster is published again. Deleting a shift removes its swap requests, and both employees are notified.
- **Managers roster only their team** (matrix scope T), so a manager can't roster themselves; an owner or hr_admin can.
- **Open shifts** are picked up through approval only; there is no first-come auto-assignment.
- **Week grid**: drag moves a shift (no copy-drag); a cell holds several shifts but the keyboard shortcuts act on the first. Below 1400 px the chip drops the template code (it stays in the tooltip and the editor). At phone width the grid becomes a day list.
- **The approver's link** from a shift-swap task opens My schedule, not the roster week (the workflows link callback has no database access).
- **CSV export** is for editors only; staff see the published roster on screen.
## Reports (add-reporting, WS6b)

- **Report set is fixed**: headcount, headcount over time, joiners/leavers/turnover, work-pass expiry, leave taken, leave balances and liability, attendance exceptions, scheduled hours (published rosters), claims (summary, waiting by age, cap usage, payout register, line register) and payroll cost. No custom builder, saved views or scheduled reports (proposal non-goals).
- **Charts** are a single bar chart under the table, drawn from the rows on the current page only, and hidden when a label repeats (e.g. a month split by department). The table is the accessible view.
- **Exports** are streamed as CSV; XLSX is built in memory from 500-row batches (store-only ZIP, no compression). The runner holds at most 50 000 rows to sort; larger results answer 422 `too_many_rows`.
- **Payroll cost SDL by department** is an allocation: payroll rounds SDL once for the employer per month, and the report splits that total across departments by SDL-liable wages (largest remainder), so departments add up exactly but a department's SDL is not a statutory figure. FWL is payroll's estimate.
- **Leave liability** values available annual leave at the daily basic rate for monthly-rated staff only; hourly and daily-rated staff show none.
- **Manager scope** comes from the current reporting lines, not the lines in force on the report's dates.

## Documents (add-documents, WS6b)

- **Italic** in letter templates prints in the regular face (the embedded fonts have no italic). **Logo**: only sniffed PNG logos are accepted; legacy SVG logos must be re-uploaded as PNG.
- **No e-signature.** "I acknowledge" records the time, IP, user agent and the file's SHA-256; it is not a legally binding signature (proposal non-goal).
- **Contract terms Crow HR doesn't store** (main duties, fixed deductions, OT period and rate, other salary components, medical benefits, notice period when no notice is recorded, signatory title) are entered per document at generation and kept on the document version, not on the employee record.
- **Retention review** flags documents of ex-employees 12 months after the last working day (Employment Act; per-category months are configurable) and never deletes anything: HR keeps or soft-deletes, and only an owner purges. IRAS/CPF keeping periods were not researched (research §11.2, UNVERIFIED), so the default is the Employment Act minimum.
- **Expiry reminders** run on the existing reminders sweep: 30 days, 7 days and on the day, to hr_admins (owners when there is none) and to the employee for employee-visible categories. Home shows only acknowledgement requests; expiring documents are on Documents → Expiring.
- **DOCX/XLSX** are checked by package structure (OOXML parts present, no VBA project, macro sheets or ActiveX) and always downloaded, never previewed. Macro checks look at part names only; content is not inflated.
- **Employment letter requests** are approved by hr_admins by default and generated from the first active "employment certificate" template with the approver as signatory ("for and on behalf of the employer").

## Correctness review follow-up (1 Nov 2026)

- **API-only payroll inputs**: contractual fed OT amounts use an overtime item's `overtimeSourceId`; off-day holiday amounts for hourly/rostered staff use an `other_earning` item's `holidayDate`. Allowance `grossRateIncluded` must be classified for automatic daily gross pay and leave encashment. Dedicated UI controls are NOT IMPLEMENTED; the API paths are documented in the payroll settings guide. Fixed-week monthly holiday pay is automatic; other known off-day holiday amounts block until provided explicitly. Rest-day/public-holiday *work premiums* remain separate from the holiday entitlement fixed here.
- **Tax classifications**: taxable cash reimbursements enter IR8A d1 (including outside-payroll payments). New payrolls snapshot the flag; legacy snapshots and outside-payroll claims use the current type classification. Non-cash benefits, employer-borne tax, and determining any CPF liability of a taxable allowance remain the employer's responsibility. This change does not treat taxability as CPF liability.
- **PDF coverage**: Noto Sans SC and Tamil are loaded only when needed, subsetted per document. Characters outside the embedded fonts show `?` and a visible warning; other scripts still need font support. The font source/size record is in `packages/core/src/pdf/fonts.md`.
- **Bank correction workflow**: returning an approved unpaid run to draft is API-only; a later run relying on its CPF state may require an adjustment. Re-authentication and employee bank-change notifications are enforced on the server.
- **Audit integrity**: verification compares the event chain with `audit_heads` and detects tail truncation. A database superuser who rewrites both history and its head can still forge an internally consistent chain; external checkpoints are not implemented.
