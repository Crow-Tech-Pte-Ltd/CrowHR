## Why

Medical, transport and client-entertainment claims are near-universal in Singapore SMEs, and today they travel as receipts in envelopes and rows in spreadsheets. Claims are the second most frequent self-service action after leave. They also feed payroll (reimbursement on the payslip) and later IR8A (taxable benefits). They depend on approvals and on a payroll interface, which is why they sit in M2.

## What Changes

- **Claim types:**
  - category: medical, dental, transport, meals, entertainment, travel, phone, training or other;
  - receipt required or not, with an optional "receipt required above S$X";
  - caps of per-claim, monthly or yearly amount per employee, enforced at submission and again at approval;
  - eligibility by employment type and by probation status;
  - default payout (payroll or outside payroll), a taxable flag for later IR8A, and a GL code.
- **Claims** are multi-line. Each line has a type, expense date, merchant, description, currency, amount, GST, and receipts.
- **Currency:** SGD by default. Foreign currency uses a manually entered rate with 6 decimal places, converted to SGD cents with half-up rounding. There are no live FX feeds.
- **GST** is an optional per-line field in SGD cents. It must be zero for foreign-currency lines and must not exceed the line amount.
- **Receipts:** PDF, JPEG, PNG, WebP or HEIC, at most 10 MB each and 5 per line, type checked by content. An optional virus-scan hook holds files as `pending_scan` and rejects infected ones. Duplicate receipts are detected by file hash and flagged to approvers.
- **Lifecycle:** draft → submitted → approved/rejected, withdrawn, or paid. Approval goes through the `workflows` engine using `amountCents` and the claim-type codes.
- **Reimbursement:**
  - Through payroll, via a defined `ReimbursementSource` interface (approved and unpaid claims for a pay period). Payroll implements the consumer, and claims become `paid` when the including run is finalised.
  - Or marked paid outside payroll with a date and reference, including in bulk.
- **Reports:** claims by type, department, employee, status and period, and the employee's cap usage. These are registered with `reporting`.

## Capabilities

### New Capabilities
- `claims`: claim types and caps, multi-line claims with receipts, currency and GST handling, submission and approval, payout via payroll or outside, claim reports.

### Modified Capabilities
None. Approval flows use the `workflows` subject type `claim`, which that change already declares.

## Non-goals

- Receipt OCR and auto-fill (P1).
- Live FX rates, co-payment and shared caps across several types (P1).
- Mileage calculators, per-diem tables and corporate cards.
- Project or client tagging and custom claim fields (P1).
- Accounting journal export of claims (it belongs to the Xero/QBO journal change, P1).
- Petty-cash advances and advance-settlement flows.
- Deciding the CPF and tax treatment of claim reimbursements. Payroll and sg-rules own the treatment; claims only carries the `taxable` flag.

## Impact

- `packages/core`: new `claims/` module and schema `claims.ts`; implements the workflows `SubjectAdapter` for `claim`; exports `ReimbursementSource`; registers report definitions.
- New optional injected dependency `FileScanner` (scan(fileId) → clean, infected or error). `apps/server` ships a ClamAV `clamd` TCP adapter behind `CLAMAV_HOST`. The default is no scanner.
- `apps/web`: My claims (mobile-first submission with camera capture), team claims for managers, Claims admin (types, payouts) and Settings → Claim types.
