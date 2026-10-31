## Purpose

Defines the files payroll generates for upload to CPF Board, banks and IRAS, since Crow HR cannot submit to those systems directly.

## ADDED Requirements

### Requirement: CPF EZPay (FTP) submission file
For an approved or paid run, a payroll_admin SHALL download a CPF EZPay file following CPF Board's "CPF EZPay (FTP) File Specifications" effective 16 Jan 2025: fixed-length 150-character records (employer header, a summary record per payment code, detail records for CPF and each SHG fund, employer trailer with record count and total), file name `<CSN><MonYYYY><advice code>.DTL`, CPF (01), MBMF (02), SINDA (03), CDAC (04), ECF (05) and SDL (11) amounts, employment status E/L/N/O from join and leave dates, and names stripped of the characters the spec forbids. The file SHALL contain the amounts the run charged (an adjustment run produces a supplementary file). Generation SHALL refuse a negative amount, a CPF account number not starting with S or T, or a missing CSN, with a message saying how to fix it. Employees without an S/T number (SHG for foreigners) SHALL be left out with a warning to key them in EZPay.

#### Scenario: Golden file
- **WHEN** the file is generated for the fixed test company for October 2026
- **THEN** it equals the committed golden file byte for byte and every line is 150 characters

### Requirement: Bank payment file
A payroll_admin SHALL download a generic ISO 20022 `pain.001.001.03` credit-transfer file for a run's net pay (category purpose `SALA`), using the organisation's debit account from payroll settings and each employee's bank account current on the pay date. The file and the UI SHALL state that it is the generic ISO 20022 format, not a bank-specific format, and must be checked with the bank before first use. Employees without a bank account SHALL be listed as excluded. Download SHALL require recent authentication and be audit-logged.

#### Scenario: Missing bank account
- **WHEN** one employee has no bank account
- **THEN** the file excludes them and the response lists them as excluded

### Requirement: IR8A export
For a calendar year, a payroll_admin SHALL export each employee's IR8A figures in the column layout of IRAS's IR8A import template for manual upload in myTax Portal, with income rounded down and deductions rounded up to the dollar, at most 200 records per file.

#### Scenario: Year export
- **WHEN** a payroll_admin exports income year 2026
- **THEN** each employee with 2026 payslips appears once with gross salary, bonus and employee CPF in whole dollars

#### Scenario: More than 200 employees
- **WHEN** the year has 201 records
- **THEN** the export has two parts of 200 and 1 records, record numbers restarting at 1

#### Scenario: Missing mandatory particulars
- **WHEN** an employee has no recorded sex, or an ID type other than NRIC or FIN
- **THEN** the employee is left out of the file and listed with the reason

#### Scenario: No direct submission
- **WHEN** a payroll_admin views the IR8A export
- **THEN** it says the rows are imported in myTax Portal by the employer, that direct AIS-API submission is not available, and that Appendix 8A is not produced
