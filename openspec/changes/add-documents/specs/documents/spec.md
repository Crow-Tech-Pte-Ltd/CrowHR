## Purpose

Defines per-employee document storage with category-based access, expiry tracking, HR letter generation from templates (including KETs), and employee acknowledgements.

## ADDED Requirements

### Requirement: Document categories
Owners and hr_admins SHALL maintain document categories with: name, sensitivity (`normal` or `medical`), `employee_visible`, `manager_visible`, `payroll_visible` and `employee_uploadable` flags, and `expiry_required`. Every default category has `payroll_visible` off. New organisations SHALL get these defaults:

| Category | Sensitivity | Employee sees | Manager sees | Employee uploads |
| --- | --- | --- | --- | --- |
| Contract & KETs | normal | yes | no | no |
| Identity & work pass | normal (views audited) | yes | no | yes |
| Certificates & licences | normal | yes | yes | yes |
| Medical | medical | yes | no | yes |
| Letters | normal | yes | no | no |
| Other | normal | no | no | no |

A category containing documents SHALL NOT be deleted. A `medical` category SHALL NOT be made manager-visible.

#### Scenario: Medical cannot be manager-visible
- **WHEN** an hr_admin sets `manager_visible` on the Medical category
- **THEN** the save fails with a message that medical documents are visible only to HR, owners and the employee

### Requirement: Document upload and versions
Owners and hr_admins SHALL upload documents to any category for an employee in scope. Employees SHALL upload only to their own `employee_uploadable` categories. Files SHALL be PDF, JPEG, PNG, WebP, DOCX or XLSX, identified by signature, and at most 20 MB. DOCX and XLSX SHALL be accepted only by signature plus a valid OOXML package structure, and macro-enabled formats SHALL be refused. Each document has a title (1 to 120 characters), a category, an optional expiry date (required when the category requires it) and optional notes. Uploading a replacement SHALL create a new version, mark the previous one `superseded` and keep it downloadable by HR. Virus-scan behaviour SHALL match the claims receipt rules.

#### Scenario: Macro document refused
- **WHEN** an hr_admin uploads `contract.docm`
- **THEN** it is rejected with "Macro-enabled documents are not accepted. Save as .docx or PDF"

#### Scenario: Replacement keeps history
- **WHEN** a renewed work pass scan replaces the old one
- **THEN** the employee's list shows the new file, and HR can open "Previous versions (1)"

### Requirement: Document access and audit
Reading a document SHALL follow the `access-control` matrix and category flags. Owners and hr_admins see all. Payroll_admins see only `payroll_visible` categories. Managers see only `manager_visible` categories for their team. Employees see their own `employee_visible` categories. `medical` documents SHALL be readable only by owner, hr_admin and the employee. Downloads SHALL be served through an authorised route with `Content-Disposition: attachment` (images may display inline) and `X-Content-Type-Options: nosniff`. Every view or download of a `medical` document or an Identity & work pass document SHALL be audit-logged. Deleting SHALL be soft: the document is hidden, kept, and audit-logged. Owners SHALL be able to purge a soft-deleted document permanently, with a reason, which also removes its file from storage.

#### Scenario: Manager blocked from contract
- **WHEN** a manager requests a team member's KET document by ID
- **THEN** the response is 404 `not_found`

#### Scenario: Purge
- **WHEN** an owner purges a soft-deleted medical certificate with reason "Uploaded to wrong employee"
- **THEN** the file is removed from storage, the metadata row is replaced by a tombstone, and the audit event records the reason

### Requirement: Expiry tracking
Documents with an expiry date SHALL be `valid`, `expiring` (within 30 days) or `expired`, computed from today's date in Asia/Singapore. Through `workflows`, reminders SHALL go to hr_admins, and to the employee for categories visible to them, at 30 days before, 7 days before, and on the expiry date. A newer version, or a new document in the same category with a later expiry, SHALL stop reminders for the old one. HR SHALL be able to list expiring and expired documents across the organisation, filtered by category.

#### Scenario: Certificate expiring
- **WHEN** a forklift licence expires on 30 Nov 2026 and today is 31 Oct 2026
- **THEN** it shows as `expiring`, and the 30-day reminder has been sent to hr_admins and the employee

