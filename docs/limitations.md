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

- **Only profile changes, payroll runs and claims submit requests yet.** Leave, OT, timesheets and shift swaps register their `SubjectAdapter` when they land; until then Settings → Approvals lists those types as "Not in use yet".
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
- **Every module** except People, Payroll, Claims, Leave, Attendance and Schedules (Documents, Reports) is an empty-state placeholder. Settings lists future sections as "Not available yet".
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
- **Payroll dev server**: like the people screens, payroll e2e and screenshots run against `packages/core/testing/payroll-dev-server.ts` (DEV ONLY, 127.0.0.1).

## Claims (add-claims)

- **Money rule**: foreign lines convert as `roundHalfUp(amountMinor × rateMicros × 100 / (10^exponent × 10^6))` with BigInt, rounded once per line to the cent; the claim total is the sum of rounded lines (`packages/core/src/claims/money.ts`). Rates are manual (no FX feed), at most 6 decimal places.
- **ClamAV adapter NOT IMPLEMENTED** (task 3.4). The `FileScanner` hook (`deps.fileScanner`) and its `tick` sweep exist and are tested with a fake; without a scanner, receipts are stored as `unscanned` and owners see "scanning is off" in Settings → Claim types. `CLAMAV_HOST` is not read by the server yet.
- **Polyglot detection is heuristic**: HTML/script/SVG/PHP markers in the first kilobyte and a ZIP end-of-central-directory record near the end are refused. Downloads are always served with the detected type, `nosniff` and a sandbox CSP; PDFs and HEIC as attachments.
- **HEIC receipts** are accepted and stored but not previewed ("Preview not available. Download to view").
- **Approval type code**: the workflows engine takes one `typeCode`, so a claim with several types sends its largest type by SGD amount (first on a tie). A `typeCodes` policy condition therefore matches on that type only.
- **Reports NOT IMPLEMENTED in part** (task 4.1): totals by type/department/employee/month with GST, the line register and the payout register exist (JSON, CSV, XLSX); the per-employee cap-usage report and registration with the `reporting` module (not built yet) are open. Ageing is shown as "N days" on waiting claims in the admin table.
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
- **Encashment** is a ledger entry at year end (days only); paying it is payroll's job and is not wired.
- **Payroll inputs**: approved no-pay and unpaid infant care leave and approved OT reach the run automatically (payroll's port defaults). A manual `unpaid_leave` item on the same date, or a manual `days_worked` item, takes precedence over the fed one. Rostered staff's **scheduled days** come from published rosters (a manual `scheduled_days` item wins); attendance supplies days worked, only for staff who clock in.
- **NOT IMPLEMENTED: manager/executive flag.** Part 4 coverage (carry-forward floor) assumes nobody is a manager or executive, because employment records have no such field yet.
- **Scheduling conflicts**: leave approved after a roster was published notifies the roster's last publisher and hr_admins; the affected shifts show `on_leave` on the grid. Shifts are not removed automatically.
- **The NDR 2026 childcare changes** are recorded in sg-rules with no effective date and are not applied.

## Attendance (WS5)

- **NOT IMPLEMENTED: manager/executive flag.** Statutory (Part 4) OT assumes nobody is a manager or executive, because employment records have no such field yet. Hourly-rated staff are checked against a monthly equivalent (rate × weekly hours × 52 / 12).
- **Overnight work** is split at 04:00 SGT: an out punch before 04:00 closes the previous day's open shift; anything later starts a new day. A published overnight shift uses the same rule, so a shift ending after 04:00 splits its punches across two work dates.
- **Shift schedules**: on a date covered by a published roster, lateness, early out and OT are measured against the shift (its own break replaces the default break); work on an unrostered or rest day is all OT. Without a published roster there is no start time, so lateness and early-out are not computed, and OT is worked minutes beyond a fifth of the weekly hours. Fixed-week staff are always measured against their work schedule, even when they also appear on a roster.
- **Geolocation accuracy** comes from the browser; up to 50 m of the reported accuracy is credited towards an office radius. Location is spoofable on a rooted device; IP ranges are the stronger control.
- **Clock skew** is estimated as server time minus the device's send time, so slow networks add their latency to the estimate (default threshold 2 minutes; flags never block).
- **Rest-day and public-holiday base pay** is not passed to payroll; the OT feed carries OT minutes only, and payroll prices rest-day work from day rates.
- **Punches older than 7 days** are refused; a manager or HR adds them as corrections.

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
