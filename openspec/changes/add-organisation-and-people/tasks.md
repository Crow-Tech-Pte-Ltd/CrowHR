## 1. Schema and conventions

- [x] 1.1 packages/core: write `testing/schema.people.test.ts` (tables exist, `org_id` non-null everywhere, composite FKs reject cross-org references, unique `id_number_hmac` per org) then add `organisation.ts` and `employees.ts` schema and migration
- [x] 1.2 packages/core: write `employees/effective.test.ts` (half-open intervals, as-at on boundaries, closing previous version, overlap rejected, property test over random event sequences) then implement `asAt`/`asAtMany` and the overlap guard; add the convention to `docs/architecture.md` (coordinate with foundation owner)

## 2. Organisation

- [x] 2.1 packages/core: write `organisation/uen.test.ts` (three UEN formats valid/invalid; CSN must start with UEN; payment-type list from sg-rules) then implement validators — CSN payment-type list stays `// NOT IMPLEMENTED:` and this task unchecked until sg-rules cites it (payment types cited from CPF in `organisation/statutory.ts`; move to sg-rules when it has a home for them)
- [x] 2.2 packages/core: write `organisation/profile.http.test.ts` (owner/hr_admin write, others read-only, logo size/type, audit) then implement company profile endpoints
- [x] 2.3 packages/core: write `organisation/structure.http.test.ts` (unique active names, archive in use → 409 with count, archived not selectable) then implement departments, teams, locations, cost centres
- [x] 2.4 packages/core: write `organisation/work-schedules.test.ts` (weekly minutes sum, exactly one rest day, shift kind, single default, edit creates effective-dated version, as-at lookup) then implement work schedules
- [x] 2.5 packages/core: write `organisation/setup-checklist.test.ts` (steps derived from data) then implement the setup-checklist inbox source — derived steps + `GET /api/v1/organisation/setup-checklist`; registered as the workflows `setup` InboxSource (`workflows/people.ts`) and shown on Home as "Finish setting up" (WS3 integration)

## 3. Employee record

- [x] 3.1 packages/core: write `employees/nric.test.ts` (checksum vectors for S, T, F, G, M prefixes; normalisation) then implement the validator
- [x] 3.2 packages/core: write `employees/profile.http.test.ts` (required fields, PR start date rule, duplicate ID → 409 with rehire hint, NRIC encrypted at rest, masked in responses, redaction per role) then implement create/read/update
- [x] 3.3 packages/core: write `employees/contacts.test.ts` (E.164 normalisation with +65 default, max 3 emergency contacts, unique work email among active) then implement
- [x] 3.4 packages/core: write `employees/bank.test.ts` (one current account, history by date, encrypted, masked last 4, payroll lookup by payment date) then implement bank accounts with the SG bank list
- [x] 3.5 packages/core: write `employees/work-pass.test.ts` (pass required for foreigner on start date, expired status, encrypted pass number) then implement work passes

## 4. Employment, compensation, lifecycle

