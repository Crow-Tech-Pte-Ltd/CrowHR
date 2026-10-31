## Purpose

Defines the content of payslips, when employees can see them, and how they are rendered and downloaded.

## ADDED Requirements

### Requirement: Itemised payslip content
Every payslip SHALL contain MOM's itemised-payslip items (research/sg-regulatory.md §7): employer's full name; employee's full name; date of payment; basic salary, or for hourly-rated staff the rate and hours; start and end of the salary period; fixed and ad hoc allowances; other additional payments; fixed and ad hoc deductions (including employee CPF and no-pay leave); overtime hours; overtime pay; the overtime period when it differs from the salary period; and net salary. It SHALL also show employer CPF, SHG fund, the CPF rate table and age band used, and year-to-date AW subject to CPF. A payslip missing a mandatory item SHALL NOT be released, and the release SHALL name the missing item.

#### Scenario: Missing employer name
- **WHEN** the company profile has no legal name and a payroll_admin releases payslips
- **THEN** release fails naming "Employer's full name" and how to fix it

### Requirement: Release
Payslips SHALL be visible to employees only after the run is approved and a payroll_admin or owner has released them, unless the organisation turns on automatic release on approval. Release SHALL be audit-logged. An adjustment's payslip SHALL be labelled as a revision of the original.

#### Scenario: Approved but not released
- **WHEN** a run is approved and not yet released
- **THEN** employees do not see the payslip in Me → Payslips and the API answers 404 for it

### Requirement: Employee self-service
An employee SHALL list, view and download only their own released payslips under Me → Payslips. A former member SHALL keep read-only access to their released payslips. Another employee's payslip SHALL answer 404.

#### Scenario: Leaver downloads payslip
- **WHEN** a former employee signs in after leaving
- **THEN** they can list and download their released payslips

### Requirement: PDF rendering
Payslip PDFs SHALL be rendered by a runtime-agnostic, pure-JavaScript renderer that also runs in the browser, with fonts shipped in the repository (no font downloads at run time). The same payslip SHALL render byte-identical PDFs. Amounts SHALL be formatted `S$1,234.56` and dates `31 Oct 2026`; NRIC/FIN SHALL be masked.

#### Scenario: Deterministic PDF
- **WHEN** the same released payslip is downloaded twice
- **THEN** both files have the same SHA-256