### Requirement: Letter templates and merge fields
Owners and hr_admins SHALL create letter templates of kind `offer`, `ket`, `confirmation`, `promotion`, `salary_adjustment`, `resignation_acceptance`, `employment_certificate` or `custom`. A template is written in restricted Markdown: headings, paragraphs, bold and italic, lists, tables and page breaks. Raw HTML, images other than the organisation logo, and links other than `https` links SHALL be rejected. Merge fields `{{namespace.field}}` SHALL come from a published whitelist:
- `org.*`: legal name, UEN, address, logo;
- `employee.*`: names, employee number, masked NRIC/FIN, address;
- `employment.*`: job title, department, location, manager, start date, employment type, probation end, working days and hours from the work schedule, last working day, notice period;
- `compensation.*`: basic pay, pay basis, allowances (`salary` class);
- `today`, `signatory.*`.

Saving a template with an unknown field SHALL fail, naming the field and its line. Formatting SHALL follow Singapore conventions: `S$4,200.00` and `31 Oct 2026`. Full NRIC SHALL NOT be a merge field.

#### Scenario: Unknown field
- **WHEN** a template containing `{{employee.salary}}` is saved
- **THEN** the save fails with "Unknown field employee.salary on line 12. Did you mean compensation.basic_pay?"

### Requirement: Letter generation
Generating a letter for an employee SHALL resolve every merge field as at a chosen effective date. If any field has no value, generation SHALL be blocked with the list of missing fields and where to fill each one. A template using `compensation.*` SHALL be generatable only by members with `salary` read access to that employee. Otherwise generation fails with 403 and names the fields. The output SHALL be a PDF with the organisation logo and a plain letter layout, stored as a document in the template's target category (Contract & KETs for `offer` and `ket`, Letters otherwise) with `source: generated` and the template version. Generation SHALL offer to request an acknowledgement.

#### Scenario: hr_admin generates offer with salary
- **WHEN** an hr_admin without payroll_admin generates an offer letter that uses `compensation.basic_pay`
- **THEN** generation fails with 403, stating that salary fields need a payroll admin or owner to generate

#### Scenario: Missing manager
- **WHEN** a confirmation letter uses `employment.manager_name` and the employee has no manager
- **THEN** generation is blocked, listing "Manager (set it on the employment record)"

### Requirement: KET template
The system SHALL ship a default KET template whose sections cover every mandatory KET item listed in `packages/sg-rules` (TODO: list and citation from `research/sg-regulatory.md`; until then the KET template is marked NOT IMPLEMENTED in the UI and cannot be used). Organisations SHALL be able to edit the wording but SHALL NOT remove a mandatory item's merge field. Generating a KET SHALL fail when any mandatory item resolves to empty, unless HR enters a value for this document only, which is recorded on the document. The onboarding checklist item "Issue KETs" SHALL be completed automatically when a KET is generated for that employee.

#### Scenario: Mandatory item removed
- **WHEN** an hr_admin deletes the working-hours section from the KET template and saves
- **THEN** the save fails, naming the missing mandatory item

### Requirement: Acknowledgements
Owners and hr_admins SHALL request an acknowledgement on any employee-visible document. The employee SHALL see it in their Home inbox. Acknowledging SHALL require opening the document first. It records the time, the IP address, the user agent and the SHA-256 of the exact file version acknowledged. Reminders go to the employee after 3 and 7 days. A new version of the document SHALL require a new acknowledgement. HR SHALL see outstanding and completed acknowledgements per document and per employee, exportable to CSV. An acknowledgement SHALL NOT be revocable by the employee.

#### Scenario: Acknowledge KET
- **WHEN** an employee opens their KET and clicks "I acknowledge"
- **THEN** the document shows "Acknowledged 2 Dec 2026, 10:14" with the file hash recorded, and the Home item disappears

#### Scenario: Acknowledge without opening
- **WHEN** the acknowledge endpoint is called for a document the employee has not opened
- **THEN** it fails with 409 `not_viewed`
