## ADDED Requirements

### Requirement: Appendix 8A and 8B records
A payroll_admin or owner SHALL record, per employee and income year, Appendix 8A benefits-in-kind (a place of residence with its utilities, driver and servant costs; a hotel stay; a car; home leave passages, loan interest, insurance premiums, holidays, educational expenses, club fees, gains from assets, a motor vehicle given, or another non-monetary benefit) and Appendix 8B share-plan gains (ESOP or ESOW). The system SHALL allow at most 10 places of residence and 30 share-plan records per employee and year, SHALL require dates inside the income year (a share gain's exercise, vesting or moratorium-lifted date in the year and not before its grant date), and SHALL reject a share record without a gain because IRAS does not take losses. Permission checks SHALL be enforced server-side (`payroll:read` to view, `payroll:update` to change). Every create, change and delete SHALL be audit-logged with the changed fields. Records of another organisation SHALL be indistinguishable from missing ones.

#### Scenario: Record a benefit
- **WHEN** a payroll_admin records a rented flat for an employee for 1 Jan to 31 Dec 2026 with rent S$50,000 shared by 2 employees and S$6,000 paid by the employee
- **THEN** the record is saved, shows taxable value S$19,000 with its working, and an audit event `payroll.ir8a_appendix_created` is written

#### Scenario: Permission denied
- **WHEN** an hr_admin or an employee tries to list or create appendix records
- **THEN** the request is refused with 403 and nothing is saved

#### Scenario: Another organisation's record
- **WHEN** an owner of organisation A updates or deletes an appendix record of organisation B, or records one for B's employee
- **THEN** the response is 404 and B's data is unchanged

#### Scenario: Loss on a share plan
- **WHEN** the open market value per share is not above the price paid
- **THEN** the record is refused with a message that IRAS does not take losses and they cannot be offset against other plans

### Requirement: Computed benefit values follow IRAS's published formulas
The system SHALL compute, with an effective-dated and cited rule set in `packages/sg-rules`: days of occupation and car use (both ends counted); for premises not rented by the employer, the annual value for the period (annual value ÷ employees sharing × days ÷ 365) unless HR enters it, and furniture and fittings at 40% of it when partly and 50% when fully furnished; for rented premises, the rent paid for the period ÷ employees sharing; the taxable value of the residence less rent paid by the employee, clamped at zero; the driver benefit (annual cost × private ÷ total mileage); the hotel cost less the employee's payment, clamped at zero; the car benefit 3/7 × [(car cost − PARF rebate) ÷ 10 × days ÷ days in year + running costs] for a new car, with the remaining COE years for a second-hand car, (renewal cost + forgone PARF rebate) ÷ renewal years for a renewed COE, and 3/7 × (rental + running costs) for a leased car; and the Appendix 8B gross gain (open market value − price paid) × shares. Computed values SHALL be rounded down to the cent and every result SHALL carry its working. Values IRAS gives no formula for SHALL be the amounts HR enters. In an income year that is a leap year the system SHALL NOT compute the annual value for the period and SHALL ask HR to enter it.

#### Scenario: IRAS's Appendix 8A example
- **WHEN** an owned, fully furnished residence with annual value S$40,000, shared by 2 employees, is provided from 1 Mar to 29 May 2026, the employee pays S$2,000 rent, utilities are S$250, a gardener S$1,200 and a hotel stay S$2,500
- **THEN** the system computes 90 days, annual value S$4,931.50, furniture and fittings S$2,465.75, residence S$5,397.25, utilities and housekeeping S$1,450.00 and a total of S$9,347.25

#### Scenario: IRAS's car examples
- **WHEN** a new car costing S$120,000 with a PARF rebate of S$24,000 and S$10,450 of running costs is provided for the whole of 2025, and a leased car with S$30,000 rental and S$6,500 running costs is provided for the whole of 2025
- **THEN** the car benefits are S$8,592.85 and S$15,642.85, which IRAS reports as S$8,592 and S$15,642

#### Scenario: Leap year annual value
- **WHEN** HR records owned premises for income year 2028 without entering the annual value for the period
- **THEN** the record is refused with a message to enter the apportioned annual value, because IRAS has not published the day basis for a leap year

### Requirement: Appendix totals in IR8A
The IR8A preview SHALL show, per employee, d8 value of benefits-in-kind (the Appendix 8A total), d7(a) gains under S10(1)(b) (ESOW gains and gains of ESOP granted on or after 1 Jan 2003) and d7(b) gains under S10(1)(g) (ESOP granted before 1 Jan 2003), each in whole dollars with the decimals dropped. An employee with appendix records and no pay in the year SHALL get an IR8A record. The year's notes SHALL say how many employees have appendix records, or that none are recorded.

#### Scenario: Totals
- **WHEN** an employee has an Appendix 8A total of S$9,347.25 and an ESOW gain of S$32,000.40
- **THEN** the preview shows d8 9,347, d7(a) 32,000 and d7(b) 0

#### Scenario: Former employee with a share gain
- **WHEN** a former employee with no 2026 payslips has a 2026 ESOP gain
- **THEN** the IR8A preview and rows include the employee with gross salary 0 and the gain in d7(a)

### Requirement: Appendix sheets in the import template layout
The IR8A file download SHALL offer, for each part of at most 200 IR8A records, CSV rows in the column layout of the template's `Appendix 8A(Accommodation)`, `Appendix 8A(Hotel & Others)` and `Appendix 8B` sheets for the employees of that part, with the sheet's header row verbatim, the employee's ID type and full ID number, accommodation IDs 1–10 and share record IDs 1–30 per employee, 8A amounts with two decimals and 8B prices and share counts with up to five. Cells the template locks and computes SHALL be empty, and the IR8A rows' d7 and d8 cells SHALL stay empty. Because the template cannot import the annual value method, owned premises SHALL be exported without 2a and 2b and noted with the values to enter in myTax. The download SHALL require recent authentication and be audit-logged with the sheet. Crow HR SHALL NOT fill or redistribute IRAS's workbook.

#### Scenario: Download an appendix sheet
- **WHEN** a payroll_admin downloads part 1's `appendix-8b` sheet for 2026
- **THEN** the file has the Appendix 8B header row and one row per share record of part 1's employees, the gross gain column empty

#### Scenario: Nothing to export
- **WHEN** part 1 has no Appendix 8B records
- **THEN** the download answers 409 saying there are no Appendix 8B records in that part

#### Scenario: Owned premises
- **WHEN** an employee's residence is owned by the employer
- **THEN** its accommodation row leaves 2a and 2b empty and the employee's notes give the 2a and 2b values to enter in myTax after import
