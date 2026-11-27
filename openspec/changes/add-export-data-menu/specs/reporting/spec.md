## ADDED Requirements

### Requirement: Discover and download generated data

The web application SHALL offer an Export data menu with the reports the member can export and links to the permitted workflows that generate native files. Each report SHALL be available in Excel, CSV and JSON, with a way to choose report parameters.

#### Scenario: Export leave data

- **WHEN** a manager exports a leave report
- **THEN** the full result uses the manager's team scope and excludes columns outside their permission

#### Scenario: Find approved payslips

- **WHEN** an employee opens Export data
- **THEN** they can find their available payslip PDFs and cannot download payroll registers

### Requirement: Structured and detailed datasets

The system SHALL export structured JSON using the same permission, scope, audit, row limit and redaction rules as the spreadsheet export. Detailed datasets SHALL include payroll per employee and run, leave requests by date range, and daily timesheets.

#### Scenario: Download a payroll register

- **WHEN** a payroll admin downloads the register
- **THEN** each row identifies the employee and run and distinguishes the computed net pay from the amount payable on that run
