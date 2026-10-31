## Purpose

Defines how a Singapore SME's statutory and company leave is configured, earned, applied for, approved, cancelled and reported, and what the leave module hands to payroll, government claims and scheduling.

## ADDED Requirements

### Requirement: Preconfigured statutory leave types
Every organisation SHALL have, without any setup, these leave types with statutory defaults: annual, outpatient sick, hospitalisation, maternity, paternity, shared parental, childcare, extended childcare, unpaid infant care, adoption, NS, no-pay, and compassionate (company, 3 days). Statutory types SHALL NOT be deletable or have their statutory floor lowered; admins MAY make them more generous, rename them, or add custom types (code, name, paid or unpaid, entitlement, half days, attachment rule, sensitivity). Eligibility and effective dates SHALL come from the statutory rules package.

#### Scenario: New organisation
- **WHEN** an owner opens Settings → Leave policies for the first time
- **THEN** all statutory types are listed as active with their statutory entitlement, and no configuration is required to apply for annual leave

#### Scenario: Policy below statutory
- **WHEN** an admin sets annual leave for service year 1 to 5 days
- **THEN** the change is refused with 422 `below_statutory`, saying the minimum is 7 days

### Requirement: Entitlements and balances
The leave year SHALL be the calendar year. Annual leave SHALL be 0 until 3 completed months of service, then pro-rated by completed months in the first calendar year of service and the year of leaving (half a day or more rounds up), with full-year days by service year never below the Employment Act scale. Accrual SHALL be upfront or monthly per policy. Outpatient sick and hospitalisation leave SHALL follow the statutory steps by completed months (5/15, 8/30, 11/45, 14/60) and outpatient days taken SHALL count against the hospitalisation total. Parental leave SHALL be per child. A balance SHALL show entitlement, carried forward, adjustments, taken, pending and available, with an explanation of how the entitlement was worked out. Part-time employees SHALL hold annual, sick and hospitalisation leave in hours, from the comparable full-timer's weekly and daily hours.

#### Scenario: Eligibility at three months
- **WHEN** an employee hired on 14 Jul 2026 checks annual leave on 13 Oct 2026, and again on 14 Oct 2026
- **THEN** the first shows 0 days, "Eligible from 14 Oct 2026"; the second shows 2 days (3/12 × 7 = 1.75)

#### Scenario: Hospitalisation includes outpatient
- **WHEN** an employee with 14/60 days has taken 14 outpatient days
- **THEN** outpatient shows 0 available and hospitalisation shows 46 available

#### Scenario: Part-timer in hours
- **WHEN** a 20-hours-a-week part-timer's comparable full-timer works 44 hours over 5.5 days at 8 hours a day
- **THEN** their year-1 annual leave is 25.5 hours

### Requirement: Working-day calculation
Leave SHALL count only the employee's working days (half days as 0.5, or the day's hours for hour-based balances) from their work schedule in force on each date. Rest days, off days and the employee's public holidays SHALL NOT be counted. The employee's public holidays SHALL be the gazetted holidays plus the organisation's ad-hoc holidays, substituted per MOM: a Sunday holiday moves to the gazetted Monday for a Sunday rest day; a holiday on another rest day moves to the next working day; a holiday on an off day gives no day off unless the organisation's setting moves it to the next working day. Maternity, paternity, shared parental and adoption leave SHALL count holidays inside the period. A leave spanning two leave years SHALL be split by year.

#### Scenario: Saturday holiday, 5-day week
- **WHEN** a Monday–Friday employee (Saturday off, Sunday rest) applies for 20–23 Mar 2026 (Hari Raya Puasa on Saturday 21 Mar)
- **THEN** the leave counts 2 days (Fri 20, Mon 23) and Monday is not a holiday

#### Scenario: Saturday rest day
- **WHEN** an employee whose rest day is Saturday and who works Sunday applies for 21–23 Mar 2026
- **THEN** 21 Mar is a rest-day holiday, Sunday 22 Mar becomes the paid holiday, and only Monday 23 Mar counts

#### Scenario: Across the year end
- **WHEN** an employee applies for 30 Dec 2026 – 4 Jan 2027
- **THEN** 2026 is charged 2 days and 2027 is charged 1 day (1 Jan is a holiday, 2–3 Jan are off and rest days)

