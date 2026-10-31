## Purpose

Computes Singapore statutory payroll amounts (CPF, SDL, SHG funds, Employment Act pay and leave entitlements, and a Foreign Worker Levy estimate) exactly, from effective-dated rule tables that cite their sources, with a human-readable working trace for every result.

## ADDED Requirements

### Requirement: Effective-dated, cited rule data
Every statutory number SHALL be stored as data with an `effectiveFrom` (inclusive), an `effectiveTo` (exclusive, or open-ended) and a primary source URL. Money SHALL be integer cents and rates SHALL be basis points. For any date from 1 Jan 2025, exactly one version of each rule family SHALL be in force. A date outside the encoded data SHALL be refused, not guessed. Where the regulator does not publish a start date, the row SHALL start at the engine coverage date and SHALL be marked as such.

#### Scenario: Year boundary
- **WHEN** rules are resolved for 31 Dec 2026 and for 1 Jan 2027
- **THEN** 31 Dec 2026 uses the 2026 CPF tables (above 55 to 60: 34%) and 1 Jan 2027 uses the 2027 tables (35.5%), and no date matches both

#### Scenario: Data integrity
- **WHEN** the rule data is checked
- **THEN** no rule family has a gap, an overlap, an inverted range or a row without an https source

#### Scenario: Date before coverage
- **WHEN** rules are requested for 31 Dec 2024
- **THEN** the request is refused with an error that names the coverage start

### Requirement: CPF contribution for an employee-month
The engine SHALL compute total, employee and employer CPF for one employee, employer and contribution month. It SHALL select the rate table from residency (SC; SPR year 1, 2 or 3+ with the G/G, F/G or F/F election; foreigner) and the age band. It SHALL select the wage band on total wages before ceilings, cap OW at the OW ceiling and cap AW at the remaining AW headroom. Rounding SHALL follow CPF's published rule on the exact, unrounded amount: total rounded to the nearest dollar (below 50 cents down, 50 cents and above up), employee share rounded down to the dollar, employer share = total − employee. OW and AW of the month SHALL be summed before rounding. Foreigners SHALL get no CPF.

#### Scenario: Full rates, age 55 and below (AGE-01)
- **WHEN** an SC aged 55 and below has OW $3,000 in June 2026
- **THEN** total is $1,110, employee $600 and employer $510, using CPF Table 1 of 2026

#### Scenario: Exact-amount rounding (RD-03)
- **WHEN** an SC aged 55 and below has OW $1,001.34 in April 2026
- **THEN** total is $370 (exact $370.4958, not rounded to cents first) and employee $200

#### Scenario: OW ceiling and employer share (WB-08, WB-10)
- **WHEN** OW is $7,999.99, and separately $8,000.01, in March 2026
- **THEN** the first gives total $2,960, employee $1,599, employer $1,361, and the second caps OW at $8,000 giving $2,960 / $1,600 / $1,360

#### Scenario: Wage band thresholds (WB-01 to WB-07)
- **WHEN** total wages are $50.00, $500.00, $600.00 and $750.01 for an SC aged 55 and below
- **THEN** the results are nil; employer only (17% × TW, no employee share); phase-in (17% × TW + 0.6 × (TW − $500), employee 0.6 × (TW − $500)); and full rates respectively

#### Scenario: Age band changes the month after the birthday (AGE-T1, AGE-T2)
- **WHEN** an SC's 55th birthday is 13 Jan 2026
- **THEN** January 2026 wages use the "55 and below" rates and February 2026 wages use the "above 55 to 60" rates

#### Scenario: SPR year boundaries (SPR-01 to SPR-03)
- **WHEN** an SPR's status date is 15 Jan 2026 under the default G/G option
- **THEN** wages up to January 2027 use the 1st-year table (OW $3,000 → $270 / $150 / $120), and from February 2027 the 2nd-year table (→ $720 / $450 / $270)

#### Scenario: Joint election (SPR-05, SPR-08)
- **WHEN** a 1st-year SPR has an approved F/G election, and separately an approved F/F election
- **THEN** F/G uses Table 4 (OW $3,000 → $660 / $150 / $510) and F/F uses Table 1 (→ $1,110 / $600 / $510)

#### Scenario: Foreigner (FOR-01)
- **WHEN** the employee is a foreigner on an Employment Pass
- **THEN** CPF is nil and no rate table is used

#### Scenario: Unpublished future rates (SPR-04)
- **WHEN** wages are for a month after the last published CPF tables (from January 2028)
- **THEN** the latest published tables are applied, the result is flagged as rates carried forward, and a warning is raised

