## Why

"Limited custom reporting" is a recurring complaint about QuickHR. SME owners need a handful of trustworthy numbers: how many people we employ, who joined and left, leave taken, claims spent, attendance exceptions, and what payroll cost by department. They also need every one of them in Excel. A BI builder is not what they need. Reports must respect the same permissions and field sensitivity as the screens, or they become the easiest way to leak salaries.

## What Changes

- **A report registry.** Each module defines its reports next to its own data as `ReportDefinition`s: ID, title, owning module, permission, typed parameters, columns with types and sensitivity, and a query. Reporting provides the catalogue, parameter forms, permission and redaction enforcement, pagination, totals and exports. It never queries other modules' tables itself.
- **v1 reports and the module each reads:**

  | Report | Reads |
  | --- | --- |
  | Headcount as at a date, by department, location, employment type and residency | employees |
  | Joiners and leavers, with turnover rate for a period | employees |
  | Work pass expiry | employees |
  | Leave balances, and leave taken by type and department | leave |
  | Claims by type, department and month; status ageing; cap usage; payout register | claims |
  | Attendance exceptions (late, absent, missing punch) and hours | attendance |
  | Payroll cost by month and department or cost centre (gross, employer CPF, SDL, FWL, employer total), from finalised runs only | payroll |

- **Fixed formulas.** Turnover rate is leavers in the period ÷ average headcount (the mean of headcount at the start and at the end) × 100, to 1 decimal place. Headcount counts employees with an active tenure on the date.
- **Exports:** CSV (UTF-8 with BOM, RFC 4180, ISO dates, money as plain decimals) and XLSX (typed cells; money in a `#,##0.00` format; dates as real dates; a header row with filters; a parameters sheet). Up to 50 000 rows. Every export is audit-logged.
- **On-screen reports** use the dense table pattern: sticky header, right-aligned mono numbers, 50 rows per page, column totals where meaningful, and a "Download CSV / XLSX" button.

Attendance and payroll reports activate when those modules land. Until then their catalogue entries are absent, not stubbed.

## Capabilities

### New Capabilities
- `reporting`: report registry and catalogue, permission and sensitivity enforcement, defined v1 reports and formulas, CSV/XLSX export.

### Modified Capabilities
None. Each module's report definitions are part of that module's change (claims already lists its reports), and this change specifies the shared contract and the people reports.

## Non-goals

- A custom report builder, ad-hoc pivots, charts and dashboards (P1 at the earliest).
- Scheduled or emailed reports.
- Saved views and filter presets (P1).
- Statutory files (CPF EZPay, IR8A export, bank files). They belong to payroll changes, not reports.
- Accounting journal export (Xero/QBO, P1).
- Direct SQL or BI access. Self-hosters already have the database, and docs can point to a read-only role later.

## Impact

- `packages/core`: new `reporting/` module (registry, runner, export writers) and the routes `GET /api/v1/reports`, `GET /api/v1/reports/{id}`, `GET /api/v1/reports/{id}/export`. People reports live in `employees/reports.ts`. Other modules add `reports.ts` in their own directory.
- A shared export writer used by employees export, scheduling export and audit-log export.
- New dependency: an XLSX writer that runs in browser and Node (`write-excel-file`, MIT, or a minimal writer on `fflate`).
- `apps/web`: Reports catalogue and report page.
