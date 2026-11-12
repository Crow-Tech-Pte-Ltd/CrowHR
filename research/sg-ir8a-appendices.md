# IR8A Appendix 8A (benefits-in-kind) and Appendix 8B (share plans)

> **Status:** research reference, as of **13 Nov 2026**. Not legal advice. Companion to
> [`sg-regulatory.md`](./sg-regulatory.md) §8 (IR8A, AIS, IR21).
>
> **Scope:** what an employer reports in Appendix 8A and Appendix 8B for income year 2026 (Year of
> Assessment 2027), how each value is worked out, and the column layout of IRAS's IR8A import template
> for the appendix sheets. Re-verify every January against the new YA's forms and explanatory notes.

## How to read this document

Same conventions as `sg-regulatory.md`: each rule is stated in plain English with its effective Year of
Assessment (YA) and the primary source inline. **UNVERIFIED** marks a point no primary source settles;
**AMBIGUOUS** marks a point where sources leave a choice open. Both are collected in §6.

**Retrieval.** Every source below was downloaded on 13 Nov 2026 from iras.gov.sg or file.go.gov.sg and
read verbatim (PDFs with `pdftotext`, the Word forms as text, the XLSX workbooks cell by cell including
their data validations, locked cells and formulas). Crow HR does not redistribute any of these files.

