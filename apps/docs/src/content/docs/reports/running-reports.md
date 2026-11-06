---
title: Reports
description: The reports Crow HR ships, who can run each one, the exact formulas behind the numbers, and the CSV and XLSX exports.
---

**Reports** lists the reports you may run, grouped by the module that supplies the data. Each report has its parameters at the top, then a dense table (50 rows per page, sortable by any column, a totals row where totals make sense), the rules behind the numbers, and **CSV** and **Excel** (XLSX) download buttons. Where it helps, a simple bar chart follows the table; the table always comes first.

## The reports

| Report | What it shows | Who can run it |
| --- | --- | --- |
| Headcount | Employees on the books on a date, grouped by department, location, employment type, residency or work pass, with the share of the total. Optional monthly basic pay column. | Owner, HR admin |
| Headcount over time | Headcount at the end of each month (up to 36 months), with joiners and leavers in the month | Owner, HR admin |
| Joiners, leavers and turnover | Everyone who joined or left in a period, the reason for leaving, and the turnover rate | Owner, HR admin |
| Work pass expiry | Current employees' latest work passes that have expired or expire by a date, soonest first | Owner, HR admin, payroll admin |
| Leave taken | Approved leave in a period by leave type, by department and type, or by employee and type | Owner, HR admin; managers for their team |
| Leave balances and liability | Entitlement, carried forward, taken, pending and available leave as at a date, and the annual leave liability | Owner, HR admin; managers for their team |
| Lateness, missing punches and overtime | Days worked, hours, late days and minutes, early outs, missing punches, timesheet and approved overtime hours (up to 62 days) | Owner, HR admin; managers for their team |
| Scheduled hours | Shifts, rest days and paid hours per employee from published rosters (up to 62 days); drafts never count | Owner, HR admin; managers for their team |
| Claims by type, department or month | Claim amounts and GST by expense date, per status | Owner, HR admin, payroll admin |
| Claims waiting, by age | Claims waiting for approval or payment and how many days each has waited; waiting more than 7 days is flagged | Owner, HR admin, payroll admin |
| Cap usage by employee | For each employee and capped claim type in a month (yearly caps: that year): cap, used, pending, remaining and the share taken up | Owner, HR admin, payroll admin |
| Claims payout register | Paid claims with the payment date, payroll or outside payroll, and the reference | Owner, HR admin, payroll admin |
| Claim lines register | Every submitted claim line with merchant, description, amount, SGD, GST and receipt count | Owner, HR admin, payroll admin |
| Payroll cost | Gross pay, employer CPF, SDL, FWL estimate and total employer cost by month and department | Owner, payroll admin |

The permissions come from the server's [permission matrix](/docs/roles-and-permissions/) (`reports_people`, `reports_leave`, `reports_attendance`, `reports_claims`, `reports_payroll_cost`, `work_pass` for the expiry list, and `rosters` for scheduled hours). A report you may not run answers `403`; a report from a module that isn't installed answers `404`. Reports never run at "own" scope: an employee's own data is on their own pages.

## Scope and sensitive columns