### Requirement: AW ceiling estimate, recomputation and re-subjection
The annual AW ceiling SHALL be the Annual Salary Ceiling ($102,000) minus OW subject to CPF for the calendar year, never negative. It SHALL be estimated at each AW payment from OW to date, this month's OW and projected OW for the remaining months of expected employment. It SHALL be recomputed with actual OW in December, in the last month of employment and after leaving. On every estimate or recomputation, earlier AW of the year SHALL be re-allocated in chronological order. Any newly subject earlier AW SHALL produce a shortfall at the rates of the month that AW was payable, rounded once over the combined exact amount. AW no longer subject SHALL produce an excess flagged for refund by CPF; it SHALL never be netted against the current month. The engine SHALL return the year-to-date state to persist for the next month.

#### Scenario: Ceiling exhausted (AW-01, AW-02)
- **WHEN** an SC on OW $9,000 receives AW $12,000 in January 2026 and AW $10,000 in June 2026
- **THEN** January has $6,000 of AW subject (total $5,180, employee $2,800) and June has none

#### Scenario: Wage band on pre-cap wages (AW-08)
- **WHEN** OW is $500 and AW $30,000 of which only $100 is within the ceiling
- **THEN** full rates apply to the $600 subject: total $222, employee $120, employer $102

#### Scenario: Last-month recomputation (AW-11, CPF example 7)
- **WHEN** an employee leaves in June 2026 with pro-rated OW $1,500, after AW in Feb–May was capped at an estimated $6,000 ceiling
- **THEN** the ceiling is recomputed to $60,500, $40,000 of earlier AW becomes subject as a shortfall ($14,800 / $8,000 / $6,800), and June's own CPF is $555 / $300 / $255

#### Scenario: Shortfall across an age-band change (CPF example 14)
- **WHEN** the recomputed shortfall re-subjects $23,951.50 of March AW at 37% and $7,022.50 of April AW at 34%
- **THEN** the shortfall is total $11,250 and employee $6,054, rounded once over the combined exact amount

#### Scenario: Official worked examples
- **WHEN** each of CPF's 16 published AW ceiling examples is replayed month by month, carrying the returned state
- **THEN** every month's OW subject, AW subject, total and employee share match CPF's published figures

#### Scenario: Ceiling shrinks below AW already subjected
- **WHEN** the December recomputation gives a smaller ceiling than the AW already subjected
- **THEN** the excess is reported with an indicative refund, a warning says to apply to CPF Board, and no AW is newly subject

### Requirement: Unsupported CPF cases are refused
When total wages before ceilings fall in the "$50 to $750" bands and part of the AW is above the AW ceiling, the engine SHALL NOT compute an amount. It SHALL return a blocked result with a blocking issue that explains the case, because no published rule covers it. Negative wage inputs SHALL be rejected. A correction SHALL be computed by recomputing the original month and diffing the results.

#### Scenario: Low wages with capped AW
- **WHEN** OW is $300 and AW of $300 is entirely above the AW ceiling
- **THEN** the result is blocked with `CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED` and contains no contribution amounts

#### Scenario: Backpay reversal
- **WHEN** a negative wage is passed
- **THEN** the input is rejected with a message explaining how to correct an earlier month instead

### Requirement: Skills Development Levy
SDL SHALL be 0.25% of total monthly wages (OW + AW, no CPF ceilings), at least $2 for wages below $800 and at most $11.25 for wages above $4,500. It SHALL be kept exact per employee. The employer total SHALL be the sum of the exact amounts, rounded down to the dollar. No SDL SHALL be due when no wages are paid or payable, or for a statutory exemption.

#### Scenario: Official five-employee example (SDL-RUN-01)
- **WHEN** employees earn $609.50, $2,000, $4,500, $4,502.03 and $10,000
- **THEN** the levies are $2, $5, $11.25, $11.25 and $11.25, and $40 is payable (from $40.75)

#### Scenario: Sum exactly, then floor (SDL-RUN-02)
- **WHEN** three employees each earn $1,234.56
- **THEN** the exact total is $9.2592 and $9 is payable

#### Scenario: No wages
- **WHEN** an employee is on no-pay leave for the whole month
- **THEN** SDL is $0, not the $2 minimum

### Requirement: Self-Help Group funds
The engine SHALL determine the default SHG funds from race as recorded (first race of a double-barrelled race), religion, residency and pass type: CDAC and ECF for SCs and SPRs, SINDA for SCs, SPRs and EP holders of Indian descent, and MBMF for all Muslims in addition to any race fund. Recorded opt-outs and additional funds SHALL be applied. The contribution SHALL be the table amount for total wages in the month, including AW, with no CPF ceilings, unless a fixed amount has been agreed. Race SHALL never be inferred.

