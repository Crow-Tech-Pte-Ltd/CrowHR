## 1. Foundations

- [ ] 1.1 packages/core: write `claims/money.test.ts` (MYR 12550 @ 0.301234 → 3780; JPY 5000 @ 0.008912 → 4456; KWD exponent 3; half-up at .5; safe-integer overflow throws) then implement `toSgdCents`
- [ ] 1.2 packages/core: write `testing/schema.claims.test.ts` (tables, composite FKs, shared `files` and `org_counters`) then add `claims.ts` schema (and `files.ts` if not yet present) and migration
- [ ] 1.3 packages/core: write `files/sniff.test.ts` (PDF, JPEG, PNG, WebP, HEIC accepted by signature; renamed EXE/ZIP rejected; 10 MB cap) then implement the sniffer and upload route

## 2. Claim types and claims

- [ ] 2.1 packages/core: write `claims/types.http.test.ts` (owner/hr_admin write, payroll_admin read, archive in use, eligibility by employment type and probation) then implement claim types
- [ ] 2.2 packages/core: write `claims/validation.test.ts` (1–30 lines, description length, future and older-than-window dates, receipt rule always/above, GST ≤ amount, GST on non-SGD rejected, drafts saved without receipt checks) then implement draft CRUD and submit validation
- [ ] 2.3 packages/core: write `claims/caps.test.ts` (per-claim, monthly, yearly by expense date in SGT; submit counts submitted+approved; approve counts approved+paid; error detail cap/used/pending/remaining; two concurrent submits serialise on PGlite) then implement cap checks with the advisory lock
- [ ] 2.4 packages/core: write `claims/duplicates.test.ts` (same SHA-256 on another non-rejected claim flagged, not blocked) then implement duplicate flags
- [ ] 2.5 packages/core: write `claims/scan.test.ts` with a fake scanner (pending blocks submit, infected deleted with message, error retries 3 then `scan_failed`, no scanner → `unscanned`) then implement the scan sweep

## 3. Approval and payout

- [ ] 3.1 packages/core: write `claims/approval.test.ts` (submit creates `claim` request with amount and type codes; threshold policy adds owner step; approve sets payout; reject stores comment; withdraw while submitted; copy rejected to draft) then implement the `SubjectAdapter`
- [ ] 3.2 packages/core: write `claims/reimbursement.test.ts` (listPayable by approval date ≤ periodEnd; reserve excludes from other runs; double reserve fails; release on discard; markPaid sets payment date; never paid twice) then implement `ReimbursementSource`
- [ ] 3.3 packages/core: write `claims/paid-outside.http.test.ts` (payroll_admin/owner only, bulk with reference, reserved claim refused, audit) then implement
- [ ] 3.4 apps/server: write `src/clamav-scanner.test.ts` against a fake clamd TCP responder then implement the optional ClamAV adapter behind `CLAMAV_HOST`

## 4. Reports and access

- [ ] 4.1 packages/core: write `claims/reports.test.ts` (by type/department/month with GST totals; status ageing; cap usage; payout register; medical descriptions/receipts omitted without `medical` access) then register report definitions with reporting
- [ ] 4.2 packages/core: write `claims/access.http.test.ts` (matrix cells for claims incl. manager team scope, medical receipt only to current approver, cross-org 404) then fix any gaps

## 5. Web UI

- [ ] 5.1 apps/web: write `e2e/claims-submit.spec.ts` at 360px (add two lines, camera/file receipt, foreign currency shows SGD preview, cap remaining updates, cap error text) then build My claims
- [ ] 5.2 apps/web: write `e2e/claims-approve.spec.ts` (manager sees receipt, duplicate flag, approves; payroll_admin bulk marks paid outside payroll) then build team claims and Claims admin
- [ ] 5.3 apps/web: write `e2e/claim-types.spec.ts` (starter set offered on empty state, edit cap, archive) then build Settings → Claim types
