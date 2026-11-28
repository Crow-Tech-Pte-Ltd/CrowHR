## Purpose

Lets authorised members download printable copies of their company reports.

## ADDED Requirements

### Requirement: Branded PDF report export

Every report SHALL offer a PDF download from the report page and its shortcut in Export data. The PDF SHALL identify the company and include its configured PNG logo when available. It SHALL include the resolved filters, every matching row in the selected order, the visible columns, and any totals, summaries and notes. Tables SHALL repeat their column headings on continuation pages. Existing report export permissions, scope, redaction, recent authentication requirements, row limit and audit logging SHALL also apply to PDF. The employee directory download keeps its existing formats.

#### Scenario: Company logo and filtered results
- **WHEN** an authorised member downloads a filtered report for a company with an uploaded logo
- **THEN** the PDF shows that company's name and logo along with the resolved filters and all matching rows

#### Scenario: Company without a logo
- **WHEN** an authorised member downloads a report for a company without a logo
- **THEN** the PDF shows that company's name and downloads successfully

#### Scenario: Sensitive columns in PDF
- **WHEN** an HR admin without salary access requests headcount with the optional basic pay column
- **THEN** the PDF omits the column's values and the export audit event records the redaction
