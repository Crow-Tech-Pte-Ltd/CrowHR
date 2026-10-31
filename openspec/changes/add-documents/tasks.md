## 1. Storage and access

- [x] 1.1 packages/core: write `testing/schema.documents.test.ts` (tables, composite FKs, default categories seeded per org) then add `documents.ts` schema and migration — `testing/schema.documents.test.ts`; defaults are created on first use per organisation (`documents/defaults.ts`)
- [x] 1.2 packages/core: write `documents/categories.http.test.ts` (defaults match spec table, medical cannot be manager-visible, delete in use refused) then implement categories — `documents/documents.http.test.ts`
- [x] 1.3 packages/core: write `documents/upload.test.ts` (allowed signatures, OOXML structure check, `.docm`/`.xlsm` refused, 20 MB cap, expiry required by category, employee upload only to uploadable categories, versions and superseded) then implement upload and versions — `documents/documents.http.test.ts` (shared `files/` sniffer extended with OOXML)
- [x] 1.4 packages/core: write `documents/access.http.test.ts` (every role × category flag incl. payroll-visible, medical only owner/hr/self, manager team only, 404 out of scope, attachment + nosniff headers, audit on medical/identity view, cross-org 404) then implement read/download — `documents/documents.http.test.ts`; cross-org in `access/cross-org.test.ts`
- [x] 1.5 packages/core: write `documents/delete-purge.test.ts` (soft delete hidden + audited, owner-only purge removes file and tombstones row with reason) then implement — `documents/documents.http.test.ts`

## 2. Expiry

- [x] 2.1 packages/core: write `documents/expiry.test.ts` (valid/expiring/expired by SGT date; reminders 30/7/0 once each to hr_admins and visible-category employee; superseded or later document stops reminders) then implement the reminder source and expiring list — `documents/documents.http.test.ts` (state, 30/7/0 reminders once each, renewal stops reminders)

## 3. Templates and generation

- [x] 3.1 packages/core: write `pdf/render.test.ts` (headings, lists, tables, page break, embedded fonts, deterministic output hash for fixed input) then implement the shared renderer (or reuse payroll's if it exists) — `pdf/letter.ts` on payroll's `pdf/document.ts`; `pdf/letter.test.ts` (italic renders regular: no italic face embedded)
- [x] 3.2 packages/core: write `documents/template-validate.test.ts` (raw HTML, images, http links rejected; unknown field named with line and suggestion; full NRIC not a field) then implement restricted Markdown parsing and the field registry — `documents/templates.test.ts` (own whitelist parser, no micromark)
- [x] 3.3 packages/core: write `documents/generate.test.ts` (as-at resolution, SG money/date formatting, missing fields listed with where to fix, salary fields need salary read → 403 naming fields, stored as generated document with template version and snapshot) then implement generation — `documents/letters.http.test.ts`
- [x] 3.4 packages/core: write `documents/ket.test.ts` against an sg-rules stub (mandatory anchors required at save, empty mandatory value blocks unless per-document override recorded, onboarding "Issue KETs" item auto-completed) — the real mandatory-item list stays NOT IMPLEMENTED and this task unchecked until sg-rules cites it — against the real cited list: sg-rules `employment-act/records.ts` (MOM KETs, research §7); `documents/templates.test.ts` asserts the default KET template holds every mandatory item; generation and Issue KETs in `documents/letters.http.test.ts`

## 4. Acknowledgements

- [x] 4.1 packages/core: write `documents/acknowledgements.test.ts` (request appears in employee inbox; 409 `not_viewed` before opening; records time/IP/UA/sha256; reminders day 3 and 7; new version needs new ack; not revocable; CSV export) then implement — `documents/letters.http.test.ts`

## 5. Web UI

- [x] 5.1 apps/web: write `e2e/documents.spec.ts` (HR uploads work pass with expiry, sees "Expiring", replaces it, previous versions listed; manager cannot see contract) then build the employee Documents tab and Settings → Document categories — built (profile Documents tab, Settings → Documents); e2e `e2e/ws6b/documents.ws6b.ts` covers generate → acknowledge; upload/replace/manager visibility are covered at HTTP level, not in e2e
- [x] 5.2 apps/web: write `e2e/letters.spec.ts` (create confirmation template, unknown-field error, live preview, generate, missing-field list, request acknowledgement) then build the template editor and generator — built (template editor with live preview and field picker; generate dialog with missing-field list and acknowledgement request); e2e covers generate with missing fields, unknown-field errors are covered at HTTP level
- [x] 5.3 apps/web: write `e2e/my-documents.spec.ts` at 360px (employee opens and acknowledges, uploads a certificate) then build My documents — built (My documents, acknowledge, upload, request a letter); e2e acknowledges at 1440; 390 checked by screenshots

## 6. Lead brief additions (WS6b)

- [x] 6.1 packages/core: employee letter requests through workflows (`document_request` subject: request → hr_admin approves → letter generated from the active employment certificate template) — `documents/letters.http.test.ts`
- [x] 6.2 packages/core: retention review on the workflows `tick` (Employment Act: 12 months after leaving, sg-rules `employmentRecordRetention`); flags only, HR keeps or soft-deletes, owners purge — `documents/letters.http.test.ts`
- [x] 6.3 packages/core: payslip release notifies each employee (payroll/service.ts → notifications; month only, no amounts) — `payroll/cost-report.http.test.ts`
