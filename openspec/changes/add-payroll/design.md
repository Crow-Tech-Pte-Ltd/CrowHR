## Context

See proposal.md for motivation. Payroll sits on `packages/sg-rules` (pure calculators, cited tables) and the people module (effective-dated compensation, allowances, tenures, work schedules, YTD opening balances, encrypted NRIC and bank numbers). Workflows (WS3), claims (WS6) and attendance (WS5) are being built in parallel, so payroll depends on them only through ports with test doubles. Core must stay runtime-agnostic (the browser demo runs the same code).

## Goals / Non-Goals

**Goals:** a pure, reproducible per-employee engine; a run model that never rewrites history; a review screen that explains every number.

**Non-Goals:** general ledger, multi-entity, retro recalculation of later months after an adjustment (December/last-month AW reconciliation absorbs it, as CPF's Step 2 does).

## Decisions

1. **Pure engine over a snapshot.** `payroll/engine/` exposes `computeEmployeePay(snapshot) → result`. The service gathers a snapshot per employee (particulars, compensation segments, allowances with treatment, run items, working-day pattern, public holidays are inside sg-rules, YTD CPF state before the month, totals of earlier runs of the same month) and stores it. Canonical JSON (sorted keys, no undefined) is hashed with Web Crypto SHA-256. *Alternative:* recompute from live tables on demand; rejected because records change and payroll must show what was approved.

2. **CPF for the month, charged per run.** CPF, SHG and SDL are monthly amounts on all wages of the month. Each run computes the month cumulatively (this run's wages plus wages of earlier effective runs of the month) from the YTD state before the month, and charges the difference from what earlier runs of that month already charged. This one rule covers off-cycle bonus runs, final pay and adjustments. The YTD state persisted is the cumulative state after the month. *Alternative:* separate CPF per run; wrong, because CPF rounds the month's OW and AW together.

3. **Adjustment instead of mutation.** Reopen copies the original run's items into a new `adjustment` run. When approved, the original is marked `superseded_by` (a flag, not a figure change) and later months read state from the adjustment. Net payable on an adjustment payslip = revised net − net already paid by superseded runs.

4. **Approvals through the workflows engine.** `payroll/approval.ts` registers the `payroll_run` `SubjectAdapter` (attributes, summary, `onApproved`/`onRejected`/`onWithdrawn` in the engine's transaction, `canRead`) in `CORE_WORKFLOW_PLUGINS`, with the payroll-cutoff `ReminderSource` and a payroll `InboxSource`. Submit calls `submitApproval`; there is no payroll-specific decision endpoint. People's `PayrollPort` is implemented by `payroll/people-port.ts` (finalised-period guard, back-pay notices) and takes the caller's transaction.

5. **Other ports.** `ReimbursementSource` (as in add-claims design: `listPayable`, `reserve`, `release`, `markPaid`) with `noClaimsYet`; `OvertimeSource.listApproved(orgId, from, to)` with `manualOvertimeOnly` (OT entered as run items). Both are in `payroll/ports.ts` with memory doubles in `src/testing/`.

6. **Employment Act payment and deduction rules live in sg-rules.** `sg-rules/employment-act/salary-payment.ts` holds the s 21 deadlines, the s 29/30/32 deduction limits (accommodation and amenities share one cap; employee CPF counts toward 50%) and the CPF Act s 7(9) recovery deadline, with citations; `payroll/rules.ts` re-exports them. Corrections from `research/verification/payroll-choices.md`.

7. **PDF.** `pdf/` wraps `pdf-lib` + `@pdf-lib/fontkit` (pure JS, works in browsers). Fonts (Azeret Mono, Ubuntu; latin subsets from `@fontsource`) are converted from WOFF to TTF by `scripts/pdf-fonts.ts` and committed as a generated base64 module, so no host wiring or file access is needed. Creation dates come from the run, subset names are fixed, so output is byte-stable. *Alternative:* jsPDF (larger, weaker font subsetting) or a hand-written PDF writer (more code to own).

8. **Files.** CPF EZPay is a fixed-width writer with a field table taken from the spec and validated per field; bank file is pain.001.001.03 XML built from strings with escaping. Both are generated on demand from stored results (no file storage), audit-logged, and the bank file requires recent re-authentication because it decrypts account numbers.

## Risks / Trade-offs

- [Adjustment after later months are paid] → later months keep their stored YTD state; the run warns and December (or the last month) recomputes the AW ceiling on actual OW.
- [AW top-up employee share] → recoverable from pay until 30 June of the next year (CPF Act s 7(9)) with a recovery item; otherwise the employer bears it, reported apart from statutory employer CPF.
- [No fixed week] → the run blocks until scheduled and worked days are entered; attendance will supply them later.
- [FWL needs sector, tier and skill] → org-level defaults in payroll settings; labelled an estimate.
- [IR8A without IRAS's workbook] → rows in the template's column layout to paste at row 6; Appendix 8A not produced; no AIS-API submission.

## Migration Plan

One drizzle migration adds the payroll tables. No data migration. Rollback: drop the tables (no other module references them).

## Open Questions

- Whether CPF EZPay accepts SHG detail records for foreigners with F/G/M FINs (excluded with a warning until CPF confirms).
- Whether an EZPay file for an adjustment should reuse the original advice code (we use the next advice code).