### Requirement: Applying for leave
An employee SHALL apply with type, dates, half-day sessions, reason, attachments and (for parental types) a child. A quote SHALL return the working days, each counted date, the balance before and after, and every reason the application would fail. An application SHALL fail with 422 when the employee is not eligible, the balance is insufficient (counting pending requests), the dates overlap an open or approved request in the same session, a required attachment is missing, or the type does not allow half days. Two concurrent applications SHALL NOT both pass on a balance that covers one. Owners and hr_admins MAY apply on behalf of an employee.

#### Scenario: Racing applications
- **WHEN** an employee with 2 days available submits two 2-day applications at the same time
- **THEN** exactly one is created and the other fails with `insufficient_balance`

#### Scenario: MC required
- **WHEN** an employee applies for outpatient sick leave without an attachment
- **THEN** the application fails, saying to attach the medical certificate

### Requirement: Approval and cancellation
Every application SHALL be submitted to the workflows engine as subject `leave` in the same transaction. On final approval the balance SHALL be re-checked and the days charged in the decision's transaction; a balance that no longer covers the leave refuses the approval with the reason. Rejection and withdrawal SHALL release pending days. Cancelling approved leave SHALL be submitted as subject `leave_cancellation`; on approval the days are restored, on rejection the leave stays approved. Owners and hr_admins MAY cancel directly, recorded in the audit log.

#### Scenario: Cancelling approved leave restores the balance
- **WHEN** an employee cancels approved 2-day annual leave and the manager approves the cancellation
- **THEN** the request shows Cancelled and the available balance is 2 days higher

### Requirement: Calendar and visibility
The team calendar SHALL show, for a date range, who is on leave by half day. Leave types and reasons SHALL be visible only to viewers whose `leave:read` scope covers the employee. Other members SHALL see "On leave" for sensitive types (sick, hospitalisation, maternity, infant care, no-pay, and any type marked sensitive) and the type name otherwise. Medical attachments SHALL be readable only by the requester, owners, hr_admins and the request's approvers.

#### Scenario: Colleague views sick leave
- **WHEN** an employee opens the calendar on a day a colleague in another team is on sick leave
- **THEN** the colleague shows as "On leave" with no type or reason

### Requirement: Adjustments, holidays and settings
Owners and hr_admins SHALL adjust a balance (positive or negative, with a reason) and add ad-hoc public holidays (such as Polling Day); both are audit-logged inside the change's transaction.

#### Scenario: Adjustment audit
- **WHEN** an hr_admin adds 1.5 days to an employee's annual leave with reason "Long service award"
- **THEN** the balance increases by 1.5 and the audit log records the adjustment

### Requirement: Year-end processing
After a leave year ends, the scheduled sweep SHALL, once per organisation and year, carry forward each employee's unused balance up to the policy cap (and, for Part 4 employees, at least the unused statutory annual leave), forfeit the rest (or mark it for encashment when the policy allows), and expire carried-forward leave not taken by the policy's expiry date, using carried days first.

#### Scenario: Carry-forward expiry
- **WHEN** 5 days were carried into 2027 with expiry 31 Mar 2027 and the employee took 3 days in February
- **THEN** on 1 Apr 2027 the sweep expires 2 days, and running it again changes nothing

### Requirement: Payroll and government outputs
The module SHALL provide, for an organisation and pay period, the approved unpaid leave (no-pay and unpaid infant care) per employee and date in half days, with a stable source id. It SHALL report government-paid leave days for a period (employee, type, child, dates, employer-paid days, government-paid days, claim deadline), exportable as CSV, readable by owners, hr_admins and payroll_admins only.

#### Scenario: No-pay leave reaches payroll
- **WHEN** an employee's 1.5 days of no-pay leave on 16–17 Nov 2026 (the morning of the 17th only) are approved
- **THEN** the unpaid-leave source for November lists 16 Nov 1 day and 17 Nov 0.5 day for that employee

#### Scenario: GPML weeks split
- **WHEN** a mother of a first Singapore-citizen child takes 16 weeks of maternity leave on a 5-day week
- **THEN** the report shows days 1–40 employer-paid and days 41–80 government-paid