- [x] 4.1 packages/core: write `employees/lifecycle.test.ts` (hire creates tenure + records + invitation; transfer/promotion/salary_change; scheduled vs effective by injected clock; cancel restores prior; reporting cycle → 409; self-manager rejected) then implement `applyEvent` — DONE: applyEvent for every event type, scheduled/effective status, cancel, cycle/self-manager checks (tests pass); hire invites the employee through identity's `inviteMember()` (email, or a one-time "copy link" when SMTP is off; an existing member without an employee record is linked instead) — `employees/hire-invite.http.test.ts`
- [x] 4.2 packages/core: write `employees/resignation.test.ts` (last day counts notice date as day 1; shortened by agreement; offboarding checklist created; termination reasons) then implement resignation and termination — DONE: last day, shortening, offboarding checklist, termination reasons (tests pass); the statutory default notice (sg-rules `statutoryMinimumNotice`, MOM) applies when the contract states none, and hires under the minimum age (sg-rules `checkEmploymentAge`, EA s 68) are refused
- [x] 4.3 packages/core: write `employees/rehire.test.ts` (same employee ID, new tenure, history kept) then implement rehire
- [x] 4.4 packages/core: write `employees/compensation.test.ts` (integer cents, safe-integer guard, future-dated raise as-at, retro without flag rejected, retro with flag emits back-pay notice to payroll interface stub) then implement compensation and recurring allowances
- [x] 4.5 packages/core: write `employees/reporting-scope.test.ts` (direct, indirect, depth cap, as-at today) then implement `ReportingScopeResolver` and plug it into access-control; rerun `access/matrix.http.test.ts` against the real resolver — DONE: resolver (`employees/reports/reporting-scope.ts`) + tests; apps/server wires `deps.reportingScope = createReportingScopeResolver(db)` and `access/matrix.http.test.ts` runs against the real resolver over hired employees
- [x] 4.6 packages/core: write `employees/former-transition.test.ts` (membership becomes `former` the day after last working day via `tick`) then wire the lifecycle hook from access-control — `runFormerTransitions` runs as the `membership_former` transition of `tick(now)` with identity's real `markFormer` (tested in `workflows/people-integration.test.ts`)

## 5. Import and export

- [x] 5.1 packages/core: write `employees/import/parse.test.ts` (UTF-8 BOM, quoted fields, 5 MB and 2 000-row caps, date formats `YYYY-MM-DD` and `DD/MM/YYYY` only) then implement the runtime-agnostic parser
- [x] 5.2 packages/core: write `employees/import/employees-import.http.test.ts` (preview lists row/column/value/message; nothing written before confirm; commit is all-or-nothing; re-validation at commit; nearest-name hint for unknown department) then implement employee import
- [x] 5.3 packages/core: write `employees/import/ytd-import.test.ts` (dollars → cents exactly, through-month, one row per employee-year) then implement compensation and YTD imports with downloadable templates
- [x] 5.4 packages/core: write `employees/export.http.test.ts` (columns limited by permission, manager team-only, unmasked NRIC requires re-auth, audit with columns + row count, CSV and XLSX) then implement export using the reporting export writer (shared with `add-reporting`; build the writer here if this lands first) (unmasked columns only on `/employees/export/unmasked`, which declares `recentAuth`; the guard itself is identity's)

## 6. Checklists and self-service

- [x] 6.1 packages/core: write `employees/checklists.test.ts` (default template instantiated on hire/resignation/termination, due dates from offsets, complete/skip with reason by assignee role, cancel with event) then implement checklists and their inbox source
- [x] 6.2 packages/core: write `employees/change-requests.http.test.ts` (direct-edit fields saved + audited; sensitive fields create request; bank → payroll_admin, others → hr_admin; applied only on approval from effective date; pending shown to employee only) against a workflows test double, then implement

## 7. Web UI

- [x] 7.1 apps/web: write `e2e/company-setup.spec.ts` (setup checklist on Home, company profile with UEN error message, department, default work schedule) then build Settings → Company, Structure, Work schedules — `e2e/company-setup.spec.ts` runs in a fresh seeded organisation (`E2E.freshOrg`): the checklist goes 4 → 3 → 1 steps as the company profile (after the UEN error), a department and the default schedule are added
- [x] 7.2 apps/web: write `e2e/people.spec.ts` (hire wizard, profile tabs, NRIC masked, transfer with future date shows "Scheduled", resignation shows "Leaving on") then build People list and profile (e2e in `e2e/people/people.people.ts` against the dev-only persona server until sign-in lands)
- [x] 7.3 apps/web: write `e2e/import.spec.ts` (upload file with 2 errors, preview table, fix and re-upload, confirm) then build the import wizard (e2e in `e2e/people/people.people.ts`)
- [x] 7.4 apps/web: write `e2e/self-service.spec.ts` (employee edits mobile directly, submits bank change, sees "Awaiting approval") then build My profile (e2e in `e2e/people/people.people.ts`)