- **Managers** see only their team (their direct and indirect reports) in leave and attendance reports. Totals are computed over the rows you can see, never over the whole company.
- **Salary columns** (headcount's monthly basic pay, leave liability, every payroll cost amount) need salary access to every employee in the report. An HR admin who is not also a payroll admin gets the report without those columns; the response and the export list them in `redactedColumns` (for example `basicPay`). An HR admin who also holds payroll admin sees them.
- **Work pass numbers** in the work pass expiry list are an identity field: readers without access to personal details get the list without them, listed in `redactedColumns` the same way.
- Viewing a report that shows sensitive columns (salary or work pass numbers) is audit-logged (`report.viewed`), and so is every export (`report.exported`, with the parameters, the row count and the columns left out).

## How the numbers are worked out

**Headcount** counts an employee on a date when a tenure has a start date on or before the date and either no last working day or a last working day on or after it. Someone whose last day is 31 Oct 2026 is counted on 31 Oct and not on 1 Nov; someone starting later is not counted yet. Department, location and employment type are the ones on the employment record in force on the date. Percentages are to one decimal place, rounded half-up.

**Turnover rate** = leavers in the period ÷ ((headcount at the start + headcount at the end) ÷ 2) × 100, to one decimal place, rounded half-up. With 40 people on 1 Jan, 44 on 31 Dec and 6 leavers, turnover is 6 ÷ 42 × 100 = 14.3%. When the average headcount is 0 the rate is shown as "n/a". A rehire counts as a joiner on the rehire date. Leavers are split into voluntary (resignation, retirement), involuntary (dismissal, retrenchment, contract end) and other (death, mutual agreement, or no reason recorded).

**Payroll cost** reads only finalised runs (approved or paid). A month with only a draft or in-review run shows no figures and the note "No finalised payroll for Nov 2026". The totals reconcile with payroll to the cent:

- gross pay, employer CPF, FWL, employee CPF and SHG are summed over the payslips of the month's effective runs; a run replaced by an adjustment run counts once, as the adjustment;
- SDL is the employer's monthly total exactly as payroll charged it (rounded once for the whole company), split across departments in proportion to each employee's SDL-liable wages; the cents left over by rounding go to the departments with the largest remainders, so the departments always add up to the month's SDL;
- employer total = gross pay + employer CPF (+ any employee CPF share the employer bore) + SDL + FWL;
- the department is the one on each payslip's employment snapshot (as at the end of the pay period).

FWL is an estimate from the levy settings, as on the [SHG, SDL and FWL](/docs/payroll/shg-sdl-fwl/) page; payroll never deducts it. Employee CPF and SHG are shown as deductions, not as employer cost.

**Leave liability** = available annual leave days × daily basic rate, where the daily rate is 12 × monthly basic salary ÷ (52 × working days a week), the Employment Act formula, rounded half-up to the cent. Hourly and daily-rated employees show no liability. Balances are for the leave year of the date, and pending requests are not counted as available.

**Leave taken** counts approved leave days in the period (half days as 0.5), with the department on each leave day. **Claims** leave out drafts, take the department on each expense date and count medical claims in every total. In the claim lines register, merchants, descriptions and receipt counts of medical lines are shown only to owners and HR admins (a payroll admin sees "Medical, hidden" and the amount). **Cap usage** counts approved and paid claims as used and submitted claims as pending, by expense date; remaining = cap − used − pending, never below zero. **Days waiting** counts whole days since submission, or since approval for claims approved but not yet paid.

## Exports

Every export holds the full result, not just the page on screen, with the same columns and redactions.

- **CSV**: UTF-8 with a byte-order mark (so Excel on Windows reads it correctly), comma-separated, RFC 4180 quoting, a header row of column titles, dates as `YYYY-MM-DD`, money as plain decimals with two places and no symbol (`1234.56`), percentages with one place. Text cells starting with `=`, `+`, `-` or `@` get a leading apostrophe so a spreadsheet cannot run them as formulas.
- **XLSX**: typed cells, money as numbers formatted `#,##0.00` (123456 cents is the number 1234.56), dates as real dates formatted `dd mmm yyyy`, a bold frozen header row with filters, a totals row, and a second sheet "Parameters" with the report, its parameters, the columns left out, who generated it and when.

An export of more than 50,000 rows is refused with `422 too_many_rows`; narrow the dates or pick a smaller group. CSV is streamed to the browser; XLSX is built batch by batch on the server.

## Not available

- Custom report builders, saved views, scheduled or emailed reports.
- The chart shows the rows on the current page of the table, not the whole result.
- Cost-centre breakdowns of payroll cost (payslips record the department only).
- The CPF EZPay file, bank file and IR8A export are payroll files, not reports; see [running payroll](/docs/payroll/running-payroll/).
