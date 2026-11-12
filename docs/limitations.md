# Known limitations

What Crow HR doesn't do, or does only in part, so nothing here gets described as working. Users get
the same facts where they need them on the documentation site (the
[project status](https://hr.crow.sg/docs/status/) page and each module's guide). Remove an entry in
the change that fixes it.

## Sign-in and security

- **Singpass is tested against Singpass staging only** (FAPI 2.0: PAR, PKCE, `private_key_jwt`, DPoP,
  encrypted ID token). Production Singpass has not been tried. Singpass's
  [button specification](https://docs.developer.singpass.gov.sg/docs/getting-started/singpass-button-design-specification)
  requires its official logo, which can't be redistributed in this repository: whoever runs the
  server adds it (`<DATA_DIR>/branding/singpass-logo.svg` or `.png`; `VITE_SINGPASS_LOGO_SRC` for the
  demo). Without it the button is plain text and not compliant, so don't go live with Singpass
  without it. Behind Cloudflare Bot Fight Mode, Singpass can't fetch the JWKS URL; paste a JWKS object
  in the Singpass portal instead.
- **Google Workspace and Microsoft Entra ID** have been tested against the mock identity provider
  only, not the real services.
- **Invitation and password-reset emails are sent directly**, not through the retryable outbox: their
  one-time links are stored only hashed, so a failed send isn't retried; HR copies the link or
  resends. Security notices (new browser or device, password and two-step changes, blocked
  attempts) go through the outbox. A member's first sign-in is never reported, and clearing cookies
  makes the next sign-in look like a new browser.
- **Common passwords** are a curated list of a few hundred entries plus patterns, not a breach corpus.
- **No email change**: a member's email address can't be changed.
- **Organisation switcher**: the web app shows only the current organisation, although the API can
  switch (`POST /api/v1/auth/switch-organisation`).
- **No row-level security**: tenant isolation is enforced by the application (org-scoped queries)
  and composite foreign keys, with a test that every route refuses another organisation's IDs.
- **Audit integrity**: verification compares the hash chain with `audit_heads` and detects a
  truncated tail, but a database superuser who rewrites both the history and its head can forge a
  consistent chain. There are no external checkpoints.

## Approvals and notifications

- **Timesheet approval is not in use**: no module submits timesheets (managers and HR correct
  attendance directly). Settings → Approvals lists the type as "Not in use yet".
- **No eligible approver**: filer and beneficiary exclusions never fall back to self-approval. If every
  eligible member is excluded, the request stays pending; appoint an uninvolved approver, then
  withdraw and resubmit. Granting a role doesn't re-resolve a chain with no open tasks.
- **Email templates are fixed in code**; they carry the organisation's name, not its logo.
- **Work-pass renewals** must be added as a new pass with a later expiry; reminders read each
  employee's latest pass.
- **Lock order on PostgreSQL** (not fixed, not reproducible on PGlite): the escalation sweep locks due
  tasks before their request while decisions lock the request first, and cancelling or expiring a
  shift swap locks the swap first while approving it locks the request first. A decision at the same
  moment can deadlock: PostgreSQL aborts one side, which answers 500 (a retry works) or, for the
  sweep, marks those tasks escalated without escalating them. A bulk decision answers 500 for the
  whole batch when one decision fails with a non-domain error, although earlier decisions in the
  batch were committed.

## People

- **Invitations from an import** go out once the import is confirmed; without SMTP their links are
  not shown, so HR resends them from Settings → Members.
- **Hire age checks**: hires under 13 are refused and start dates before 2025 are not checked. The
  Employment Act's family-only exception is not supported, and the under-16 conditions (light
  duties, MOM notification for industrial work, hour limits) are computed but not shown in the hire
  flow.
- **Personal-details changes apply from the approval date**; future-dated personal details aren't
  supported.
- **A scheduled hire or rehire can't be cancelled**; record a termination instead.
- **Company logo**: there's an API but no upload control on the Company screen.
- **CSV import** has no column for the manager/executive flag (Part 4); set it on the profile after
  importing.
- **Duplicate inbox endpoint**: `GET /api/v1/people/inbox` repeats part of the Home inbox (kept for
  API compatibility).
- **Error codes** `duplicate_id_number`, `in_use` and `reporting_cycle` are sent as `409 conflict`
  with `details.reason`.

## Payroll

- **No direct submission** to CPF Board, IRAS or banks. Payroll produces the CPF EZPay file, an ISO
  20022 `pain.001.001.03` bank file and the IR8A rows for you to upload. IRAS's AIS API needs an
  approved software vendor, Corppass and APEX credentials.
- **The bank file is generic**: SS611 leaves service level (FAST or GIRO), charge bearer and BIC
  details to each bank. It validates against the ISO 20022 schema but is not mapped to any bank's
  guide and hasn't been tested with a bank.
- **CPF EZPay file** (not confirmed by CPF Board): SHG for staff who aren't citizens or PRs is a summary
  record only; a top-up on earlier AW is reported in the current month's amount with no AW in that
  month's AW column; each run gets its own advice code, and a month past code 99 is refused.
- **IR8A** is exported as rows in the column layout of IRAS's IR8A import template (version 1.0), at
  most 200 records per part, to paste into the template and import in myTax Portal. Not filled:
  residential address, director's fees, d3 gratuity and notice pay, d6 excess employer CPF, tax
  borne by the employer, remission and exempt income. Employees with another ID type or without a
  recorded sex are left out and listed; IR21-cleared leavers are only flagged.
- **Appendix 8A and 8B are not implemented**: Crow HR records no benefits-in-kind or share plans.
- **Back pay** from a retroactive pay change is flagged on the next run (`BACKPAY_OWED`) but not
  computed: enter it as a "Back pay" item.
- **Hours for hourly staff** and other one-off items are entered per run. Hours are paid at the rate
  in force on the date worked, so split them at a rate change; undated hours in a period with a
  change block the run.
- **Pro-ration without a fixed week** (rostered or shift staff) needs "Scheduled days" and "Days
  worked" (EA s 20A); scheduled days come from published rosters only when the whole period is
  published and the person was employed throughout. A mid-month rate change and an SPR
  graduated-to-full change are blocked for these staff. Daily-rated and piece-rated pay are not
  handled.
- **Allowance types and recurring allowances** are added through the API only (allowance types, then
  `allowances` on hire and pay-change events); the web app shows them on the Pay tab and sets their
  treatment in Payroll → Allowance treatment.
- **The gross rate of pay has no default** for an allowance: every run warns
  (`ALLOWANCE_GROSS_RATE_UNSET`) until each allowance paid in it is classified, and an off-day public
  holiday blocks payroll for the staff who get an unclassified one.
- **Off-day holiday pay for hourly or rostered staff** is entered on the run (one day's gross pay per
  holiday); it is computed only for monthly-rated staff on a fixed week.
- **CPF AW top-up recovery** (CPF Act s 7(9)) can be deducted up to 30 June of the following year;
  otherwise the employer bears it. Recovering other employer-caused arrears, the s 7(6A) route and
  waivers for leavers are not supported. An adjustment of a run with an absorbed share can offer that
  share for recovery twice (not fixed): enter the recovery amount explicitly on adjustments.
- **Payment deadlines** don't apply the Interpretation Act's next-working-day rule, so a run can be
  flagged a day early.
- **Deductions**: whether a deduction is one the Employment Act permits, with the employee's
  consent, is HR's responsibility; Crow HR checks the 25% and 50% limits only.
- **FWL** is an estimate from the organisation's sector, tier and skill; MOM's bill is authoritative.
- **Adjustments don't recompute later months**: reopening a month after later months are final warns,
  and CPF's year-end AW recomputation absorbs the difference.
- **Tax classification**: non-cash benefits, employer-borne tax and the CPF treatment of a taxable
  allowance remain the employer's call.
- **PDF scripts**: Latin, Chinese and Tamil are embedded; other characters print as `?` with a
  warning (`packages/core/src/pdf/fonts.md`).

## Claims

- **Exchange rates are manual** (no rate feed, at most 6 decimal places), and approvers get no warning
  when a rate is far from the last one used.
- **On-behalf claims**: owners and HR admins can file a claim for an employee through the API only;
  the web form files claims for yourself.
- **Receipts uploaded but never attached** are kept until the uploader deletes them.
- **Claim numbers sort as text**: after C-9999, C-10000 sorts before C-9999.
- **HEIC receipts** are stored but not previewed.
- **Approval policies see one claim type**: a claim with several types is routed by its largest type
  by SGD amount.
- **Claims reports** cover the whole organisation; there's no manager team view. Per-claim caps are
  checked on each claim but not listed in the cap report.
- **Virus scanning** needs your own ClamAV (`CLAMAV_HOST`); none ships with Crow HR. Polyglot
  detection is heuristic.

## Leave

- **The leave year is the calendar year.** Annual leave is pro-rated by completed months in the first
  calendar year of service and the year of leaving, an interpretation of MOM's service-year rules
  explained on every balance.
- **No-pay leave and service**: MOM's guidance is ambiguous on whether one unpaid day excludes a whole
  month; the default counts a month as excluded only when every working day was no-pay leave.
- **Shift workers**: a day counts only when the published roster has a shift; without a published
  roster every day except the holiday counts, with a warning. Parental leave assumes a 5-day week for
  shift workers.
- **Part-time leave in hours** rounds to 1 decimal place, as MOM's examples do; the regulation's own
  rounding couldn't be confirmed.
- **Government-paid leave** is not claimed from the Government (the portal has no API): the report lists
  the days and deadlines, without amounts. The other parent's shared parental leave isn't known.
- **EA maternity leave** for a child who isn't a citizen approximates "fewer than 2 living children" by
  birth order.
- **The 2026 National Day Rally childcare changes** are recorded without an effective date and not
  applied.
- **Encashment** for shift staff needs their contractual average workdays per week; approved payouts
  need a payroll correction to undo.
- **The manager/executive flag** (Part 4 carry-forward floor) is set by HR; it's not inferred.
- **Not fixed:**
  - Counted days are fixed when leave is applied for: a holiday added later doesn't recount it. Cancel
    and re-apply.
  - Changes after a leave year is closed stay in that year (a December request decided in January,
    for example); fix with a balance adjustment.
  - A leaver's unused leave can be encashed only in the calendar year they left.
  - A change between part-time and full-time mid-year mixes hours and days in one balance.
  - Carry-forward expiry longer than 12 months has no effect once the next year is closed.
- **Roster conflicts**: leave approved after a roster is published notifies the publisher and HR;
  the shift isn't removed.

## Attendance

- **Part 4 overtime** is never applied to staff flagged as managers or executives.
- **Overnight work** is split at 04:00: a clock-out before 04:00 closes the previous day's shift. A
  clock-in after midnight (back from a break) starts the next day.
- **Without a published roster** there's no start time, so lateness and early out aren't computed for
  shift staff.
- **Location** comes from the device and can be spoofed on a rooted phone; office IP ranges are the
  stronger check.
- **Clock skew** includes network latency (default threshold 2 minutes; flags never block).
- **Rest-day and public-holiday base pay** isn't passed to payroll; the overtime feed carries
  overtime only.
- **Punches older than 7 days** are refused; a manager or HR adds them as corrections.
- **Corrections don't re-date earlier punches** (not fixed): a corrected 22:00 clock-in doesn't pick
  up a lone 02:00 clock-out already dated the next day. Void the clock-out and add it again.

## Scheduling

- **No real-time collaboration**: editors see each other's changes on reload, and editing a shift
  someone else changed answers 409.
- **Hour warnings are planning checks** on rostered time, shown for everyone (Part 4 coverage isn't
  checked).
- **Rest days**: one marked rest cell per week, else the work schedule's or Sunday. The rule that a
  non-Sunday rest-day roster must be issued before the month starts isn't checked.
- **Pay implications** of rest-day and holiday shifts are shown as text; payroll doesn't price them
  from the roster.
- **Swaps** stay within one roster, and a shift with unpublished edits can't be offered.
- **Open shifts** are picked up through approval only.
- **Managers roster only their team**, so they can't roster themselves.
- **Overlapping roster scopes** (not fixed): someone in two rosters' scopes for one week, where only the
  one without them is published, counts as off all week. Keep each person on one roster per week.
- **The week grid** moves shifts by drag (no copy-drag), and keyboard shortcuts act on the first shift
  in a cell.
- **A shift-swap approval task** links to My schedule, not the roster week.
- **CSV export** is for roster editors only.

## Documents

- **No e-signature**: "I acknowledge" records the time, IP address, browser and the file's SHA-256; it
  isn't a binding signature.
- **Italic** in letter templates prints upright (the embedded fonts have no italic). Logos must be PNG.
- **Retention** defaults to the Employment Act minimum (12 months after the last day); IRAS and CPF
  keeping periods weren't researched. Nothing is deleted automatically.
- **Word and Excel files** are checked by structure (no macros) and always downloaded, never
  previewed.
- **Default categories and templates come back** (not fixed): a deleted default category or a renamed
  default template reappears when the server restarts. Archive or edit them instead.
- **Acknowledgement requests for replaced versions** stay listed as outstanding; ask again after
  replacing a file.
- **The document list isn't paginated.**

## Reports

- **The report set is fixed**: no custom builder, saved views or scheduled reports.
- **Charts** draw the current page's rows only and are hidden when a label repeats; the table is the
  accessible view.
- **Exports** hold at most 50,000 rows; XLSX is built in memory without compression.
- **SDL by department** is an allocation of the employer's total, not a statutory figure.
- **Leave liability** values annual leave for monthly-rated staff only.
- **Manager scope** uses today's reporting lines, not those in force on the report's dates.

## Statutory rules (`packages/sg-rules`)

How the rules were checked is in `packages/sg-rules/VERIFICATION.md`.

- **CPF rates from 2028** aren't published: the 2027 tables carry forward with a warning.
- **Low-wage months** (total wages $50 to $750) with AW above the ceiling are refused; no official rule
  covers them.
- **Open CPF questions** (listed in VERIFICATION.md): delayed AW across years, a known leaving month in
  the AW-ceiling projection, SPR election timing, mid-month residency changes.
- **Not encoded**: income tax, IR21, CPF late-payment interest and work-pass salary thresholds.
- **Overtime rounding** has no MOM rule; the default reproduces MOM's published example.

## Self-hosting

- **Pull-request CI** builds and tests the amd64 image only; arm64 is built and smoke-tested when a
  version is released.
- **Reverse proxies**: the Caddy, nginx and Traefik examples are tested automatically with test
  certificates, so getting and renewing Let's Encrypt certificates isn't. Cloudflare Tunnel in front of
  Traefik was tested by hand; the tunnel-straight-to-app example hasn't been run.
- **Scheduled backups** try once a day; a failed attempt is retried the next day.
- **Restore** restarts the app by signalling the container's main process; outside Docker it asks you
  to restart instead.
- **Dependency audit**: one moderate advisory in a development-only tool (esbuild's dev server through
  drizzle-kit), never shipped.
- **PGlite server mode** (`DATABASE_URL=pglite:…`) is for development and tests only.
- **Performance** is measured on PGlite in process (`packages/core/scripts/bench-hot-paths.ts`), not on
  PostgreSQL or under concurrent load.

## Public demo

The demo (https://hr.crow.sg) is the real web app and API running in the visitor's browser; see
`docs/architecture.md`. What differs from a real install:

- **Sign-in** is one click per persona, or the shared password `kopi-kaki-demo`, without two-step
  verification. The SSO buttons explain they're unavailable, and Singpass works only when the build
  is configured for the demo's Singpass round trip.
- **Email** goes to the demo outbox; nothing is sent.
- **Passwords** use a demo-only hash a real server refuses, and the encryption key is stored with the
  data. Fine for fictional data, never a pattern for real data.
- **The clock** shows 31 Oct 2026 at the visitor's Singapore time of day.
- **One tab at a time** can open the demo company.
- **A tab closed mid-request** can lose that request.
- **Downloads and receipt previews** need a service worker; where there is none (some private modes),
  they fail.
- **History**: past onboarding checklist items are closed at seed time without audit entries, and the
  year-to-date balances for January to June are deliberately missing, so payroll shows that warning.
- **The docs** under `/docs` allow inline scripts; they hold no user data.
- **Deployed by hand**: a change reaches hr.crow.sg only when a maintainer deploys it
  (`docs/deploy-demo.md`).

## Mobile apps

- **No remote push**: the apps refresh in the background and show local notifications, so Crow Tech
  needs no push service that would see your data.
- **Done on the web, not in the apps**: the leave team calendar, shift swaps and open shifts. On
  iOS also leave types that need a child, foreign-currency and multi-line claims. On Android also
  leave types that need a child, and editing, submitting, withdrawing or copying a saved claim draft.
- **The "Data Not Collected" store answers** haven't had a legal review.
- **Not covered by automated tests**: the camera (QR scanning and receipts), Face ID and Touch ID,
  the system browser's sign-in page, the Android permission prompts (their decision logic is
  unit-tested), and iPad Split View, Slide Over and Stage Manager resizing.
- **Accessibility**: Xcode's accessibility audit is clean on iPhone and iPad, but the manual
  VoiceOver and Dynamic Type pass on a real iPhone is still to do.

## Demo companies

- **Not switched on anywhere yet.** `DEMO_COMPANIES` is off by default. Until a demo server runs with
  it, the docs say the try page opens soon (`TRY_LIVE` in `apps/docs/src/lib/links.ts`) and the
  in-browser demo shows no try link (`VITE_TRY_URL`). Seeding was measured on a workstation with the
  same CPU as the intended demo server, not on that server.
- **Seeding slows over time.** A copy is the sample company's June–October 2026 history plus a
  catch-up to the seeding day (rosters, clocked shifts, fresh requests), which grows every day:
  about 18 s per copy in November 2026. No payroll runs exist after October until a visitor makes
  one.
- **Memory**: each seed runs in its own in-memory PGlite. With PostgreSQL the app went from about
  320 MB to a peak of about 1.1 GB during a seed and stayed near 950 MB after. One seed runs at a
  time per process; several replicas each keep their own pool.
- **The 1.0.0 apps** need a sign-in method in `GET /api/v1/meta`, and `kind` is a closed enum, so a
  demo company is listed with `kind: "password"` and the name "Pick a person (demo company, no
  password)". The Android app's manual address entry has no organisation field: on Android, open a
  demo company with the link or QR code.
- **On a server with demo companies**, `/sign-in` and `GET /api/v1/meta` never fall back to the only
  organisation, so a real organisation's people there use `/sign-in/<slug>`.
- **In a demo company** people hired there get no sign-in (invitations are refused) and so aren't on
  the sign-in page, re-authentication is not asked for, and a browser signed in to one company is
  sent to its home page from another company's sign-in page (sign out first).
- **Backups on a demo server** contain the demo companies live at that moment; keep scheduled
  backups off there.
- The image keeps PGlite (27 MB) for the seed; it loads only when the first copy is made.

## Testing

- **End-to-end gaps**: the SSO round trip, audit-log filtering and export, and device sessions are
  covered by integration tests against a mock identity provider, not by Playwright.
- **NRIC and bank reveal** have no web unit test (no DOM test environment); Playwright covers them.
