## 1. Tests first
- [x] 1.1 `packages/core`: fresh-organisation defaults, the run-level gross-rate warning, holiday and overtime issue references, and their fixes clearing the block (`payroll/issue-refs.http.test.ts`).
- [x] 1.2 `apps/web`: where each issue is fixed (`payroll/-lib/fixes.test.ts`).

## 2. Implementation
- [x] 2.1 `packages/core`: `PayIssue.ref`, refs on item, overtime and holiday issues, `ALLOWANCE_GROSS_RATE_UNSET`, messages that name the screen; additive `issue.ref` in the API (`issue-refs.http.test.ts`, OpenAPI snapshot).
- [x] 2.2 `apps/web`: Allowance treatment page; cutoff day in payroll settings (`e2e/payroll/payroll.payroll.ts`).
- [x] 2.3 `apps/web`: fix links on run and drawer issues; holiday pay, fed overtime amounts and item editing in the drawer (`e2e/payroll/payroll.payroll.ts`).
- [x] 2.4 `apps/web`: Return to draft with reason and re-authentication wrapper (`e2e/payroll/payroll.payroll.ts`).

## 3. Documentation
- [x] 3.1 Payroll settings, running payroll, troubleshooting, status, limitations (docs build link check).
