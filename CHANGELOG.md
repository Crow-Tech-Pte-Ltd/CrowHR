# Changelog

All notable changes to Crow HR are recorded here. Versions follow [semantic versioning](https://semver.org/): the Docker image tags `1`, `1.x` and `1.x.y` move with it, and the `/api/v1` API stays additive-only within a major version.

## [Unreleased]

### Fixed

- **Payroll**: reopening a bonus run no longer pays the month's salary again; a second final-pay run for the same month is refused; same-month reviews and hourly rate changes within a period are handled ("Hours worked" takes the date worked).
- **Leave**: part-timers' unpaid leave in hours is deducted as hours, not days; open-ended carry-forward for Part 4 staff; per-child adjustments.
- **Approvals**: requests no longer get stuck after a manager change; no double HR approval; role removal, out-of-office cover and reassignment fixes. The Inbox treats anyone with tasks as an approver.
- **Everywhere**: another organisation's IDs answer 404 instead of 500; claims, documents, attendance and scheduling fixes.
- **Web app**: the demo opens on its own date; employees get the employee layout with the bottom tab bar; buttons only appear when you're allowed to use them; the command palette's Sign out signs out; payroll levy sector and tier are dropdowns; the leave balances report shows hours for part-timers; many accessibility fixes (page titles, headings, focus, contrast, screen-reader names).
- **Mobile apps** (next version): iOS session, punch-queue and leave fixes, approval details, approvals beside the list on iPad; Android keeps forms across rotation, accepts approximate location, asks for notification permission and fixes receipt orientation.

### Changed

- **Faster**: Home's inbox, leave balances, audit lookups and timesheets at 200 employees; payroll compute and submit; the sign-in page loads 143 kB of JavaScript instead of 251 kB; the server sends the web app's files pre-compressed.
- **API**: the 1.0 contract is frozen, and CI allows only additive changes.
- My profile → Mobile app links the Android app on Google Play.

## [1.0.0] - 2026-11-11

The first public release: free, MIT-licensed HR and payroll for Singapore SMEs that you host yourself.

Crow HR has **not yet been used for a real company's payroll**. Check its results before you pay or file, and read the [project status](https://hr.crow.sg/docs/status/) and the [known limitations](https://hr.crow.sg/docs/payroll/limitations/) (full list: [docs/limitations.md](docs/limitations.md)) before you rely on it.

### Included

- **Self-hosting**: one Docker image for amd64 and arm64 at `ghcr.io/crow-tech-pte-ltd/crowhr`, plus `postgres:17-alpine`. Install with `.env` + `docker compose up -d`; first-run setup wizard; automatic migrations with a lock; scheduled and manual backups (encrypted with `BACKUP_PASSPHRASE`) and restore; the `crowhr` CLI; Settings → System.
- **Sign-in and security**: email and password with TOTP two-step verification, Google Workspace, Microsoft Entra ID and generic OpenID Connect SSO, Singpass (tested against Singpass staging only), a server-enforced permission matrix and an append-only, hash-chained audit log.
- **People**: company structure, employee records with effective-dated history, CSV import, lifecycle events, work passes, self-service change requests.
- **Approvals and notifications**: approval policies, delegation and escalation, a Home work-to-do list, in-app and email notifications.
- **Leave, attendance and scheduling**: statutory and company leave types with accrual and carry-forward, clock in and out with an offline queue, timesheets and overtime claims, shift rosters with swaps and open shifts.
- **Claims**: claim types with caps, receipts, foreign currency at manual rates, reimbursement through payroll or outside it.
- **Payroll**: monthly, off-cycle and adjustment runs with CPF, SHG, SDL and an FWL estimate from cited, effective-dated rules (`packages/sg-rules`); payslips; the CPF EZPay file, an ISO 20022 bank file and an IR8A export to upload yourself. Nothing is submitted to CPF Board, IRAS or banks directly.
- **Documents and reports**: employee documents, HR letters and KETs from templates, acknowledgements; reports with CSV and XLSX export.
- **Optional error monitoring**: send errors, performance traces and logs to your own Sentry-compatible service (for example GlitchTip) by setting `SENTRY_DSN` / `SENTRY_BROWSER_DSN`. Off by default: without them the SDK is never loaded. Tokens, query strings, failed-query values, NRIC/FIN and email addresses are redacted, and nothing goes to Crow Tech.
- **API**: the versioned REST API (`/api/v1`) the web app uses, documented with OpenAPI.
- **Demo**: the same app running in your browser with a fictional company at [hr.crow.sg](https://hr.crow.sg).

### Not included yet

- The iOS app (iPhone and iPad, with iPad layouts: a sidebar, readable widths, payslips beside the list, Split View and Slide Over) and the Android app are built but not in the App Store or Google Play.
- Direct submission to CPF, IRAS or banks; virus scanning of uploads (a hook only; bring your own ClamAV).
- Production Singpass has not been tried, and the Singpass button needs the official logo, which you add yourself.
