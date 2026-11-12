## Why

The IR8A export covers pay from payslips, but Crow HR records no benefits-in-kind or share-plan gains, so HR fills Appendix 8A and Appendix 8B by hand and types the IR8A d7 and d8 totals into myTax. Employers with housing, cars, home leave passages or share plans need those appendices every year by 1 March, and IRAS's import template takes them in the same workbook as the IR8A rows.

## What Changes

- Payroll admins and owners record, per employee and income year, the benefits-in-kind of Appendix 8A (places of residence with utilities, driver and servant costs; hotel stays; cars; home leave passages and the other item 4 benefits) and the ESOP/ESOW gains of Appendix 8B.
- `packages/sg-rules` computes the values IRAS gives a formula for, with citations and effective dates: days of occupation, annual value for the period and furniture and fittings at 40% or 50%, rent apportioned between employees sharing, the driver benefit, hotel net cost, the car benefit for new, second-hand, COE-renewed and leased cars, the gross share gain (f − e) × g, its section (S10(1)(b) or S10(1)(g)) and the IR8A d7(a), d7(b) and d8 totals. Everything else is the amount HR enters.
- The IR8A preview shows d7(a), d7(b) and d8 per employee. The IR8A download gains three sheets, in the column layout of the template's `Appendix 8A(Accommodation)`, `Appendix 8A(Hotel & Others)` and `Appendix 8B` sheets, split into the same parts of at most 200 employees as the IR8A rows. Employees with only appendix income (for example a former employee's share gain) get an IR8A row.
- A "Year end" payroll screen lists and edits the year's appendix records, with each computed value's working.
- Every create, change, delete and download is audit-logged. Additive endpoints under `/api/v1/payroll`; an optional `sheet` query parameter on the IR8A file download.
- User docs (IR8A page) and `docs/limitations.md` are updated; research in `research/sg-ir8a-appendices.md`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `statutory-files`: the IR8A export includes Appendix 8A and 8B and the IR8A d7 and d8 totals. Replaces the "No direct submission" scenario's statement that Appendix 8A is not produced.

## Non-goals

- Direct AIS-API submission, and printed Appendix 8A/8B forms for employers outside AIS.
- ERIS records (IRAS: phased out after YA 2024, "do not build"), QEEBR deferral (the employee's application), and the "deemed exercise" rule and tracking option for leaving foreigners (reported in IR21).
- Computing the loan interest benefit (4b), currency conversion of share prices, or the annual value from IRAS's valuation list: HR enters these.
- Benefits in payslips or CPF: benefits-in-kind here are year-end tax reporting only.
- Annual value apportionment in a leap year, which IRAS does not state: HR enters 2a.
- Amendment submissions (differences) to records already filed.

## Impact

`packages/sg-rules` (new `tax/` calculators and rule tables), `packages/core` (schema, migration, service, routes, IR8A export, OpenAPI snapshot), `apps/web` (Year end screen, IR8A panel), `apps/docs` (IR8A page), `docs/limitations.md`, `research/`.
