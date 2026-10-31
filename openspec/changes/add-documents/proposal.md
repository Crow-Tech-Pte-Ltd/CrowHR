## Why

Today SMEs keep contracts, KETs, certificates and medical letters in shared drives with uncontrolled access, and retype the same employee details into Word for every offer or confirmation letter. The Employment Act requires KETs to be issued in writing. Generating letters from the employee record saves time and avoids errors, and per-category access keeps medical and identity documents away from people who should not see them.

## What Changes

- **Per-employee document store with categories.** Each category has a sensitivity (`normal` or `medical`), plus three flags: visible to the employee, visible to managers, and whether employees can upload to it. Default categories are Contract & KETs, Identity & work pass, Certificates & licences, Medical, Letters, and Other.
- **Upload rules:** PDF, JPEG, PNG, WebP, DOCX or XLSX, at most 20 MB, type checked by content, and the same optional virus-scan hook as claims. Replacing a document creates a new version and keeps the old one.
- **Expiry dates** on documents. Reminders (30 days, 7 days, and on the day) go through `workflows`, and Home and the employee list show "Expiring" and "Expired" states.
- **HR letter templates with merge fields.** The kinds are offer letter, KETs, probation confirmation, promotion, salary adjustment, resignation acceptance, certificate of employment, and custom. Templates are written in a restricted Markdown with a whitelisted `{{field}}` set, and are rendered to PDF and stored as a generated document. Unknown fields are rejected when the template is saved. Missing values block generation with a list. Salary fields need salary permission to generate.
- **KET template.** It ships with the mandatory KET items as required template sections. The list of mandatory fields comes from `research/sg-regulatory.md` (TODO; it is not invented here). The generator refuses to produce a KET document missing any mandatory item.
- **Acknowledgements.** HR can request that an employee acknowledge a document. The employee views it and clicks "I acknowledge", which records the time, the document hash, the IP and the user agent. Requests appear in the employee's Home inbox and are reminded after 3 days and again after 7. HR tracks outstanding acknowledgements.
- **Access rules** follow the `access-control` matrix and `medical` sensitivity. Every view and download of a medical or identity document is audit-logged. Deletion is soft, with an owner-only purge.

## Capabilities

### New Capabilities
- `documents`: document categories and storage, versions, expiry, letter templates and merge fields, KET generation, acknowledgements, access and audit.

### Modified Capabilities
None.

## Non-goals

- Legally binding e-signatures (Singpass Sign, DocuSign). Acknowledgement is not a signature.
- A WYSIWYG rich-text editor. Templates use restricted Markdown with a live preview.
- DOCX output (PDF only in v1).
- OCR or full-text search inside documents.
- Retention schedules and automated deletion, and PDPA data-subject request tooling (P1).
- Company-wide policy documents not tied to an employee, such as a handbook library (P1; acknowledgements are designed to extend to them).
- Payslips and IR8A forms, which payroll owns. The document list links to them.

## Impact

- `packages/core`: new `documents/` module and schema `documents.ts`. It reuses the shared `files` table and sniffer (from claims, or created here if it lands first). It needs a runtime-agnostic PDF renderer, shared with payslips. It registers an inbox source and a reminder source with `workflows`.
- `packages/sg-rules`: the KET mandatory-item list with citations, owned by the regulatory and sg-rules workstream.
- `apps/web`: a Documents tab on the employee profile, My documents, Settings → Document categories, and Letter templates (editor + preview).