#### Scenario: Muslim of Indian race (SHG-16)
- **WHEN** a Muslim SC of Indian race earns $3,500
- **THEN** MBMF $15 and SINDA $7 are deducted ($22)

#### Scenario: Bonus month (SHG-17)
- **WHEN** a CDAC contributor earns OW $4,000 and a bonus of $8,000 in the month
- **THEN** the CDAC band is chosen on $12,000, giving $3

#### Scenario: Missing race
- **WHEN** an SC's race is not recorded
- **THEN** no race fund is applied and a warning asks for the race to be recorded

### Requirement: Employment Act pay helpers
The engine SHALL derive Part 4 coverage (workman ≤ $4,500, non-workman ≤ $2,600 basic, never managers or executives). It SHALL compute the hourly basic rate (12 × monthly basic / (52 × 44), or the contractual weekly hours for part-timers) and daily rates (12 × monthly / (52 × days per week)). Overtime SHALL be at least 1.5× for Part 4 employees, with the non-workman base capped at $2,600 and by default never above MOM's published $13.60 per hour. Overtime above 72 hours a month or work above 12 hours a day SHALL produce a warning, not an error. Incomplete-month salary SHALL use MOM's working-days method. Rest-day and public-holiday work pay SHALL follow MOM's multiples, and time off in lieu SHALL be allowed only outside Part 4.

#### Scenario: MOM's overtime example
- **WHEN** a non-workman earning $2,600 works 2 hours of overtime
- **THEN** overtime pay is $40.80 ($13.60 × 1.5 × 2)

#### Scenario: Monthly overtime limit
- **WHEN** 73 overtime hours are recorded in a month
- **THEN** the pay is computed and a warning about the 72-hour limit is returned

#### Scenario: Incomplete month
- **WHEN** a $3,000 monthly salary has 22 working days and 10 days worked
- **THEN** the salary is $1,363.64, and the working-day calendar reproduces MOM's 2026 table for 5, 5.5 and 6-day weeks

#### Scenario: Rest day at the employer's request
- **WHEN** a Part 4 employee works more than half their normal daily hours on a rest day at the employer's request
- **THEN** they are paid two days at the basic daily rate, plus overtime for hours beyond normal hours

### Requirement: Leave entitlements and public holidays
Annual leave SHALL be 7 days in the first year of service, rising by one day a year to 14 from the eighth year. It SHALL require 3 months of service and SHALL be pro-rated by completed months in the first year and the year of leaving: below half a day rounds down, half a day or more rounds up. Paid sick leave SHALL follow completed months of service (none before 3 months; 5/15 at 3, 8/30 at 4, 11/45 at 5, 14/60 from 6). Gazetted public holidays SHALL be available per published year. The treatment of a holiday on a rest day or non-working day SHALL follow MOM: gazetted Monday, next working day, or another day off / an extra day's gross pay.

#### Scenario: MOM's pro-ration example
- **WHEN** an employee in their fourth year of service (10 days) leaves after 4 completed months of that year
- **THEN** the entitlement is 3 days (4/12 × 10 = 3.33)

#### Scenario: Saturday holiday
- **WHEN** Hari Raya Puasa falls on Saturday 21 Mar 2026 for a 5-day-week employee
- **THEN** the treatment is another day off or one extra day's gross pay, with no automatic Monday

### Requirement: Foreign Worker Levy estimate
The engine SHALL estimate the monthly levy per S Pass or Work Permit holder for cost reporting only. Full months SHALL use the monthly rate. Part months SHALL use MOM's daily rate, ceil(monthly × 12 / 365) per liable day, with liability ending the day before cancellation. The estimate SHALL be labelled as an estimate with MOM's bill authoritative, and the package SHALL state that the levy is never deductible from salary.

#### Scenario: Pass issued mid-month
- **WHEN** an S Pass is issued on 15 Oct 2026
- **THEN** the estimate is 17 days × $21.37 and is labelled "Estimate — MOM levy bill is authoritative"

### Requirement: Country rules interface
The package SHALL expose a country-rules interface that the payroll module depends on: identity (country, name, currency), coverage, an initial per-employee state, a per-employee-month computation returning statutory lines (payer, amount, remit-to), working, issues and the next state, and an employer-month aggregation. Singapore SHALL implement it with country code `SG`.

#### Scenario: Employer SDL aggregation
- **WHEN** two employee-months with exact SDL of $11.25 and $3.0864 are aggregated
- **THEN** a single employer SDL line of $14 is produced
