## Context

`packages/core/src/payroll/files/ir8a.ts` writes IR8A rows (columns A–AR of the template's IR8A sheet) from approved payslips. In the template the IR8A sheet's d7(a), d7(b), d8 and d9(ii) cells are locked and computed by myTax after import from the appendix sheets in the same workbook. The research is in `research/sg-ir8a-appendices.md`; section numbers below (§) refer to it.

## Goals / Non-Goals

**Goals:** record Appendix 8A and 8B inputs per employee and income year; compute what IRAS gives a formula for; produce the appendix sheets' rows aligned with the IR8A parts; show the IR8A totals HR must check in myTax.

**Non-Goals:** see the proposal. No AIS-API, no printed forms, no ERIS, no IR21 deemed exercise, no payslip or CPF effect.

## Decisions

### 1. One table, one row per appendix entry

`payroll_ir8a_appendix_entries` (`org_id`, `id`, `employee_id`, `year`, `kind`, `details` jsonb, created/updated by and at). `kind` is `residence` (Appendix 8A items 1–2, one per place of residence and unbroken period, at most 10 per employee and year), `hotel` (item 3), `car` (item 4i), `other` (items 4a–4h, 4j by `item`) or `share_gain` (Appendix 8B, at most 30 per employee and year). `details` holds the inputs only, validated by a zod discriminated union on every write; computed values are derived on read by sg-rules, so a rule fix never leaves stale numbers. Composite FK `(org_id, employee_id)` → `employees`; queries go through `orgScope`. Alternatives: one typed table per kind (five tables, five migrations' worth of churn for rarely used data) or storing computed values (stale after a rule correction).

### 2. Computed vs entered

| Value | Computed or entered | Rule (sg-rules) |
| --- | --- | --- |
| Days of occupation, days of car use | computed, both ends counted, within the income year | EN-8A example (§2.1) |
| 2a annual value for the period (owned) | computed: AV ÷ employees sharing × days ÷ 365; **or entered** (AV revised mid-year, or a leap year) | EN-8A example; leap year UNVERIFIED (§6.1) |
| 2b furniture and fittings | computed: 40% (partly) / 50% (fully furnished) of 2a | Form 8A, Accommodation page |
| 2c rent (rented) | computed: rent paid for the period ÷ employees sharing | Accommodation Example 2 |
| 2d, 2f, 2j, 3c | computed; 2f and 3c clamped at zero | AIS items D2(d), D2(f), D2(j), D3(c) |
| 2h driver | computed: annual cost × private ÷ total mileage | Form 8A 2h, Car page |
| 4i car | computed: new, second-hand, COE-renewed, leased formulas; depreciation × days ÷ days in year (366 in a leap year) | Car page, IRAS car calculator |
| Appendix 8B gain h | computed: (f − e) × g, decimals beyond 2 dropped | AIS item E1(h) |
| 8B section | computed: ESOP granted before 1 Jan 2003 → S10(1)(g), otherwise S10(1)(b) | AIS items E2, E3 |
| IR8A d8, d7(a), d7(b) | computed: sum, decimals dropped | AIS items C18–C20 |
| AV, rents, utilities, servant, hotel cost, items 4a–4h and 4j, car costs, years and running costs, share prices in S$ and share counts | entered | — |

Computed values are rounded down to the cent (`floorToCent`, named in sg-rules) because no rule is published and IRAS's examples truncate (§2.6, AMBIGUOUS). Inputs are integer cents; share prices and counts are decimal strings with at most 5 places, held as integers of 1/100,000 and multiplied exactly as bigint.

### 3. Rules as effective-dated rows

`APPENDIX_8A_RULES` and `APPENDIX_8B_RULES` in `packages/sg-rules/src/tables/iras-appendices.ts` carry the rates (40%, 50%, 3/7, 10 years, COE renewal 5 or 10 years), limits (10 residences, 30 share records, $9,999,999.99 per 8A amount, 5 decimal places) and the 2003 grant-date cut-off, each with its source URL. One open-ended row from the engine coverage start (1 Jan 2025, income year 2025 = YA2026), `effectiveFromBasis: "ENGINE_COVERAGE_START"`, verified on 13 Nov 2026 against the YA2027 documents; both families join the data-integrity test. The calculators pick the row in force on 1 January of the income year.

### 4. Export: same parts, one CSV per sheet

`GET /payroll/years/:year/ir8a/file?part=N&sheet=…` with `sheet` = `ir8a` (default, unchanged), `appendix-8a-accommodation`, `appendix-8a-hotel-others` or `appendix-8b`. Part N's appendix files hold the appendix rows of the employees in part N's IR8A rows, because one template workbook imports up to 200 IR8A records with their appendices. Headers are row 1 of each sheet, verbatim. Locked cells (8A: days, 2a, 2b, F&F value, 2d, 2f, 2j, 3c, total; 8B: h; IR8A: d7, d8, d9(ii)) are left empty because myTax computes them; the preview shows Crow HR's figures to check against myTax. 8A amounts are written with two decimals; 8B prices and counts with up to five. Owned-premises 2a and 2b cannot be imported (IRAS disabled the AV method in the template, §4), so the record gets a note with the values to enter in myTax.

The IR8A record list now also includes employees with appendix entries and no pay in the year. Employees left out of the IR8A rows (no sex, other ID type) are left out of every sheet with the same reason.

### 5. API

- `GET /payroll/years/:year/ir8a/appendices` (`payroll:read`): entries with computed values, working and notes.
- `POST /payroll/years/:year/ir8a/appendices` (`payroll:update`): body is the entry, discriminated by `kind`.
- `PUT /payroll/ir8a/appendices/:entryId` and `DELETE /payroll/ir8a/appendices/:entryId` (`payroll:update`): the entry ID alone identifies the record, so the cross-org sweep covers them.
- The IR8A preview gains `benefitsInKind`, `shareGainsS101b`, `shareGainsS101g` per record and the appendix row counts per part.

All additive to the frozen 1.0 contract. Validation messages say how to fix the input (e.g. "The occupation dates must be in 2026").

### 6. Permissions and audit

`payroll:read` / `payroll:update` (owner, payroll_admin) enforced server-side by the route access rule; no new matrix row. Entries of another organisation answer 404 (org-scoped queries, composite FK, cross-org sweep). Audit actions `payroll.ir8a_appendix_created`, `…_updated` (field diff), `…_deleted` on target `ir8a_appendix_entry`, and `payroll.ir8a_file_generated` with the sheet in its metadata. Field names avoid the audit log's secret-key filter (e.g. `driverPersonalKm`, not "private").

### 7. Web

A "Year end" screen at `/payroll/year-end/$year` with the IR8A summary and two tables (Appendix 8A, Appendix 8B), dense rows and right-aligned mono amounts; add and edit in a dialog per kind showing the computed values and working live from the server response. The IR8A panel on the Payroll page links to it and offers the appendix downloads per part.

## Risks / Trade-offs

- [Template changes when IRAS enables the AV method] → the header arrays are checked by tests against the verbatim text; re-verify each January (research doc).
- [A spreadsheet refuses a paste over locked empty cells] → docs tell HR to paste the column blocks either side of the grey columns (§6.4).
- [IRAS publishes no rounding for computed values] → each record is rounded down to the cent, which reproduces all of IRAS's worked examples in whole dollars; documented as AMBIGUOUS and the working shows the exact amount.
- [jsonb details drift from the zod schema] → every read re-parses through the same schema and the calculators reject invalid input.

## Migration Plan

One additive migration creating the table and its indexes; no data migration. Rollback: drop the table (no other table references it).

## Open Questions

- The leap-year day basis for annual value (§6.1) and the meaning of the IR8A "d9(ii) Appendix 8A indicator" (§6.5): ask IRAS before income year 2028.
