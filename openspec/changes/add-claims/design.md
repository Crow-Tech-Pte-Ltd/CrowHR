## Context

Depends on identity and access (permissions, medical sensitivity, audit), organisation and people (employees, employment type, probation, departments), workflows (subject type `claim`, notifications) and the injected `FileStore`. The payroll change, M1, consumes `ReimbursementSource`, and so do reporting registrations. Requirements are in `specs/claims`.

## Goals / Non-Goals

**Goals:** exact integer money including FX; cap checks that cannot be raced past; a payroll interface narrow enough that payroll and claims can be built by different people.

**Non-Goals:** claim-specific approval logic. Everything goes through `workflows`.

## Decisions

1. **Money and FX in integers.** `amount_minor` is a bigint-safe `number`, `currency_exponent` comes from a bundled ISO 4217 table, and `rate_micros` is an integer. Conversion:

   ```
   sgdCents = roundHalfUp(amountMinor × rateMicros × 10^(2 − exp), 10^6)
   ```

   It is computed with `BigInt` and the result is asserted to be a safe integer. The function lives in `claims/money.ts` with test vectors for exponents 0, 2 and 3 (KWD). *Alternative:* decimal.js, which is an extra dependency for one function.

2. **Cap checks under lock.** Submit and approve both take `pg_advisory_xact_lock(hash(org_id, employee_id, claim_type_id))` before summing. Two concurrent submissions therefore serialise, and the second sees the first. The sum uses `claim_lines.expense_date` within the period bounds of the claim type, with Asia/Singapore calendar months and years.

3. **Receipts are generic files.** A `files` table records `id`, `org_id`, `sha256`, `mime`, `size`, `scan_status` and `storage_key`. The documents module reuses it, and it may be introduced by whichever of claims or documents lands first. The file type is detected from magic bytes with a small internal sniffer covering PDF, JPEG, PNG, WebP and HEIC (`ftyp heic/heix/mif1`). Downloads stream through an authorised route with `Content-Disposition: attachment` for PDF, and inline only for images, with `X-Content-Type-Options: nosniff`.

4. **Scanner hook.** `deps.fileScanner?: { scan(stream) → 'clean' | 'infected' | 'error' }` runs in the `tick` sweep for `pending_scan` files. That keeps uploads fast and runtime-agnostic. `error` retries 3 times, then holds the file at `scan_failed`, which blocks submission and is visible to admins.

5. **Payroll interface.** The interface:

   ```ts
   ReimbursementSource {
     listPayable(orgId, periodEnd): PayableClaim[];
     reserve(tx, runId, claimIds): void;   // fails if any is already reserved or paid
     release(tx, runId): void;
     markPaid(tx, runId, paymentDate): void;
   }
   ```

   Reservation is a `payroll_run_id` column with a partial unique guard. Payroll owns when to call each method. Claims owns the state. The payslip line label is `Claims reimbursement: <type name>`, one line per type.

6. **Numbering.** `claim_number` comes from a per-org counter row (`org_counters`, shared with other modules for `E0001`, `C-0001` and the like), incremented in the submit transaction. Drafts have no number.

## Data model sketch

All tables have `org_id`, and FKs are composite.

| Table | Key columns |
| --- | --- |
| `claim_types` | `id`, `org_id`, `code`, `name`, `category`, `receipt_rule` (always, never, above), `receipt_above_cents?`, `cap_cents?`, `cap_period`, `eligible_employment_types[]`, `available_during_probation`, `default_payout`, `taxable`, `gl_code?`, `archived_at` |
| `claims` | `id`, `org_id`, `employee_id`, `claim_number?`, `status` (draft, submitted, approved, rejected, withdrawn, paid), `total_cents`, `payout_method?`, `approval_request_id?`, `payroll_run_id?`, `paid_on?`, `paid_reference?`, `submitted_at?`, `decided_at?` |
| `claim_lines` | `id`, `org_id`, `claim_id`, `claim_type_id`, `expense_date`, `merchant`, `description`, `currency`, `currency_exponent`, `amount_minor`, `rate_micros?`, `sgd_cents`, `gst_cents?` |
| `claim_line_files` | `org_id`, `claim_line_id`, `file_id`, `position` |
| `files` (shared) | `id`, `org_id`, `sha256`, `mime`, `size_bytes`, `storage_key`, `scan_status` (unscanned, pending_scan, clean, infected, scan_failed), `uploaded_by`, `created_at` |
| `org_counters` (shared) | `org_id`, `name`, `next_value` |

## Risks / Trade-offs

- [HEIC cannot be previewed in most browsers] → it is accepted and stored, and the preview shows "Preview not available. Download to view". Converting it in-app is out of scope.
- [Manual FX rates can be mistyped] → the approver sees the rate. A rate that deviates more than 20% from the last rate used in the org for that currency shows a warning, not a block.
- [Medical receipts visible to approving managers] → this is deliberate under the current-approver rule in access-control. The claim-type category `medical` drives the sensitivity marking.
- [The claim `taxable` flag is a simplification] → IR8A treatment is decided in the payroll and IR8A change. The flag is an input only.

## Migration Plan

Additive. Seeds no claim types. The empty state offers a starter set (Medical, Dental, Transport, Meals, Client entertainment) that HR confirms.
