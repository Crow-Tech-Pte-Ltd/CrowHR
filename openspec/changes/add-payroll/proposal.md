## Why

Running payroll is the M1 outcome: an SME must be able to prepare, review, approve and release a monthly payroll with payslips. The statutory engine (`packages/sg-rules`) computes CPF, SDL, SHG and the Employment Act helpers, and people records hold compensation, residency and SHG data. Nothing yet turns them into a payroll run, keeps the inputs that produced each number, or shows the working to the people who must sign it off. Reviewing is where QuickHR-style tools are weakest, so a run that explains every number is the differentiator.

## What Changes

- New core module `payroll/` with the pay-item model: basic pay from effective-dated compensation, pro-rated by MOM's incomplete-month formula for joiners, leavers and no-pay leave; recurring allowances; one-off earnings (bonus, commission, back pay, other) classified as OW or AW with an AW payable date; manual overtime; claims reimbursement through `ReimbursementSource`; deductions checked against the Employment Act limits; employer-only costs (CPF employer share, SDL, an FWL estimate).
- Payroll runs: monthly regular runs and off-cycle runs (final pay, bonus) in states draft → in review → approved → paid. Reopening an approved or paid run creates an adjustment run; original figures are never changed. Approval goes through the workflows engine as a `payroll_run` subject (on-approve hook in the same transaction).
- Determinism: every employee's input snapshot, rate-table ids, CPF working, YTD and AW-ceiling state are persisted per run, with SHA-256 hashes; recomputing the same inputs gives byte-identical results. Statutory refusals become blocking issues with an explanation.
- Review UX in `apps/web/_app/payroll`: run overview (issues first, totals, headcount, changes since last month), a dense keyboard-navigable employee table, and a per-employee drawer that shows its working with each rule's effective date and source.
- Payslips with the MOM itemised-payslip items, released by payroll admins after approval; PDF via a new runtime-agnostic core `pdf/` module (pure JS, self-hosted fonts); Me → Payslips for employees and leavers (read-only).
- M2 files: CPF EZPay (FTP) submission file per CPF's public spec, a generic ISO 20022 pain.001.001.03 bank payment file, and an IR8A export in IRAS's import-template columns (no Appendix 8A, no AIS-API submission).
- sg-rules: the 15 CPF-calculator-confirmed cases become fixtures with provenance `OFFICIAL_CALCULATOR`.

## Capabilities

### New Capabilities

- `payroll-run`: pay items, run lifecycle, off-cycle and adjustment runs, approval port, determinism and persisted state, issues, review.
- `payslips`: payslip content, release, PDF, employee self-service.
- `statutory-files`: CPF EZPay file, bank payment file, IR8A export.

### Modified Capabilities

None. Permission rows `payroll:*` and `payslips:read` already exist in the access-control matrix and are used as specified.

## Impact

- `packages/core/src/payroll/`, `packages/core/src/pdf/`, schema `db/schema/payroll.ts` with one migration, two modules added to `V1_MODULES`, the OpenAPI snapshot.
- New dependencies in core: `pdf-lib` and `@pdf-lib/fontkit` (pure JS, MIT). Font files (OFL / Ubuntu Font Licence) embedded from `@fontsource`.
- `apps/web/src/routes/_app/payroll*` and `_app/me/payslips*`.
- `packages/sg-rules/src/__fixtures__/sg-test-vectors.json` (fixtures only).
- Interfaces for other workstreams to wire: `ReimbursementSource` (WS6 claims), `OvertimeSource` and scheduled days (WS5 attendance). Wired here: the workflows engine (WS3) and people's `PayrollPort` (WS2).

## Non-goals

- Direct submission to CPF Board or IRAS (APIs need onboarding), and bank-specific file formats (DBS, OCBC and UOB specs are not public).
- Hourly timesheets, attendance-derived OT and leave balances: entered manually per run until those modules exist.
- Multi-currency pay, multiple CSNs per organisation, GL journal export, IR21 and IR8S.
- Recovering the employee share of a prior-AW CPF shortfall from wages (unverified CPF Act s 7 rules).
