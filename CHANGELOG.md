# Changelog

All notable changes to Crow HR are recorded here. Versions follow [semantic versioning](https://semver.org/): the Docker image tags `1`, `1.x` and `1.x.y` move with it, and the `/api/v1` API stays additive-only within a major version.

## [Unreleased]

## [1.1.0] - 2026-11-13

Timesheet approval, IR8A Appendix 8A and 8B, demo companies for trying the mobile apps, dark mode, and many payroll, leave and approval fixes. Upgrading from 1.0.0 is `docker compose pull && docker compose up -d`: five migrations (`0017`–`0021`) run on the first start, after an automatic backup. The `/api/v1` API only gained things; the 1.0.0 iOS and Android apps keep working.

Check its results before you pay or file, and read the [project status](https://hr.crow.sg/docs/status/) and the [known limitations](https://hr.crow.sg/docs/payroll/limitations/) (full list: [docs/limitations.md](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/blob/main/docs/limitations.md)).

### Added

- **Timesheet approval** (optional, off by default; Settings → Attendance): employees, or their managers, submit each month, half month or week for approval through the usual approval chains; managers approve or return it with a comment. An approved period is locked: punches, manager corrections and new overtime claims are refused, and an HR correction reopens it (audited, employee notified). Payroll can be set to take overtime and days worked only from approved timesheets. New API: `/api/v1/attendance/timesheets`.
- **Payroll → Year end**: record benefits-in-kind (IR8A Appendix 8A: housing, hotel stays, cars, home leave passages and other benefits) and share-plan gains (Appendix 8B) per employee. Crow HR values housing, cars, drivers and share gains with IRAS's formulas, shows the working, and adds IR8A d7 and d8. The IR8A download gains the template's Appendix 8A and 8B sheets for each part.
- **Payroll → Allowance treatment**: CPF liability, pro-ration and the Employment Act gross rate of pay per allowance type, with MOM and CPF guidance. Every run warns while an allowance it pays has no gross-rate answer, so a public holiday on an off day no longer blocks the run months after go-live. Every blocking issue, and leave encashment's question about an allowance, links to the screen that fixes it; an approved, unpaid run can go back to draft with a reason.
- **Demo companies** for a public demo server (`DEMO_COMPANIES=1`, off by default; never on a company's own install): anyone can open `/try`, get a private copy of the fictional Kopi Kaki in one tap and sign in by picking a person, in the browser and in the 1.0.0 mobile apps (link or QR code). Each copy is deleted with everything in it after 72 hours. Starts are limited per network (an IPv4 address or an IPv6 /48), per server per hour and in total; the limits keep counts only, never an address. Crow Tech runs one at [hr-demo.crow.sg/try](https://hr-demo.crow.sg/try). See [configuration](https://hr.crow.sg/docs/self-hosting/configuration/#demo-companies).
- **Sign-in email**: members change their own sign-in email, confirmed from a link sent to the new address (the old one is told). Needs SMTP; without it the web app says why it can't.
- **Organisations**: a switcher in the account menu for people in more than one organisation, and a company logo upload in Settings → Company.
- **Claims**: owners and HR file a claim for an employee from the web form; a warning when a claim's exchange rate is more than 20% from the organisation's last rate for that currency; receipts uploaded but never attached are deleted after 7 days.
- **Dark mode**: Theme (System, Light or Dark) in the account menu, kept per browser. Payslips and letters stay black on white.
- **Hiring and import**: the under-16 conditions appear on the hire form as soon as the dates are known; CSV import takes optional `workman` and `manager_or_executive` columns (Part 4 of the Employment Act).

### Fixed

- **Payroll**: reopening a bonus run no longer pays the month's salary again; a second final-pay run for the same month is refused; same-month reviews and hourly rate changes within a period are handled ("Hours worked" takes the date worked).
- **Leave**: part-timers' unpaid leave in hours is deducted as hours, not days; open-ended carry-forward for Part 4 staff; per-child adjustments.
- **Approvals**: requests no longer get stuck after a manager change; no double HR approval; role removal, out-of-office cover and reassignment fixes. The Inbox treats anyone with tasks as an approver.
- **Everywhere**: another organisation's IDs answer 404 instead of 500; claims, documents, attendance and scheduling fixes; claim numbers sort as numbers (C-9999 before C-10000).
- **Web app**: employees get the employee layout with the bottom tab bar; buttons only appear when you're allowed to use them; the command palette's Sign out signs out; payroll levy sector and tier are dropdowns; the leave balances report shows hours for part-timers; many accessibility fixes (page titles, headings, focus, contrast, screen-reader names).

### Changed

- **A calmer look**: a plain one-column sign-in page showing only the methods the organisation has enabled; consistent labels, plain empty states and status chips only where the status matters; payroll says each figure once; every date field uses the same date picker.
- **Faster**: Home's inbox, leave balances, audit lookups and timesheets at 200 employees; payroll compute and submit; the sign-in page loads 143 kB of JavaScript instead of 251 kB; the server sends the web app's files pre-compressed.
- **API**: contract version 1.1, additive only against 1.0 (CI checks it). New: timesheets, IR8A appendices, sign-in email change, `GET /api/v1/me/organisations`, demo companies, optional paging of `GET /api/v1/documents`, `fxWarning` on claim lines and references on payroll issues.
- **The in-browser demo** at [hr.crow.sg](https://hr.crow.sg) opens on its own date, looks lived in (opening balances imported, allowances classified) and links to the demo-company try page for the phone apps.
- My profile → Mobile app links the apps on Google Play and the App Store (iPhone and iPad, live since 13 Nov 2026).

### Mobile apps (in the repository, not yet in the stores)

The App Store and Google Play apps stay 1.0.0 and work with this server. The next app version, built from this repository, adds:

- **Both apps**: leave for a child, the team calendar, shift swaps and open shifts, the exchange-rate warning on claims, and notifications that open their item. The iOS app also takes claims in several currencies with several lines, as Android already did.
- **Clock-in**: a punch's time is the moment you tap, not when the location fix arrived; on iPhone, unsent punches are no longer lost when iOS had started the app in the background; on Android, leaving the Clock tab straight after a tap no longer drops the punch.
- **iOS**: session, punch-queue and leave fixes, approval details, approvals beside the list on iPad; no redirects to other hosts; a session you switched away from can't sign out the one in use; receipt photos are prepared off the main thread.
- **Android**: claim drafts (change, submit, withdraw, copy); forms survive rotation; approximate location accepted; asks for notification permission; receipt orientation fixed; each stored value decrypted once; the session renewed a minute before it expires; a tab's last content shown at once while it reloads.

## [1.0.0] - 2026-11-11

The first public release: free, MIT-licensed HR and payroll for Singapore SMEs that you host yourself.

Check its results before you pay or file, and read the [project status](https://hr.crow.sg/docs/status/) and the [known limitations](https://hr.crow.sg/docs/payroll/limitations/) (full list: [docs/limitations.md](docs/limitations.md)) before you rely on it.

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
