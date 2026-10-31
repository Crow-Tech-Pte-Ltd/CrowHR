## 1. Contract and runner

- [x] 1.1 packages/core: write `reporting/registry.test.ts` (register, disabled module registers none, catalogue filtered by permission, 403 for forbidden run, 404 for disabled module) then implement registry and `GET /api/v1/reports` — tests in `reporting/reports.http.test.ts` (catalogue per role, 403, 404 when a host leaves a module's `ReportSource` out via `deps.reportSources`)
- [x] 1.2 packages/core: write `reporting/runner.test.ts` (scope passed to `run`, sensitive columns removed with `redactedColumns`, totals over scoped rows only, pagination 50, sort by any column) then implement the runner and `GET /api/v1/reports/{id}` — `reporting/runner.ts`; tests in `reporting/reports.http.test.ts`
- [x] 1.3 packages/core: write `reporting/conformance.test.ts` (every registered definition, run as manager → only team rows; as other-org owner → zero rows) and add it to CI

## 2. Export writers

- [x] 2.1 packages/core: write `export/csv.test.ts` (BOM, RFC 4180 quoting, ISO dates, cents → `1234.56` incl. negatives and 0, formula-injection prefix for `= + - @`) then implement
- [x] 2.2 packages/core: write `export/xlsx.test.ts` (typed cells, `#,##0.00`, date cells, frozen header + filter, Parameters sheet, money boundary round-trip, file opens via a re-parse) and `runtime-agnostic` import check, then implement with the chosen library or the `fflate` fallback — minimal writer (no dependency), store-only ZIP; re-parsed by `export/xlsx-read.ts`
- [x] 2.3 packages/core: write `reporting/export.http.test.ts` (full result not page, 50 000-row limit → 422, audit with params/row count/redacted columns) then implement `GET /api/v1/reports/{id}/export?format=csv|xlsx` — tests in `reporting/reports.http.test.ts` (limit enforced in the runner, 422 `too_many_rows`)

## 3. People reports

- [x] 3.1 packages/core: write `employees/reports/headcount.test.ts` (as-at boundaries incl. last working day and future hires, grouping dimensions, percentages to 1 dp) then implement — headcount tests in `reporting/reports.http.test.ts` plus `employees/reports/people-reports.test.ts`; also `people.headcount_trend` (headcount over time)
- [x] 3.2 packages/core: write `employees/reports/turnover.test.ts` (40/44/6 → 14.3%; avg 0 → n/a; rehire counts as joiner; voluntary/involuntary/other split) then implement joiners, leavers and turnover — formula tests in `employees/reports/people-reports.test.ts`, HTTP in `reporting/reports.http.test.ts`
- [x] 3.3 packages/core: write `employees/reports/work-pass-expiry.test.ts` (sorted by expiry, expired flagged, HR/owner/payroll only) then implement — `employees/reports/people-reports.test.ts`

## 4. Module contracts (implemented by owning workstreams)

- [x] 4.1 packages/core: publish `reporting/contracts.ts` with the payroll-cost and leave report row types plus contract tests against fakes (`reporting/contracts.test.ts`); the real definitions are tasks in the payroll, leave and attendance changes — leave this task's downstream items unchecked until those exist — done differently: no separate `contracts.ts` with fakes, because every module now ships its real `ReportSource` (leave/reports.ts, attendance/report-source.ts, claims/report-source.ts, payroll/reports.ts), covered by `reporting/conformance.test.ts` and `payroll/cost-report.http.test.ts` (reconciles to the cent with finalised runs)

## 5. Web UI

- [x] 5.1 apps/web: write `e2e/reports.spec.ts` (catalogue per role, headcount by department, empty-state message, totals row, download CSV and XLSX) then build the Reports catalogue and report page — e2e in `e2e/ws6b/reports.ws6b.ts` (payroll cost XLSX totals, hr_admin without payroll access) and `e2e/ws6b/shots.ws6b.ts` (catalogue, headcount totals, empty state); CSV content is covered at HTTP level
