## 1. Statutory fixtures

- [x] 1.1 packages/sg-rules: add the 15 CPF-calculator-confirmed cases (VERIFICATION.md "CPF calculator check") to `src/__fixtures__/sg-test-vectors.json` with provenance `OFFICIAL_CALCULATOR`; verified by `vectors.test.ts` passing all of them

## 2. Engine (packages/core/src/payroll/engine)

- [x] 2.1 Write `engine/proration.test.ts` (mid-month joiner 12/22 → S$2,181.82; leaver; two compensation segments; no-pay leave 2/22 → S$272.73; hourly × hours; shift schedule warning) then implement pro-ration on sg-rules `incompleteMonthSalary`
- [x] 2.2 Write `engine/deductions.test.ts` (25% category caps, 50% overall with exclusions, CPF counted, final-pay waiver as warning) then implement `payroll/rules.ts` (cited) and the checks
- [x] 2.3 Write `engine/compute.test.ts` (OW/AW classification, AW payable date outside period blocks, OT via sg-rules and contractual amount, reimbursements excluded from wages, month-cumulative CPF/SHG/SDL charged deltas, sg-rules refusal → blocking issue, negative net blocks, pay-date warnings) then implement `computeEmployeePay`
- [x] 2.4 Write `engine/canonical.test.ts` (key order independent, byte-identical hash) then implement canonical JSON + SHA-256

## 3. Schema and runs (packages/core)

- [x] 3.1 Add `db/schema/payroll.ts` (settings, allowance settings, runs, run items, payslips) and generate the migration; verified by `testing/schema.payroll.test.ts` (org_id everywhere, composite FKs)
- [x] 3.2 Write `payroll/runs.http.test.ts` (create regular run, one per month, compute, edit items only in draft, submit blocked by issues and by stale inputs 409, approve/reject through the local approvals port, release, mark paid, audit rows) then implement the service and routes
- [x] 3.3 Write `payroll/ports.test.ts` (memory approvals double drives the adapter in one transaction; reimbursement double reserved/released/marked paid; overtime source feeds items) then implement the ports
- [x] 3.4 Write `payroll/adjustment.http.test.ts` (reopen paid run → adjustment with copied items; original figures unchanged; approved adjustment supersedes; CPF charged = delta; net payable delta) then implement reopen
- [x] 3.5 Write `payroll/off-cycle.http.test.ts` (final pay run excludes employee from the regular run; bonus run with AW in the same month recomputes month CPF and charges the difference) then implement off-cycle runs
- [x] 3.6 Write `payroll/company-month.http.test.ts`: fictional 12-person company, October 2026 (every age band, SPR yr 1/2 G/G, foreigner, mid-month joiner, leaver, bonus hitting the AW ceiling, no-pay leave, OT, deduction cap) with exact cents and determinism
- [x] 3.7 Write `payroll/year.http.test.ts`: one employee Jan→Dec 2026 with bonuses in March and December, AW-ceiling state carried run to run and December recomputation
- [x] 3.8 Write `payroll/permissions.http.test.ts` (payroll_admin vs hr_admin vs manager vs employee; employees see only their own released payslips; former member read-only) and seed payroll rows in `access/cross-org.test.ts`
- [x] 3.9 Change-vs-last-month diff and run overview totals; verified by `payroll/review.test.ts`

## 4. Payslips and PDF

- [x] 4.1 Write `payroll/payslip.test.ts` (MOM mandatory items present; release refused naming a missing item; adjustment labelled revision) then implement the payslip view model
- [x] 4.2 Add `pdf/` (pdf-lib + fontkit, embedded fonts from `scripts/pdf-fonts.ts`) and write `pdf/payslip-pdf.test.ts` (valid PDF, byte-identical on re-render, text contains net pay) then implement
- [x] 4.3 Me → Payslips routes (list, view, PDF) for employees and former members; verified by `payroll/permissions.http.test.ts`

## 5. Web (apps/web)

- [x] 5.1 `_app/payroll` runs list + new run; run overview (issues first, totals, changes); dense review table with keyboard navigation; CPF working drawer; payslip view
- [x] 5.2 `_app/me/payslips` list + view + download
- [x] 5.3 Playwright `e2e/payroll/payroll.payroll.ts`: create run → review → approve → payslip visible to employee → download PDF
- [ ] 5.4 Screenshots (1440 and 390) of overview, review table, CPF drawer, payslip web + PDF and Me → Payslips, reviewed against AGENTS.md design language

## 6. Statutory files (M2)

- [x] 6.1 Write `payroll/files/cpf-ezpay.test.ts` (golden file, 150-char records, field rules, forbidden characters, E/L/N/O, refusals) then implement the EZPay writer and route
- [x] 6.2 Write `payroll/files/pain001.test.ts` (well-formed XML, totals, escaping, excluded employees, recent-auth + audit) then implement the bank file and route
- [ ] 6.3 IR8A import-template export (income rounded down, deductions up, 200-record chunks); verified by `payroll/files/ir8a.test.ts`

## 7. Docs

- [x] 7.1 `docs/limitations.md`: local approvals, manual OT and hours, no direct CPF/IRAS/bank submission, generic bank file, shortfall employee share not recovered, FWL estimate; ports for the lead to wire listed in the payroll module README comment
