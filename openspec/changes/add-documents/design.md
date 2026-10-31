## Context

Depends on identity and access (matrix, medical sensitivity, audit), organisation and people (employee, employment and compensation as-at, checklists), workflows (inbox, reminders, notifications) and the shared `files` table and sniffer introduced by whichever of claims or documents lands first. Payslip PDFs (payroll, M1) also need a PDF renderer. Requirements are in `specs/documents`.

## Goals / Non-Goals

**Goals:** one PDF renderer shared with payslips, runtime-agnostic so the demo can generate letters in the browser; templates that cannot inject HTML or script; an evidential acknowledgement record (exact bytes acknowledged).

**Non-Goals:** pixel-perfect Word fidelity.

## Decisions

1. **Restricted Markdown → AST → PDF.**
   - Templates are parsed with `micromark`/`mdast` in a whitelist mode. Unsupported nodes (HTML, images, non-https links) fail validation at save.
   - Merge fields are resolved on the AST, never by string substitution into HTML, so field values cannot inject markup.
   - The AST is rendered with a pure-JS PDF library: `pdfmake` (MIT, runs in browser and Node, built-in table layout) is the candidate, and the alternative `pdf-lib` needs a hand-written layout.
   - The renderer lives at `packages/core/src/pdf/` and is shared with payslips. Whichever of payroll or documents lands first creates it, and the other reuses it.
   - Fonts: Ubuntu for body and Azeret Mono for numbers, embedded from the self-hosted font files so output is deterministic.

2. **The merge-field registry is typed.** `fields.ts` declares each field's namespace, label, sensitivity class, resolver `(ctx, employeeId, asAt) → string | null` and formatter. Template validation, the editor's field picker, permission checks (any `salary` field → requires salary read) and missing-value reporting all come from it. Masked NRIC uses the access-control mask function.

3. **KET mandatory items are data from sg-rules.** `sgRules.ket.mandatoryItems(asAt) → { id, label, fieldIds[], source }[]`. The default KET template marks sections with `<!-- ket:<id> -->` anchors (comments are allowed only as anchors). Validation checks that each mandatory item's anchor and at least one of its fields are present. Until sg-rules returns cited items, the function throws `NotImplemented`, and the UI shows the KET kind as "Coming soon" rather than offering an unchecked template.

4. **Generated documents are frozen.** Each one stores the PDF bytes (as a file), the template ID and version, the as-at date, and a JSON snapshot of the resolved field values (excluding `salary` fields for audit readers without access). Regeneration creates a new version.

5. **Acknowledgement evidence.** `document_views` records the first open per member per version, which is required before acknowledging. The acknowledgement stores `file_sha256` of the version opened. Reminders use the workflows `ReminderSource` with thresholds of 3 and 7 days.

6. **Purge.** It deletes the file from `FileStore` and replaces the row's title, notes and file ID with a tombstone. The audit trail keeps the purge event with the reason and the original title hash.

## Data model sketch

All tables have `org_id`, and FKs are composite.

| Table | Key columns |
| --- | --- |
| `document_categories` | `id`, `org_id`, `name`, `sensitivity`, `employee_visible`, `manager_visible`, `payroll_visible`, `employee_uploadable`, `expiry_required`, `position` |
| `documents` | `id`, `org_id`, `employee_id`, `category_id`, `title`, `notes`, `current_version_id`, `deleted_at?`, `purged_at?` |
| `document_versions` | `id`, `org_id`, `document_id`, `version`, `file_id`, `expires_on?`, `source` (upload, generated), `template_id?`, `template_version?`, `as_at?`, `field_snapshot jsonb?`, `uploaded_by`, `created_at`, `superseded_at?` |
| `letter_templates` | `id`, `org_id`, `kind`, `name`, `body_md`, `version`, `active`, `target_category_id`, `updated_by` |
| `document_views` | `org_id`, `document_version_id`, `membership_id`, `first_viewed_at` |
| `acknowledgement_requests` | `id`, `org_id`, `document_version_id`, `employee_id`, `requested_by`, `requested_at`, `acknowledged_at?`, `ip?`, `user_agent?`, `file_sha256?` |

## Risks / Trade-offs

- [The KET list depends on research] → generation is blocked, visibly, until it is cited. Honest beats a non-compliant KET.
- [pdfmake bundle size in the web and demo builds (~1 MB with fonts)] → it is loaded lazily in the demo only when generating. The server renders in Node.
- [DOCX uploads can carry exploits for whoever opens them] → files are served as attachments, macro formats are refused, the scanner hook is available, and DOCX is never rendered in-app.

## Open Questions

- A shared PDF renderer owner (payroll or documents, whichever is first) to be confirmed by the lead. It does not change the specs.
