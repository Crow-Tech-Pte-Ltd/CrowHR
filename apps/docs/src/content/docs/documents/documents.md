---
title: Employee documents
description: Store contracts, passes, certificates and medical documents per employee in Crow HR, with category access rules, versions, expiry reminders and retention reviews.
---

Each employee has a **Documents** tab on their profile. The **Documents** page has **My documents** (your own documents, acknowledgements and letter requests) and, for HR, **Expiring**, **Acknowledgements** and **Retention review** across the company. HR manages categories and letter templates under **Settings → Documents**.

## Categories and who sees what

Every organisation starts with these categories:

| Category | Sensitivity | Employee sees | Manager sees | Employee uploads |
| --- | --- | --- | --- | --- |
| Contract & KETs | normal | yes | no | no |
| Identity & work pass | normal (views audited) | yes | no | yes |
| Certificates & licences | normal | yes | yes | yes |
| Medical | medical | yes | no | yes |
| Letters | normal | yes | no | no |
| Other | normal | no | no | no |

Access follows the `documents` rows of the [permission matrix](/docs/roles-and-permissions/) and each category's flags:

- **Owners and HR admins** see every category.
- **Payroll admins** see only categories marked "visible to payroll" (none by default), never medical.
- **Managers** see "manager-visible" categories for their own team, never medical. A medical category cannot be made manager-visible; the save fails and says why.
- **Employees** see their own documents in employee-visible categories, medical included, and former employees keep read-only access to them.

Anything outside your access answers `404`, exactly as if it did not exist. Every view or download of a medical or identity document is audit-logged. You can add categories, rename them and change their flags; a category that still holds documents, or is used by a letter template, cannot be deleted.

## Uploading

- Accepted: PDF, JPEG, PNG, WebP, DOCX and XLSX, up to **20 MB**. The type is checked from the file's content, never its name. DOCX and XLSX must be real Office packages; macro-enabled files (`.docm`, `.xlsm`) are refused with "Macro-enabled documents are not accepted. Save as .docx or PDF".
- Each document has a title (1 to 120 characters), a category, optional notes and an optional expiry date, which is required when the category says so.
- HR uploads to any category for any employee. Employees upload only to their own employee-uploadable categories (Identity & work pass, Certificates & licences, Medical).
- **Virus scanning is optional.** Configure your own clamd with `CLAMAV_HOST` / `CLAMAV_PORT` to enable the shared upload scan sweep. Crow HR does not bundle a scanner; without configuration, files are explicitly unscanned after content and size checks. See [configuration](/docs/self-hosting/configuration/#optional-virus-scanning).
- Files are served as downloads (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`); PDFs and images can also be opened in the browser. DOCX and XLSX are never rendered in the app.

**Replace** creates a new version. The previous version is marked superseded and stays downloadable by HR under "Previous versions"; the employee sees only the current one.

## Expiry

A document with an expiry date is **valid**, **expiring** (within 30 days) or **expired**, by today's date in Singapore. HR admins get a reminder 30 days before, 7 days before and on the expiry date; the employee gets it too when the category is visible to them. Each reminder is sent once. A newer version, or a newer document in the same category with a later expiry, stops the reminders for the old one. HR lists everything expiring or expired across the company, filtered by category, under **Documents → Expiring**. Home shows employees only acknowledgement requests, not expiring documents.

## Deleting and purging

Deleting is soft: the document disappears from every list and the deletion is audit-logged; it is kept in the database and storage. An **owner** can then purge a deleted document with a reason: its files are removed from storage, the row keeps only a tombstone, and the audit event records the reason and a hash of the original title.

Listing deleted documents (`GET /api/v1/documents?deleted=true`, HR only) and purging (`POST /api/v1/documents/{id}/purge`, owners only) are available through the [API](/docs/api/) only; the web app has no deleted-documents view or purge button yet.

## Retention review

The Employment Act requires employment records to be kept for an ex-employee for one year after they leave ([MOM: employment records](https://www.mom.gov.sg/employment-practices/employment-records)). The scheduled sweep flags an ex-employee's documents for review once the category's keeping period after the last working day has passed (12 months by default, set per category). Tax and CPF records may need longer, so you can raise the period for a category.

Flagging is all the sweep does. **Nothing is deleted automatically.** HR decides on each flagged document under **Documents → Retention review**: keep it for another 12 months (it is flagged again later) or delete it, which is the same soft delete as above, after which an owner may purge it.

## Not available

- Company-wide documents not tied to an employee, such as a handbook library.
- Full-text search inside documents, and OCR.
- Payslips and IR8A forms live in payroll, not here; see [payslips](/docs/payroll/payslips/).

Letters, KETs and acknowledgements are on the next page: [HR letters and KETs](/docs/documents/letters-and-kets/).
