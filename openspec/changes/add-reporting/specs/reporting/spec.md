## Purpose

Defines the fixed set of operational and cost reports, how they respect permissions and field sensitivity, the exact formulas behind their numbers, and CSV/XLSX export.

## ADDED Requirements

### Requirement: Report catalogue
The system SHALL list the reports the member may run, grouped by module. Reports SHALL appear only for modules that are installed and enabled. Each entry SHALL show its title, a one-line description and the data source module. Running a report the member may not run SHALL return 403 `forbidden`. Requesting a report from a disabled module SHALL return 404.

#### Scenario: Manager catalogue
- **WHEN** a manager opens Reports
- **THEN** they see the leave and attendance reports (team-scoped), and do not see payroll cost or headcount

### Requirement: Permission and sensitivity enforcement
Report rows SHALL be limited to the member's scope for the report's resource (A or T per the matrix). Columns with a sensitivity class the member cannot read SHALL be omitted from both screen and export, and listed in the response's `redactedColumns`. Totals SHALL be computed only over rows the member can see. Payroll cost reports SHALL be available only to owners and payroll_admins.

#### Scenario: hr_admin and salary column
- **WHEN** an hr_admin runs headcount with the optional "basic pay" column requested
- **THEN** the column is omitted and `redactedColumns` contains `basicPay`

### Requirement: Headcount report
Headcount as at a date (default today, Asia/Singapore) SHALL count employees with a tenure where hire date ≤ date and (no last working day, or last working day ≥ date). It SHALL group by any one of: department, location, employment type, residency status, and work pass type. Each group shows count and percentage of total, to 1 decimal place. Employees whose hire date is after the date SHALL NOT be counted.

#### Scenario: Leaver on the date
- **WHEN** an employee's last working day is 31 Oct 2026 and headcount is run as at 31 Oct 2026
- **THEN** they are counted, and as at 1 Nov 2026 they are not

### Requirement: Joiners, leavers and turnover
For a date range, the report SHALL list joiners (tenure hire date in the range) and leavers (last working day in the range), each with the cessation reason for leavers. It SHALL compute turnover rate = leavers ÷ ((headcount at range start + headcount at range end) ÷ 2) × 100, rounded half-up to 1 decimal place, and show "n/a" when the average headcount is 0. A rehire SHALL count as a joiner on the rehire date. Leavers SHALL be breakable into voluntary (resignation, retirement) and involuntary (dismissal, retrenchment, contract end). Death and mutual agreement are shown separately.

#### Scenario: Turnover calculation
- **WHEN** headcount was 40 on 1 Jan 2026 and 44 on 31 Dec 2026, with 6 leavers in 2026
- **THEN** turnover is 14.3% (6 ÷ 42 × 100 = 14.285…)

### Requirement: Module reports through definitions
Leave, claims, attendance and payroll SHALL contribute reports through report definitions that declare: parameters, columns (type `text`, `integer`, `money_cents`, `date`, `datetime` or `percent`, with sensitivity), default sort, and which columns total. The v1 set SHALL include:
- leave balances as at a date and leave taken by type and department;
- the claims reports specified in `claims`;
- attendance exceptions and hours by employee and period;
- payroll cost by month and department or cost centre.

Payroll cost SHALL read only finalised payroll runs, and SHALL show gross pay, employer CPF, SDL, FWL and total employer cost. Employee CPF and SHG SHALL be shown as deductions, not employer cost. A report definition SHALL NOT read another module's tables directly. It reads through that module's services.

#### Scenario: Draft payroll excluded
- **WHEN** November's payroll run is still a draft and payroll cost is run for November
- **THEN** November shows no figures and a note "No finalised payroll for Nov 2026"

### Requirement: On-screen presentation
Report pages SHALL show parameters at the top, then a dense table: sticky header, right-aligned tabular numbers, money as `S$1,234.56`, dates as `31 Oct 2026`, 50 rows per page, sortable by any column, a totals row for totalling columns, and loading, empty and error states. An empty result SHALL say which parameters produced no rows and suggest widening them.

#### Scenario: Empty result
- **WHEN** claims by department for a month with no claims is run
- **THEN** the page says "No claims with expense dates in Jan 2026" and offers to change the month

### Requirement: CSV and XLSX export
Every report SHALL export the full result, not just the current page, as CSV or XLSX, with the same columns and redactions as the screen:
- **CSV:** UTF-8 with BOM, comma-separated, RFC 4180 quoting, header row of column titles, dates as `YYYY-MM-DD`, money as plain decimal strings with 2 places and no currency symbol or thousands separator (`1234.56`), percentages as decimals with 1 place. Cells beginning with `=`, `+`, `-` or `@` SHALL be prefixed with an apostrophe to prevent formula injection.
- **XLSX:** one sheet of data with typed cells, money as numbers formatted `#,##0.00`, dates as date cells formatted `dd mmm yyyy`, a frozen header row with auto-filter, and a second sheet "Parameters" listing the report, its parameters, the generator and the generation time.

Exports above 50 000 rows SHALL be refused with 422 `too_many_rows` and advice to narrow the parameters. Every export SHALL be audit-logged with the report ID, parameters, row count and redacted columns.

#### Scenario: Formula injection neutralised
- **WHEN** a claim merchant is `=HYPERLINK("http://x")` and claims are exported to CSV
- **THEN** the cell is written as `'=HYPERLINK("http://x")`

#### Scenario: Money exact in XLSX
- **WHEN** a payroll cost cell is 123456 cents
- **THEN** the XLSX cell holds the number 1234.56 with format `#,##0.00`