| Short name | Source | Version read |
| --- | --- | --- |
| EN-8A | [Explanatory Notes for Form IR8A and Appendix 8A, YA2027](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-form-ir8a-and-appendix-8a-for-ya2027.pdf) | year ended 31 Dec 2026, 10 pages |
| EN-8B | [Explanatory Notes for Appendix 8B, YA2027](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-appendix-8b-for-ya2027.pdf) | App8B(1/2027), 3 pages |
| Form 8A | [Appendix 8A form, YA2027](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/appendix-8a-for-ya2027.doc) | IR8A(A/1/2027) |
| Form 8B | [Appendix 8B form, YA2027](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/appendix-8b-for-ya2027.doc) | App8B(1/2027) |
| Form IR8A | [Form IR8A, YA2027](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/form-ir8a-for-ya2027.docx) | items d7 and d8 |
| Template | [IR8A Import Template](https://go.gov.sg/ir8a-import-template) (resolves to file.go.gov.sg/ir8a-import-template.xlsx) | "version 1.0", file modified 30 Jan 2026 |
| AIS items | [AIS-API 2.0 data items](https://file.go.gov.sg/aisapi2-dataitems.xlsx) | v2.5, 30 Jan 2026 (spec PDF v2.6, 11 Sep 2026) |
| Accommodation | [IRAS: Accommodation and Related Benefits](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/accommodation-and-related-benefits) | last updated 30 Jul 2026 |
| Car | [IRAS: Car and Car-related Benefits](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/car-and-car-related-benefits) | last updated 7 Aug 2026 |
| Car calculator | [IRAS Car Benefit Calculator from YA 2020 (XLSM)](https://www.iras.gov.sg/docs/default-source/uploadedfiles/xls/car-benefit-tax-cal-from-ya-2020.xlsm) | sheets NewCar, PteCar, Lease Car, Reference |
| Air passage | [IRAS: Air Passage](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/air-passage) | last updated 13 Jun 2025 |
| Loans | [IRAS: Benefits Relating to Loans](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/benefits-relating-to-loans) | last updated 23 Sep 2026 |
| Exempt list | [IRAS: Benefits-in-kind granted administrative concession or exempt](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/list-of-benefits-in-kind-granted-administrative-concession-or-exempt-from-income-tax) | last updated 31 Jul 2026 |
| ESOP guide | [IRAS e-Tax Guide: Tax Treatment of ESOP and Other Forms of ESOW Plans (6th ed.)](https://www.iras.gov.sg/docs/default-source/e-tax/etaxguides_iit_esop_2026-01-30.pdf) | published 30 Jan 2026 |

## 1. What the appendices are and how they reach IR8A

- **Appendix 8A** reports taxable benefits-in-kind; **Appendix 8B** reports gains from employee stock
  options (ESOP) and other employee share ownership (ESOW) plans ([IRAS reporting page](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/reporting-employee-earnings-(ir8a-appendix-8a-appendix-8b))).
- Benefits that IRAS exempts or grants an administrative concession are **not** reported (EN-8A
  "Details of benefits-in-kind"; Exempt list: e.g. group outings, festive gifts up to $200 available to
  all staff, outpatient and dental benefits available to all staff, group medical insurance).
- "Generally the actual cost of providing the benefits-in-kind should be reported" (EN-8A para 11).
- **IR8A d8** = the Appendix 8A total (EN-8A para 11; Form 8A footer "to be reflected in item d8").
  AIS items C20: "Must be equal to item D5 … Drop the decimals when reporting in IR8A."
- **IR8A d7(a)** "Gains or profits under S10(1)(b)" and **d7(b)** "under S10(1)(g)" come from Appendix
  8B (Form IR8A d7; EN-8B para 4). AIS items E2/E3, C18/C19:
  - E2 (→ d7(a), S10(1)(b)) = sum of gains of every **ESOW**, and of every **ESOP granted on or after
    1 Jan 2003**;
  - E3 (→ d7(b), S10(1)(g)) = sum of gains of every **ESOP granted before 1 Jan 2003**;
  - "Drop the decimals when reporting in IR8A."
  - d7(b) is declared by the employee as "Other income" and is excluded from the IR8A "TOTAL of items
    d1 to d8" (AIS item C21 lists C18 and C20 but not C19).
- **Effective:** these mappings are the YA2027 forms and AIS items v2.5. The S10(1)(b)/(g) split by
  2003 grant date follows ITA s 10(6) as described in the ESOP guide §§2.1, 4.1–4.2.

## 2. Appendix 8A: what is reported and how each value is worked out

### 2.1 Place of residence (items 1 and 2a–2f)

**One record per place of residence and per unbroken period.** "If the employer provided the
employee with more than one place of residence during the year, or if there is a break in the period
… prepare separate Appendix 8A for each place of residence" (EN-8A para 12). The template and the AIS
API allow **up to 10** per employee (Template read-me; AIS item D1).

**Period and days.** Period of occupation within the income year; "Number of days" counts both ends
(EN-8A example: 1 Mar 2026 to 29 May 2026 = 90 days). AIS D1(b)/(c): both dates in the income year,
from ≤ to, days ≤ 365 (366 in a leap year).

**Employees sharing.** "Number of employee(s) sharing the premises (exclude family members who are
not employees)"; enter 1 if not shared (Form 8A item 1; EN-8A item 1).

**Two valuation bases, chosen by who pays for the premises** (Accommodation page, "Taxable value";
FAQ "Can employers use the actual rent paid instead of AV"; examples headed "From YA 2020"):

1. **Rented by the employer (rent basis):** taxable value = total rent paid by the employer, *including
   rent for furniture and fittings*, less rent paid by the employee. F&F is not valued separately.
   - Shared premises: rent is divided by the number of employees sharing (Accommodation Example 2:
     "$50,000/2" = $25,000 per employee). Form 8A 2c: "state apportioned amount, if applicable".
   - Additional F&F leased by the employer (paid directly or reimbursed) is added to the rent
     (Accommodation FAQ Example 3).
2. **Not rented (owned) by the employer (annual value basis):**
   - **2a** = annual value (AV) of the premises for the period provided, apportioned (Form 8A 2a).
     EN-8A worked example: "$40,000/2 x 90/365" = **$4,931.50**, i.e. AV ÷ employees sharing × days ÷ 365.
   - **2b** = **40% of 2a** if partially furnished, **50% of 2a** if fully furnished (Form 8A 2b;
     Accommodation page; EN-8A example "50% x $4,931.50 = $2,465.75"). "Partially furnished" = fittings
     only (lighting, air-conditioner or fan, water heater); a unit with any such fitting is partially
     furnished (Accommodation FAQ). AIS D2(b)(i) accepts only `P` or `F`, and D2(b)(ii) "Cannot be blank
     or 0 if item D2(a) … > zero" and must equal 40% or 50% of D2(a).
   - The AV is on the property tax bill or IRAS's e-Valuation List; an AV revised during the year must be
     taken into account (Accommodation FAQ).
- **2d** = 2a + 2b, or 2c (AIS D2(d)). **2e** = total rent paid by the employee. **2f** = 2d − 2e; AIS
  D2(f): when negative in an original or revised submission, "must be zero".
- **Serviced apartment** not within a hotel building: items 2a–2f. Within a hotel building: item 3 (EN-8A).
- **Housing allowance** paid in cash is not a benefit-in-kind; it is taxed in full as an allowance
  (Accommodation table; EN-8A d1 lists "Housing allowance").

### 2.2 Utilities and housekeeping (items 2g–2j)

- **2g** utilities, telephone, suitcase, golf bag and accessories, camera, electronic gadgets: actual
  amount paid by the employer (Form 8A 2g; Accommodation table).
- **2h** driver: **annual cost × (private mileage ÷ total mileage)** (Form 8A 2h; Car page summary
  table S/N 2: "[Annual cost of driver x (private mileage / total mileage)]").
- **2i** servant, gardener, upkeep of compound: annual wages, or the actual amount paid to a company for
  these services (Form 8A 2i).
- **2j** = 2g + 2h + 2i (AIS D2(j)). In the template and the AIS API these sit on an accommodation
  record (AIS D2(g)–(j) are inside `accommodationRecords`; an address is mandatory only when 2a or 2c
  is filled, AIS D1(a)).

### 2.3 Hotel accommodation (item 3)

Actual cost to the employer of a hotel stay (or a serviced apartment within a hotel building) less the
amount the employee paid (Accommodation Example 4, "From YA 2015"; Form 8A 3a–3c). AIS D3(c): clamped
to zero when negative in an original or revised submission.

### 2.4 Other benefits (items 4a–4j)

| Item | Rule | Source |
| --- | --- | --- |
| 4a Home leave passages and incidental benefits for the employee and family | **Full cost**, taxable in full **from YA 2018**. Cash in lieu is an allowance (d1), not 4a. Passages to start or end employment, and business travel, are not taxable. | Air passage page; EN-8A 4a |
| 4b Interest paid by the employer to a third party for the employee, or interest benefit on loans to employees with substantial shareholding, control or influence | Benefit computed at **3-month compounded SORA + 1.5 percentage points**, rate set on 1 Mar and 1 Sep (e.g. 2.6% for Apr–Dec 2026), from 1 Apr 2023. Loans available to all staff, to employees without substantial shareholding or control, are not taxable. | Loans page |
| 4c Insurance premiums | Premiums on a personal policy where the employee is the policyholder are taxable; group medical insurance available to all staff is exempt. | EN-8A 4c; Exempt list item 9 |
| 4d Free or subsidised holidays including air passages | Actual cost. | Form 8A 4d |
| 4e Educational expenses including tutor | Includes student care and childcare subsidies, unless paid to a licensed childcare centre. | EN-8A 4e; Exempt list item 6 |
| 4f Club entrance or transfer fees and annual subscriptions | Corporate membership entrance fees, and subscriptions for business use, are exempt. | Form 8A 4f; Exempt list item 8 |
| 4g Gains from assets (vehicle, property sold below open market value) | The difference to open market value. | Form 8A 4g |
| 4h Full cost of motor vehicle given to the employee | Full cost. | Form 8A 4h |
| 4i Car benefits | §2.5 | EN-8A 4i; Car page |
| 4j Other non-monetary awards or benefits | Non-cash awards (pen, plaque, watch) are taxable unless exempted. | EN-8A 4j |

### 2.5 Car benefit (item 4i)

Formulas, **from YA 2020** (Car page; EN-8A 4i; the IRAS calculator is titled "from YA 2020"):

| Car | Value of benefit |
| --- | --- |
| New car (employer is the first owner) | 3/7 × [(car cost − PARF rebate) ÷ 10 + running costs] |
| Second-hand car, under 10 years old at purchase | 3/7 × [(car cost − PARF rebate) ÷ B + running costs] |
| Second-hand car, over 10 years old at purchase | 3/7 × [car cost ÷ B + running costs] |
| COE renewed by the employer | 3/7 × [(C + D) ÷ E + running costs] |
| Leased car | 3/7 × (rental cost + running costs) |

- **3/7**: private use outside office hours, "three out of seven days in a week".
- **Car cost**: acquisition cost including COE paid or payable at purchase (Example 2 adds a leather seat
  bought with the car). **PARF rebate**: the rebate granted on de-registration at above 9 but not more
  than 10 years.
- **B**: years from purchase to COE expiry, "rounded up to the nearest number of years" (Car Example 3:
  6 years 2 months → 7). **C**: amount paid to renew the COE; **D**: the PARF rebate forgone by renewing
  (added, not subtracted); **E**: years of the renewed COE (5 or 10).
- **Running costs**: road tax, petrol, parking, ERP, insurance, repairs and maintenance borne by the
  employer, including reimbursements; for a leased car only costs not borne by the hiring company.
  IRAS accepts the running costs actually incurred in the calendar year (Car Example 2 note).
- **Part-year use:** the depreciation term is apportioned by days used ÷ days in the year (Car Examples
  2–4: "x 153 / 365"); running costs and lease rental are the amounts for the period. The IRAS
  calculator divides by **366 in a leap year** (sheet `Reference`, `CarYear` table: 2024 and 2028 → 366)
  and requires the period to fall in one year.
- **Car allowance** is not a car benefit: declare it in full as an allowance (Car FAQ).
- **Driver** (2h) and **car park** benefits are separate (Car summary table).
- **Rounding:** IRAS publishes none. The calculator keeps full precision; the worked examples show whole
  dollars rounded down (Example 1: 3/7 × $20,050 = $8,592.857 → "$8,592"). Example 4 rounds each of two
  periods down ($1,420 + $6,196 = $7,616); summing the two exact amounts instead would give $7,617.
  Rounding each period down to the cent ($1,420.15 + $6,196.84 = $7,616.99) and then dropping the
  decimals for d8 reproduces IRAS's figure. (AMBIGUOUS, §6.)

### 2.6 Rounding and limits in the appendix sheets

- IR8A sheet amounts are whole dollars (income: drop the cents). The **appendix sheets accept 2 decimal
  places**: Template data validation "Max 7 Digits and 2 decimals Allowed" on every 8A amount column;
  AIS D-items are `Decimals (7,2)`, i.e. at most $9,999,999.99.
- No rounding rule is published for 2a, 2b, 2c apportionment, 2h or 4i. EN-8A's own example truncates
  ($40,000/2 × 90/365 = $4,931.5068… shown as **$4,931.50**), and AIS item E1(h) says "drop off excess
  values beyond 2 decimals" for share gains. **Crow HR rounds each computed appendix value down to the
  cent (`floorToCent`), and the IR8A totals down to the dollar.** (AMBIGUOUS, §6.)

## 3. Appendix 8B: gains from ESOP and ESOW plans

### 3.1 When a gain is taxed (ESOP guide §5; EN-8B para 3)

| Plan | Taxed in the year of |
| --- | --- |
| ESOP without selling restriction | exercise |
| ESOW without vesting | grant |
| ESOW with vesting | vesting |
| ESOP or ESOW with a moratorium (selling restriction) | the date the moratorium is lifted |

- "Exercise" includes assignment or release of the right (ESOP guide §3.3).
- Granted **on or after 1 Jan 2003** while exercising employment in Singapore: taxable regardless of
  where it is exercised or vests. Granted **while not** exercising employment in Singapore: not taxable
  (exercised/vested on or after 1 Jan 2002) and need not be reported. Granted **before 1 Jan 2003**:
  taxable if exercised/vested while physically present or employed in Singapore (EN-8B para 3 table;
  ESOP guide §§2.1, 4.1–4.3).
- A **loss** is not reported and "cannot be offset against the other ESOP or ESOW plans" (EN-8B para 3).
- Cash compensation for releasing a right on resignation or dismissal for misconduct goes in IR8A
  **d1 allowances**, not Appendix 8B (EN-8B para 5; EN-8A d7 note 2).
- Former employees who derive gains in the year are reported (EN-8A para 1(g)).

### 3.2 Computation (Form 8B; AIS item E1(h); ESOP guide §6)

**Gross gain (h) = (f − e) × g**, where
- **e** = exercise price of the ESOP, or price paid or payable per share under the ESOW plan (≥ 0);
- **f** = open market value per share on the date in column (d) (> 0). For SGX-listed shares use the
  last done price on the listing date of the shares acquired (EN-8B 6(v); ESOP guide §6.3: newly issued
  shares on the date first listed, treasury shares on the date credited to the CDP account). Where no
  open market value or arm's-length price can be determined and the shares are not SGX-listed, use the
  **net asset value** (EN-8B 6(v); ESOP guide §6.2);
- **g** = number of shares acquired;
- AIS: e, f and g are `Decimals (9,5)`; h is `Decimals (9,2)` and "Must equal [E1(f) − E1(e)] × E1(g)
  (drop off excess values beyond 2 decimals)". Template data validation agrees ("Max 9 digits and 5
  Decimals Allowed" on columns J–L).
- **Column (d) date**: ESOP without moratorium → exercise date; ESOW with vesting → vesting date; ESOW
  with neither → grant date; with moratorium → date the moratorium is lifted (EN-8B 6(iv)). AIS: its year
  must equal the income year and it must not be before the grant date; the grant date cannot be in the
  future.
- **Foreign currency**: prices are converted to S$ at the actual rate on the column (d) event date;
  where that is unavailable, one of the company's in-house rate, local banks, local newspapers or
  reputable news agencies, used consistently for all employees and years and communicated to them
  (EN-8B 6(vi)).
- **Company fields** (registration number, name) are completed only when the company granting the plan
  differs from the employer making the declaration (EN-8B 6(i)–(ii)). Template dropdown for the ID
  type: `UEN-Local Co`, `UEN-Others`, `OTHERS`.
- Up to **30** records per employee (Template read-me; AIS item E1).

### 3.3 Incentive and deferral schemes

- **ERIS** (Equity Remuneration Incentive Scheme): phased out after YA 2024. AIS items change log v1.7
  (15 May 2025): "Removal of Section B to D in <appendix8B> … Software Developers: Do not build data
  fields for ERIS fields. Do not transmit any ERIS data records to IRAS." The YA2027 Form 8B has only
  the EEBR section. The template's leftover "Appendix 8B Schemes" dropdown is not referenced by any
  sheet's validation.
- **QEEBR** (tax deferral up to 5 years with interest): the *employee* applies with the employer's
  certification of the vesting period (ESOP guide §§7–10). It does not change Appendix 8B.
- **"Deemed exercise" rule** for foreigners and SPRs leaving permanently or posted overseas: gains on
  unexercised or unvested plans granted on or after 1 Jan 2003 are deemed derived one month before
  cessation and are reported **in the IR21 tax clearance**, not Appendix 8B; the "tracking option" is an
  approved alternative (ESOP guide §§11–17, §13.2).

## 4. IRAS IR8A import template: appendix sheets

The workbook (sheets `IR8A`, `Appendix 8A(Accommodation)`, `Appendix 8A(Hotel & Others)`,
`Appendix 8B`, `DropDownList`) imports up to 200 IR8A records with their appendices in one go
(read-me item 1). Every sheet is **protected**; grey cells are locked and computed by myTax after
import ("Cells highlighted in Grey are not editable", read-me item 5; "Total/computation fields will be
calculated and shown in digital service after successful import of records. Please verify the totals
before submission", item 9). Appendix sheets have their header in **row 1** and data from **row 2**,
one row per record, keyed to the IR8A record by ID type and ID number.

**IR8A sheet:** columns AE (d7(a)), AF (d7(b)), AG (d8) and AH (d9(ii) Appendix 8A indicator) are locked
and computed after import.

**`Appendix 8A(Accommodation)`** (up to 10 rows per employee; read-me "you can add up to 10
accommodations"):

| Col | Header (verbatim, IRAS's spelling) | Filled by Crow HR |
| --- | --- | --- |
| A | `*ID Type [Choose option]` | NRIC / FIN |
| B | `*ID No.` | full ID |
| C | `Accommodation ID` | 1–10 (dropdown) |
| D | `1. Address Details` | address |
| E | `Occupation From (YYYY-MM-DD)` | date |
| F | `Occupation to (YYYY-MM-DD)` | date |
| G | `No.of Days` | locked: computed by myTax |
| H | `No.of employees sharing the premises(excluding family members who are not employees) Max up to 999` | 1–999 |
| I | `2a. Annual Value of Premises for the Period Provided` | locked |
| J | `2b. Value of Furniture &Fittings` | locked (furnishing dropdown) |
| K | `Value of Furniture &Fittings (2a* 2b)` | locked |
| L | `2c. Rent Paid to Landlord including Rental of Furiniture & Fittings(apportioned amount, if applicable)` | apportioned rent |
| M | `2d. Taxable Value of Residence (a + b) or (c) ` | locked |
| N | `2e. Total Rent Paid by Employee for Place of Residence` | amount |
| O | `2f. Total Taxable Value of Place of Residence (2d - 2e)` | locked |
| P | `2g. Utilities/ Telephone/ Pager/ Suitcase/ Golf Bag & Accessories/ Camera/ Electronic Gadgets(e.g. Tablet, Laptop)` | amount |
| Q | `2h. Driver` | amount |
| R | `2i. Servant` | amount |
| S | `2j. Taxable Value of Utilities and Housekeeping Costs (2g + 2h + 2i)` | locked |
| T | `Overwrite computed value in 2a & 2b` | hidden |

- **The annual value method cannot be imported:** read-me item 2 under Appendix 8A: "The AV method and
  its related fields for reporting accommodation benefit is currently disabled. (2a and 2b) We will update
  template once it is enabled." Columns I–K are locked. Owned premises must be completed in myTax after
  import.

**`Appendix 8A(Hotel & Others)`** (one row per employee): A ID type, B ID no., C `Hotel Accommodation`
(locked), D `3a. Actual Cost of Hotel Accommodation/ Serviced Apartment within Hotel Building`, E `3b.
Amount Paid by Employee`, F 3c (locked), G 4a, H 4b, I 4c, J 4d, K 4e, L 4f, M 4g, N 4h, O 4i, P 4j, Q
`Total Value of Benefits in kind(items 2 to 4)` (locked).

**`Appendix 8B`** (up to 30 rows per employee; data validation to row 6001): A ID type, B ID no., C
`*Record ID` (1–30), D `Organisation Tax Ref.No Type` (`UEN-Others`, `UEN-Local Co`, `OTHERS`), E `a.
Organization Tax Ref.No`, F `b. Organization Name`, G `c1. Type of Plan Granted` (`ESOP`/`ESOW`), H `c2.
Date Of grant (YYYY-MM-DD)`, I `d. Date of exercise … (YYYY-MM-DD)`, J `e. Exercise Price …`, K `f. Open
Market Value Per Share …`, L `g.Number of Shares Acquired`, M `h. Gross Amount of gains …` (locked).

Licence: as for the IR8A sheet (`sg-regulatory.md` §8.4), the workbook's redistribution licence is
unconfirmed, so Crow HR exports rows in its column layout and does not fill or ship the workbook.

## 5. Implications for Crow HR

**Computed by Crow HR (cited formula, rounded down to the cent):** days of occupation; owned premises
2a (AV ÷ sharing × days ÷ 365) and 2b (40% or 50% of 2a); rented premises 2c (rent ÷ sharing); 2d, 2f
(clamped at 0), 2h (driver cost × private ÷ total mileage), 2j; 3c (clamped at 0); 4i for new,
second-hand, COE-renewed and leased cars; the Appendix 8A total and IR8A d8; Appendix 8B gross gain h,
its S10(1)(b)/(g) section and IR8A d7(a)/(b) (whole dollars, decimals dropped).

**Entered by HR (no formula Crow HR can apply from the employer's data):** AV of the premises, rent paid
by the employer and by the employee, utilities, servant and gardener costs, hotel cost and employee
payment, items 4a–4h and 4j as amounts, car costs and years, share prices already converted to S$ and
share counts. The loan interest benefit (4b) depends on balances and IRAS's half-yearly SORA rates and is
entered, not computed.

**Not supported:** ERIS (IRAS: do not build); deemed exercise and tracking option (IR21); QEEBR
(employee's application); importing owned-premises 2a/2b through the template (IRAS disabled it);
direct AIS-API submission; printed Appendix 8A/8B for employers outside AIS.

## 6. Unverified and ambiguous points

1. **UNVERIFIED: annual value day basis in a leap year.** EN-8A's example divides by 365 (2026 is not a
   leap year). The AIS API allows 366 days in a leap year, and the car calculator divides by 366 then,
   but no source states the accommodation formula for a leap year. Crow HR computes 2a only for income
   years that are not leap years; in a leap year HR completes 2a and 2b in myTax. Next affected: income
   year 2028 (YA2029).
2. **AMBIGUOUS: rounding of computed appendix values** (2a, 2b, 2c apportionment, 2h, 4i). None is
   published; Crow HR rounds each record down to the cent, following EN-8A's $4,931.50 example and AIS
   E1(h), and drops the decimals of the total for IR8A. This reproduces every IRAS worked example used
   as a test vector (EN-8A item 12, Accommodation Examples 1–4, Car Examples 1–5) in whole dollars, but
   another rounding (for example rounding each car period to dollars) can differ by $1.
3. **AMBIGUOUS: rent basis for part of the premises' rent period.** IRAS's examples apportion rent by
   employees sharing, and the employer reports the rent for the period of occupation. Crow HR asks for
   the rent paid for the period and divides by the number sharing; it does not apportion by days.
4. **UNVERIFIED: pasting into the protected template.** The appendix and IR8A sheets lock their grey
   columns. Whether a spreadsheet accepts a pasted block that includes empty locked cells depends on the
   application; if it refuses, paste the blocks of columns either side of the grey columns separately.
5. **UNVERIFIED: the IR8A sheet's "d9(ii) Appendix 8A indicator"** (locked, "to be entered after record
   import into digital service") is not explained in EN-8A or the AIS items.
