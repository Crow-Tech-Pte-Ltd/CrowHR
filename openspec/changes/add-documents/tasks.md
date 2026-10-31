## 1. Storage and access

- [ ] 1.1 packages/core: write `testing/schema.documents.test.ts` (tables, composite FKs, default categories seeded per org) then add `documents.ts` schema and migration
- [ ] 1.2 packages/core: write `documents/categories.http.test.ts` (defaults match spec table, medical cannot be manager-visible, delete in use refused) then implement categories
- [ ] 1.3 packages/core: write `documents/upload.test.ts` (allowed signatures, OOXML structure check, `.docm`/`.xlsm` refused, 20 MB cap, expiry required by category, employee upload only to uploadable categories, versions and superseded) then implement upload and versions
- [ ] 1.4 packages/core: write `documents/access.http.test.ts` (every role × category flag incl. payroll-visible, medical only owner/hr/self, manager team only, 404 out of scope, attachment + nosniff headers, audit on medical/identity view, cross-org 404) then implement read/download
- [ ] 1.5 packages/core: write `documents/delete-purge.test.ts` (soft delete hidden + audited, owner-only purge removes file and tombstones row with reason) then implement

## 2. Expiry

- [ ] 2.1 packages/core: write `documents/expiry.test.ts` (valid/expiring/expired by SGT date; reminders 30/7/0 once each to hr_admins and visible-category employee; superseded or later document stops reminders) then implement the reminder source and expiring list

## 3. Templates and generation

- [ ] 3.1 packages/core: write `pdf/render.test.ts` (headings, lists, tables, page break, embedded fonts, deterministic output hash for fixed input) then implement the shared renderer (or reuse payroll's if it exists)
- [ ] 3.2 packages/core: write `documents/template-validate.test.ts` (raw HTML, images, http links rejected; unknown field named with line and suggestion; full NRIC not a field) then implement restricted Markdown parsing and the field registry
- [ ] 3.3 packages/core: write `documents/generate.test.ts` (as-at resolution, SG money/date formatting, missing fields listed with where to fix, salary fields need salary read → 403 naming fields, stored as generated document with template version and snapshot) then implement generation
- [ ] 3.4 packages/core: write `documents/ket.test.ts` against an sg-rules stub (mandatory anchors required at save, empty mandatory value blocks unless per-document override recorded, onboarding "Issue KETs" item auto-completed) — the real mandatory-item list stays NOT IMPLEMENTED and this task unchecked until sg-rules cites it

## 4. Acknowledgements

- [ ] 4.1 packages/core: write `documents/acknowledgements.test.ts` (request appears in employee inbox; 409 `not_viewed` before opening; records time/IP/UA/sha256; reminders day 3 and 7; new version needs new ack; not revocable; CSV export) then implement

## 5. Web UI

- [ ] 5.1 apps/web: write `e2e/documents.spec.ts` (HR uploads work pass with expiry, sees "Expiring", replaces it, previous versions listed; manager cannot see contract) then build the employee Documents tab and Settings → Document categories
- [ ] 5.2 apps/web: write `e2e/letters.spec.ts` (create confirmation template, unknown-field error, live preview, generate, missing-field list, request acknowledgement) then build the template editor and generator
- [ ] 5.3 apps/web: write `e2e/my-documents.spec.ts` at 360px (employee opens and acknowledges, uploads a certificate) then build My documents
