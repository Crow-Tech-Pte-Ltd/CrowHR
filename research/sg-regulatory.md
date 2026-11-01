# Singapore regulatory reference for Crow HR

> **Status:** research reference, as of **31 Oct 2026**. Not legal advice.
>
> **Companion files:**
> - [`sg-rule-tables.json`](./sg-rule-tables.json): effective-dated tables for the engine.
> - [`sg-test-vectors.md`](./sg-test-vectors.md) and [`sg-test-vectors.json`](./sg-test-vectors.json): CPF, SDL and SHG cases the engine must reproduce exactly.
>
> **Owner:** regulatory research workstream. Re-verify every number before each January release and whenever CPF, MOM or IRAS publish changes. The usual timing:
> - CPF rate tables: around May for the following January.
> - MOM public holidays: around June for the following year.
> - IRAS AIS specs: by September.
> - MOM work-pass changes: Budget/COS in Feb–Mar.

## How to read this document

- Each topic gives:
  - the rule in plain English;
  - effective dates;
  - edge cases;
  - citations, inline next to the number;
  - **Implications for Crow HR**: what the product must compute, store, display or warn about.
- **Labels:**
  - **SECONDARY**: the fact comes from a non-government source, or from a search-engine snippet of a government page that could not be fetched.
  - **UNVERIFIED** or **AMBIGUOUS**: the primary sources were missing or contradicted each other. These items are collected in §15.
- **Retrieval.** Primary pages were fetched as raw HTML or PDF on 31 Oct 2026 and read verbatim. CPF Board's FAQ articles render client-side and were read through a page-summarising fetcher. Where only a summary was available, wording is paraphrased; the numbers were cross-checked against CPF's PDFs.
- **Access gap.** Statute text on **sso.agc.gov.sg** could only be partially read. The site lazy-loads Act bodies and blocks scripted access with 403 or empty 202 responses. Statutory points are therefore cited through the regulator's own guidance (CPF, MOM, IRAS, PDPC) unless stated otherwise.
- **Money conventions.** "$" means SGD. Money in the JSON is integer cents. Rates are basis points (1 bp = 0.01%).

## Key numbers for 2026, and what changes in 2027

| Item | 2026 | 2027 (announced) | Source |
|---|---|---|---|
| CPF OW ceiling (monthly) | **$8,000** (2025: $7,400) | $8,000 | [CPF 2026 tables](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf), [2027 tables](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf) |
| Annual Salary Ceiling / AW ceiling | $102,000 − OW subject to CPF for the year | same | [CPF wages](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions) |
| CPF ≤55 (SC / SPR yr3+) | 17% ER + 20% EE = 37% | unchanged | CPF tables |
| CPF >55–60 | 16% + 18% = 34% | **16.5% + 19% = 35.5%** | [CPF 2027 announcement](https://www.cpf.gov.sg/employer/infohub/news/cpf-related-announcements/new-contribution-rates) |
| CPF >60–65 | 12.5% + 12.5% = 25% | **13% + 13% = 26%** | same |
| CPF >65–70 | 9% + 7.5% = 16.5% | unchanged | |
| CPF >70 | 7.5% + 5% = 12.5% | unchanged | |
| SPR 1st/2nd year graduated (G/G) | unchanged since 2016 | unchanged | CPF tables |
| SDL | 0.25% of total wages, min $2 (wages < $800), max $11.25 (wages > $4,500) | — | [CPF SDL](https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy) |
| S Pass levy | $650/month flat (since 1 Sep 2025) | — | [MOM](https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements) |
| EP qualifying salary (non-FS) | $5,600–$10,700 by age | **$6,000–$11,500** (new applications from 1 Jan 2027) | §10.1 |
| S Pass qualifying salary (non-FS) | $3,300–$4,800 by age | **$3,600–$5,100** (new applications from 1 Jan 2027) | §10.2 |
| EA Part IV thresholds | workman ≤ $4,500 basic; non-workman ≤ $2,600 basic | no change found | [MOM](https://www.mom.gov.sg/employment-practices/employment-act/who-is-covered) |
| Shared parental leave | 10 weeks for children born from 1 Apr 2026 (6 weeks for 1 Apr 2025–31 Mar 2026) | — | §6.5 |
| Paternity leave | 4 weeks Government-paid (births from 1 Apr 2025) | — | §6.4 |
| Childcare leave | 6 days (child SC < 7) | NDR 2026 announced 8/10/12 days. **No effective date yet** | §6.6 |
| AIS mandatory threshold | ≥ 5 employees (YA2027) | — | §8.2 |
| Form IR8S | **discontinued from YA2026** | — | §8.1 |
| NRIC as authenticator | must be phased out by **31 Dec 2026** | PDPC enforcement from 1 Jan 2027 | §11.1 |
| Singpass | FAPI 2.0 mandatory by **31 Dec 2026** | Corppass legacy deprecated 1 Apr 2027 | §12 |

## Contents

1. CPF contributions
2. Skills Development Levy (SDL)
3. Foreign Worker Levy (FWL)
4. Self-Help Group funds (CDAC, ECF, MBMF, SINDA)
5. Employment Act
6. Leave and public holidays
7. Payslips, KETs and records
8. Tax: IR8A, Appendix 8A/8B, IR8S, AIS, IR21
9. CPF submission (EZPay)
10. Work passes
11. PDPA
12. Singpass, Myinfo and Corppass
13. Bank GIRO / bulk payment files
14. Integrations needing government or vendor onboarding (consolidated)
15. Unverified items, ambiguities and questions for agencies
16. What HR/payroll systems commonly get wrong

---

## 1. CPF contributions

**Primary sources (all fetched 31 Oct 2026):**

- [CPF: How much CPF contributions to pay](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay). The page was last updated 19 Oct 2026.
- [CPF contribution rate tables from 1 Jan 2026 (PDF, Tables 1–5)](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf).
- [CPF contribution rate tables from 1 Jan 2027 (PDF)](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf), together with the [announcement](https://www.cpf.gov.sg/employer/infohub/news/cpf-related-announcements/new-contribution-rates) dated 21 May 2026.
- [CPF: What constitutes wages](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions).
- [CPF: Examples for computation of the AW ceiling (PDF, 2026 figures)](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE).
- [CPF: Which allowances and payments attract CPF (PDF, updated 5 Jan 2026)](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/6jan2026_which_allowances_and_payments_attract_cpf_contributions.pdf).
- [CPF: Mistakes by employers (PDF)](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK).
- [CPF: Who should receive CPF contributions](https://www.cpf.gov.sg/employer/employer-obligations/who-should-receive-cpf-contributions).

The statute itself is the CPF Act 1953. I could not fetch its full text from sso.agc.gov.sg in a scriptable way: the page loads the Act body lazily and blocks automated requests (403 or an empty 202). Everything below therefore comes from the CPF Board's published tables and guidance, which CPF EZPay itself implements.

### 1.1 Who must be paid CPF

- **Covered:** Singapore Citizens (SC) and Singapore Permanent Residents (SPR) employed under a contract of service in Singapore, earning **total wages of more than $50 in a calendar month**. This includes full-time, part-time, temporary, contract and casual staff, whether paid hourly, daily, monthly or by piece rate, and staff on probation. Source: [who should receive](https://www.cpf.gov.sg/employer/employer-obligations/who-should-receive-cpf-contributions) and [mistakes PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK) items 1 and 3.
- **Not covered:**
  - Foreigners on any pass, meaning anyone who is not an SC or SPR. They get **no CPF**, but SDL still applies, and so do MBMF and SINDA where eligible.
  - UN-organisation employees.
  - Students who meet CPF's exemption criteria (a separate CPF PDF covers this).
- **An agreement to waive CPF is void.** CPF states: "This agreement is not valid and the employer is responsible to pay both the employer's and employee's share" ([mistakes PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK) item 2).
- **Over-deduction is not allowed.** The employer must deduct exactly the employee share. Nothing may be deducted from an employee earning $500 or less (item 9).

### 1.2 Contribution rates (Table 1: SC, and SPR from the 3rd year), monthly TW > $750

| Age band | 2026 employer | 2026 employee | 2026 total | **2027** employer | **2027** employee | **2027** total |
|---|---|---|---|---|---|---|
| 55 and below | 17% | 20% | 37% | 17% | 20% | 37% |
| Above 55 to 60 | 16% | 18% | 34% | **16.5%** | **19%** | **35.5%** |
| Above 60 to 65 | 12.5% | 12.5% | 25% | **13%** | **13%** | **26%** |
| Above 65 to 70 | 9% | 7.5% | 16.5% | 9% | 7.5% | 16.5% |
| Above 70 | 7.5% | 5% | 12.5% | 7.5% | 5% | 12.5% |

The 2026 figures come from the [2026 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf) and the [rates page](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay). The 2027 figures come from the [2027 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf) and the [announcement](https://www.cpf.gov.sg/employer/infohub/news/cpf-related-announcements/new-contribution-rates), which says: "The changes apply to wages earned from 1 January 2027." The 2027 increase for ages above 55 to 65 goes to the RA, up to the FRS. The graduated rates for 1st/2nd-year SPRs are **unchanged** in 2027.

#### Full official formulas: Table 1, 2026 (TW = OW + AW; OW capped at $8,000)

| Age | TW ≤ $50 | $50 < TW ≤ $500 (total; employee nil) | $500 < TW ≤ $750: total | $500 < TW ≤ $750: employee | TW > $750: total | TW > $750: employee |
|---|---|---|---|---|---|---|
| ≤ 55 | Nil | 17% (TW) | 17% (TW) + 0.6 (TW − $500) | 0.6 (TW − $500) | [37% (OW)]* + 37% (AW), *max $2,960 | [20% (OW)]* + 20% (AW), *max $1,600 |
| > 55–60 | Nil | 16% (TW) | 16% (TW) + 0.54 (TW − $500) | 0.54 (TW − $500) | [34% (OW)]* + 34% (AW), *max $2,720 | [18% (OW)]* + 18% (AW), *max $1,440 |
| > 60–65 | Nil | 12.5% (TW) | 12.5% (TW) + 0.375 (TW − $500) | 0.375 (TW − $500) | [25% (OW)]* + 25% (AW), *max $2,000 | [12.5% (OW)]* + 12.5% (AW), *max $1,000 |
| > 65–70 | Nil | 9% (TW) | 9% (TW) + 0.225 (TW − $500) | 0.225 (TW − $500) | [16.5% (OW)]* + 16.5% (AW), *max $1,320 | [7.5% (OW)]* + 7.5% (AW), *max $600 |
| > 70 | Nil | 7.5% (TW) | 7.5% (TW) + 0.15 (TW − $500) | 0.15 (TW − $500) | [12.5% (OW)]* + 12.5% (AW), *max $1,000 | [5% (OW)]* + 5% (AW), *max $400 |

**2027 Table 1 changes:**

- **> 55–60:** 16.5% (TW) in the employer-only band. Phase-in is 16.5% (TW) + 0.57 (TW − $500), with employee share 0.57 (TW − $500). The full rate is 35.5% total and 19% employee, with maxima of $2,840 and $1,520.
- **> 60–65:** 13% (TW) in the employer-only band. Phase-in is 13% (TW) + 0.39 (TW − $500), with employee share 0.39 (TW − $500). The full rate is 26% total and 13% employee, with maxima of $2,080 and $1,040.

The other bands are identical to 2026. ([2027 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf))

#### SPR 1st and 2nd year: Tables 2–5 (2026, unchanged in 2027 except F/G above 55–65)

Total / employee rates in the TW > $750 band are shown below. The employer-only band rate equals total minus employee. The phase-in coefficient is printed in the PDFs and always equals 3 × the employee rate.

| Age | T2: SPR yr1 G/G | T3: SPR yr2 G/G | T4: SPR yr1 F/G (2026) | T5: SPR yr2 F/G (2026) | T4 2027 | T5 2027 |
|---|---|---|---|---|---|---|
| ≤ 55 | 9% / 5% (coeff 0.15) | 24% / 15% (0.45) | 22% / 5% (0.15) | 32% / 15% (0.45) | 22% / 5% | 32% / 15% |
| > 55–60 | 9% / 5% (0.15) | 18.5% / 12.5% (0.375) | 21% / 5% (0.15) | 28.5% / 12.5% (0.375) | **21.5%** / 5% | **29%** / 12.5% |
| > 60–65 | 8.5% / 5% (0.15) | 11% / 7.5% (0.225) | 17.5% / 5% (0.15) | 20% / 7.5% (0.225) | **18%** / 5% | **20.5%** / 7.5% |
| > 65–70 | 8.5% / 5% (0.15) ("Above 65") | 8.5% / 5% (0.15) ("Above 65") | 14% / 5% (0.15) | 14% / 5% (0.15) | 14% / 5% | 14% / 5% |
| > 70 | same as above 65 | same as above 65 | 12.5% / 5% (0.15) | 12.5% / 5% (0.15) | 12.5% / 5% | 12.5% / 5% |

Tables 2 and 3 publish only four age bands, ending at **"Above 65"**. Tables 4 and 5 have five. The JSON repeats the "Above 65" row for both the 65–70 and > 70 bands. Employer-only band rates (TW $50–$500) for 2026:

| Table | ≤ 55 | > 55–60 | > 60–65 | > 65–70 | > 70 |
|---|---|---|---|---|---|
| T2 (yr1 G/G) | 4% | 4% | 3.5% | 3.5% | 3.5% |
| T3 (yr2 G/G) | 9% | 6% | 3.5% | 3.5% | 3.5% |
| T4 (yr1 F/G) | 17% | 16% | 12.5% | 9% | 7.5% |
| T5 (yr2 F/G) | 17% | 16% | 12.5% | 9% | 7.5% |

In 2027, T4 and T5 use 16.5% for > 55–60 and 13% for > 60–65.

**SPR options.**

- G/G (graduated employer and employee) is the default.
- An employer and a 1st/2nd-year SPR can **jointly apply** for either:
  - F/F, both at full rates, which uses Table 1; or
  - F/G, full employer and graduated employee, which uses Tables 4 and 5.
- Applications go through form.gov.sg forms linked from [CPF](https://www.cpf.gov.sg/service/article/how-can-i-contribute-more-cpf-for-my-employee-who-just-obtained-his-singapore-permanent-resident-spr-status).
- The FAQ does not say when the higher rate takes effect, or whether the choice can be reversed. **Store the approval date and option as data; never infer them.**

### 1.3 How the SPR year is determined

From [CPF FAQ](https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status) and the [rates page](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay):

- **1st year:** from the SPR status date (shown on the ICA Entry Permit) to the last day of the month of the 1st anniversary.
- **2nd year:** from the 1st day of the next month to the last day of the month of the 2nd anniversary.
- **3rd year onwards:** from the 1st day of the month after the 2nd anniversary.
- **Official example:** SPR on 15 Jan 2026 gives 1st year = 15 Jan 2026 to 31 Jan 2027, 2nd year = 1 Feb 2027 to 31 Jan 2028, and 3rd year from 1 Feb 2028. A second example in the [mistakes PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK): SPR on 5 Jan 2016 gives yr1 to 31 Jan 2017, yr2 from 1 Feb 2017, and yr3 from 1 Feb 2018.
- **Conversion month:** CPF is payable only on OW pro-rated from the SPR date. AW is subject only if it is paid on or after the SPR date (same FAQ).

### 1.4 How age is determined

"New contribution rates apply from the first day of the month after the employee's 55th, 60th, 65th or 70th birthday." ([rates page](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay))

Official example ([FAQ](https://www.cpf.gov.sg/service/article/when-will-my-employee-s-cpf-contribution-rates-change-when-they-turn-55-60-65-or-70)): for a 55th birthday on 13 Jan 2026, January 2026 wages use "55 and below" (37%) and February 2026 wages use "above 55 to 60" (34%).

Implementation:

- `milestoneMonth(N) = (birthYear + N, birthMonth)`.
- The band is the number of milestones N ∈ {55, 60, 65, 70} with `wageMonth > milestoneMonth(N)`.
- This is month-based, so 29 February birthdays need no special handling.
- **AW** uses the age band and rate table in force in the month the AW is **paid**. When AW paid earlier is re-subjected later (because the AW ceiling was recomputed), it uses the rate of the month in which that AW was originally paid. See [AW examples](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE) 11, 13 and 14.

### 1.5 Wage bands

| Total wages for the calendar month | Employer | Employee |
|---|---|---|
| ≤ $50 | Nil | Nil |
| > $50 to $500 | rate × TW | Nil |
| > $500 to $750 | total = rate × TW + k × (TW − 500), employer = total − employee | k × (TW − 500) ("phase-in") |
| > $750 | full rate on OW (capped) + AW (capped) | full rate |

**Edge case (official).** The band is chosen on the employee's **total wages for the month before the AW is capped**. AW Example 16: OW is $500 and AW is $30,000, of which only $100 is subject to CPF. Total wages before capping are $30,500 (> $750), so 37% applies to the $600 subject to CPF: employer $102, employee $120. In August the AW of $2,000 is fully above the ceiling, yet the band is still > $750, so the employee pays 20% × $500 = $100 ([AW examples PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE)).

There is one unresolved case: pre-cap TW falls in $500–$750 only because of non-subject AW. The engine should then apply the phase-in formula to the subject TW and raise a warning. This is flagged in the JSON `notes`.

### 1.6 Wage ceilings

- **OW ceiling:** **$8,000 per month from 1 Jan 2026** ($7,400 in 2025). The 2027 tables still say "OW ceiling of $8,000". Sources: [2026 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf), [2027 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf), [2025 PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2025_contributionandallocationrates.pdf). The ceiling applies to OW for the calendar month.
- **Annual Salary Ceiling:** $102,000 per calendar year.
- **AW ceiling:** AW ceiling = **$102,000 − Total Ordinary Wages subject to CPF for the year**. It applies "on a per employee, per employer, per calendar year basis" ([wages page](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions)). For a full year on at least $8,000 OW in 2026, the AW ceiling is $102,000 − $96,000 = **$6,000**.
- **AW ceiling procedure** ([AW examples PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE)):
  - **Step 1:** at every AW payment, estimate the AW ceiling using "the current year's estimated monthly OW". For a mid-year joiner, use only the months of expected employment. Ex. 5: joined in June on $10,000, so the ceiling is $102,000 − $8,000 × 7 = $46,000.
  - **Step 2:** in the last month of employment or in December, whichever is earlier, recompute using **actual** OW subject to CPF. Pay any shortfall with that month's contributions, or apply for a refund of any excess.
  - **After a salary change:** recompute at the next AW payment. Ex. 4: the salary drops in July, so August's AW absorbs an extra $18,000.
  - **AW paid after leaving:** recompute again (Ex. 7, 8 and 9). A rehire in the same year uses combined OW from both stints with the same employer (Ex. 15).
  - **Year of the AW:** "The applicable AW ceiling depends on the due and payable date of the AW". A 2025 bonus paid in 2026 uses the 2026 ceiling.

### 1.7 OW vs AW classification

- **OW** must meet both conditions: it is given for employment **in that month**, and it is **payable by the 14th of the following month**. Anything else is **AW** ([wages page](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions)).
- **Bonus / AWS / 13th month:** AW.
- **Overtime:** apportion it to the calendar month in which the OT was worked.
  - OT for April paid by 14 May is OW for April.
  - OT for April paid on 30 May is AW for May.
  - OT covering 25 Mar–24 Apr paid 30 Apr: the 25–31 Mar portion is AW for April and the 1–24 Apr portion is OW for April.
  - Source: [mistakes PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK) item 10.
- **Commission:** monthly commission paid with salary for that month's sales and payable by the 14th of the next month is OW. Quarterly or annual commission fails the "wholly in respect of that month" test and is AW (application of the rule; CPF's examples only say commission is a wage). Third-party commissions are also wages (mistakes PDF item 6).
- **Back pay:**
  - A **retrospective increment** decided later and back-dated is **AW** in the month it is paid.
  - An increment that was due but **paid late through administrative error** is **OW** of the original months. The employer must pay the shortfall for those months, and late-payment interest applies.
  - Source: [CPF FAQ](https://www.cpf.gov.sg/service/article/are-retrospective-salary-increments-classified-as-ordinary-wages-ow-or-additional-wages-aw).
- **Leave encashment / pay in lieu of leave:** CPF is payable ([FAQ](https://www.cpf.gov.sg/service/article/are-cpf-contributions-payable-on-encashment-of-leave); allowances PDF "Leave pay … YES"). CPF does not state OW or AW on that FAQ. Applying its [OW/AW classification](https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions), accumulated unused leave is **AW**, since it is not wholly for employment in the payment month. This also applies on cessation: unused-leave wages are distinct from an exempt termination benefit (compensation unrelated to services). [Cash benefits on leaving remain CPF-payable](https://www.cpf.gov.sg/service/article/are-cpf-contributions-payable-on-cash-benefits-given-to-my-employee-when-he-leaves-his-employment). For AW payable after cessation from 1 Jan 2024, CPF requires SC/SPR status both on the last employment date and the AW payable date ([ex-employee AW FAQ](https://www.cpf.gov.sg/service/article/are-cpf-contributions-payable-on-additional-wages-payable-to-ex-employees-after-they-have-left-employment)). Verified 1 Nov 2026. The automated leave feed fixes accumulated-leave classification to AW rather than exposing an arbitrary override.
- **Not wages (no CPF):**
  - Compensation in lieu of notice ([FAQ](https://www.cpf.gov.sg/service/article/are-cpf-contributions-payable-on-compensation-in-lieu-of-notice)). CPF is still payable on wages up to the last day, and on the gross wages before any notice-pay offset.
  - Retrenchment benefit, ex-gratia, retirement gratuity and severance.
  - Genuine reimbursements and benefits in kind.
  - Work Injury Compensation payments.
- **Temporary lay-off benefits ARE wages.**
- **Allowances:** wages, including transport, meal, grooming, festive hongbao, per diem allowance, housing paid to the employee, handphone allowance and service charge or tips distributed as wages. Full list in the [allowances PDF](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/6jan2026_which_allowances_and_payments_attract_cpf_contributions.pdf).
- **Long-service awards:** CPF-able if the award is for less than 5 years of service. Awards at 5-year multiples are CPF-able only on the part exceeding that month's OW.
- **NS make-up pay** (Operationally Ready NSmen, paid by MINDEF/SCDF/SPF): CPF is computed on employer wages + make-up pay, "as though the employee has not been away". The employer bears the full employer share and recovers the employee share. This is not reimbursable.

### 1.8 Rounding (exact rules)

Verbatim from every 2026 and 2027 table PDF:

> 1) Compute the total CPF contribution (rounded to the nearest dollar), i.e., to be rounded down for an amount less than 50 cents and rounded up for an amount of 50 cents and above.
> 2) Compute the employee's share of CPF contribution (rounded down to the nearest dollar).
> 3) Employer's share = Total contribution − Employee's share
> 4) If there is only OW payable for the month, the maximum contribution on OW is to be rounded to the nearest dollar for the total CPF contributions and rounded down to the nearest dollar for employee's share of CPF contributions. If there are OW and AW payable for the same month, compute and sum up the CPF contributions that are payable for OW and AW and apply the rounding rules accordingly.

The [rates page](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay) says the same: "Cents should be dropped for amounts less than 50 cents … The cents should always be dropped for the employee's share."

Engine rules:

- `total = roundHalfUpToDollar(exact(rate × (OWsubj + AWsubj)))`
- `employee = floorToDollar(exact(eeRate × (OWsubj + AWsubj)))`
- `employer = total − employee`

The employer share is therefore never rounded independently, and it can come out a dollar higher than "rate × wage". At OW $7,999.99: total $2,960, employee $1,599, employer $1,361.

**Use exact rational arithmetic and do not pre-round to cents.** In integer cents × basis points, the exact total is `TWc × bps / 1,000,000` dollars. At TW $1,001.34 × 37% the exact total is $370.4958. That is 49.58 cents, below 50, so the total is $370. Rounding to cents first would give $370.50 and then $371. CPF's wording ("amount less than 50 cents") supports comparing the exact value; test vectors RD-03 and RD-04 encode this. **Contributions are whole dollars.** CPF's official examples always show whole-dollar shares, even when wages have cents (AW Ex. 9: AW $2,850.60 gives employer $485 and employee $570 on the AW part).

**Cross-check against official examples (all reproduced by the reference implementation):**

- **AW Ex. 9, Jan:** OW $8,000 + AW $2,850.60. Total = 37% × 10,850.60 = 4,014.722, which rounds to **$4,015**. Employee = 20% × 10,850.60 = 2,170.12, which rounds down to **$2,170**. Employer = **$1,845**, matching CPF's $1,360 + $485.
- **AW Ex. 14, Mar:** OW $8,000 + AW $49. Total = 2,978.13, giving $2,978. Employee = 1,609.8, giving $1,609. Employer = $1,369, matching CPF's $1,360 + $9 and $1,600 + $9.
- **AW Ex. 14, Jun shortfall:** $23,951.50 at 37%/20% plus $7,022.50 at 34%/18%. CPF shows a total of $11,250 (from 11,249.705) and an employee share of $6,054 (4,790 + 1,264). When one month's shortfall mixes rate tables, CPF rounded the combined exact total once.

### 1.9 Part-month employment

- CPF is payable on the pro-rated wages actually earned in the month, whether the employee joins or leaves mid-month ([mistakes PDF](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK) item 3).
- The **full** monthly formula (bands, ceilings) then applies to that pro-rated TW. There is no pro-ration of the $50, $500 or $750 thresholds or of the $8,000 OW ceiling.
- The amount of pro-rated salary follows the MOM incomplete-month formula in §5.
- For a mid-month SPR conversion, only the post-conversion OW is subject (§1.3).

### 1.10 OA/SA/RA/MA allocation

**Payroll does not need allocation.** The employer remits a single total per employee, and CPF Board allocates it to accounts ([allocation table 2027](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfallocationrates.pdf): "The CPF allocation is first computed for the MediSave Account, followed by the Special/Retirement Account. The remainder will be allocated to the Ordinary Account"). Note that since the closure of the SA for members aged 55 and above, contributions for those aged 55+ go to the RA.

Allocation is not needed for IR8A or for the CPF submission. Do not compute it. At most, link to the CPF page from the employee view.

### 1.11 Implications for Crow HR

- **Compute:**
  - total, employee and employer CPF per employee per month;
  - the AW ceiling (estimate at each AW payment, recompute in the last month of employment or December);
  - shortfalls and excesses on recomputation.
- **Store per employee:**
  - date of birth;
  - citizenship status history, with effective dates (SC, SPR and SPR date, foreigner);
  - SPR contribution option (G/G, F/G, F/F) with CPF approval date and reference;
  - YTD OW subject to CPF and YTD AW subject to CPF per employer per year;
  - the rate-table version used for each payslip.
- **Store per pay item:**
  - classification (OW or AW, CPF-able or not, SDL-able, SHG-able);
  - the employment month it relates to;
  - payable date (needed for the "by the 14th of the following month" OW test).
- **Display:**
  - employee share, employer share and total on the payslip;
  - the AW ceiling used and the remaining AW ceiling;
  - which rate table and age band applied.
- **Warn on:**
  - employee turning 55, 60, 65 or 70 next month;
  - SPR anniversary month, when the rates change next month;
  - AW ceiling exceeded or estimate invalidated by a salary change;
  - OW item payable after the 14th of the following month (it reclassifies as AW);
  - employee deduction attempted where TW ≤ $500;
  - any manual override of CPF.
- **Test:** every vector in `sg-test-vectors.json` must pass with integer cents and exact rational intermediate values (numerator and denominator), with no floats.

---

## 2. Skills Development Levy (SDL)

**Sources:**

- [CPF: Skills Development Levy](https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy)
- [CPF FAQ: how to calculate and pay SDL](https://www.cpf.gov.sg/service/article/how-do-i-calculate-and-pay-the-skills-development-levy-sdl)
- [Skills Development Levy Act 1979, s 2 (sso.agc.gov.sg)](https://sso.agc.gov.sg/Act/SDLA1979). I could read the interpretation section only. The First Schedule (rates) loads lazily and could not be fetched.

**The levy is now administered by SWDA.** Since **1 Jul 2026** the levy is administered by the **Skills and Workforce Development Agency (SWDA)**. The Act's definition of "Agency" was amended by Act 17 of 2026 with effect from 01/07/2026. Older material says SSG/SkillsFuture Singapore. CPF Board still collects SDL on SWDA's behalf.

**Rate and limits.**

- **Rate:** 0.25% of the employee's **total monthly wages**.
- **Minimum:** $2, for an employee earning less than $800.
- **Maximum:** $11.25, for an employee earning more than $4,500. This is 0.25% × $4,500.

**Which wages count.** All wages, meaning OW plus AW, including bonus. The Act defines wages as "the remuneration in money, including any bonus, due or granted… in respect of the person's employment". SDL has no OW or AW ceiling; only the $4,500 cap applies.

**Who is covered.** CPF says "all your employees working in Singapore, including foreign employees" and "permanent, part-time, casual, and temporary staff".

- **Legal scope (Act s 2):** an employee who renders services wholly or partly in Singapore in that month, or who is on leave attributable to such services.
- **Excluded:** "any domestic servant, gardener or chauffeur, wholly and exclusively employed by an individual otherwise than in connection with his or her trade, business, profession or vocation".
- **Not verified:** the SWDA FAQ listing other exempt categories (the [CPF FAQ](https://www.cpf.gov.sg/service/article/which-categories-of-employees-or-workers-are-exempted-from-skills-development-levy-sdl) only links to the SWDA portal, which was unreachable because of a TLS error). Secondary sources mention interns/vacation students and months with no service in Singapore. Treat these as **unverified** and let admins flag an employee as SDL-exempt with a reason.

**Rounding (official).**

- "Add up the SDL calculated for each employee and then round the total amount down to the nearest dollar."
- CPF's official example: five employees on $609.50, $2,000, $4,500, $4,502.03 and $10,000. Their levies are $2, $5, $11.25, $11.25 and $11.25. The sum is $40.75, and **$40** is payable.
- CPF does not publish a rule for rounding each employee's amount. Sum the exact amounts, then floor.
- Integer approach: per-employee levy in units of 1/10,000 cent = `wageCents × 25`. Clamp it to the range [2,000,000, 11,250,000]. The employer total in dollars is `floor(Σ / 1,000,000)`.

**How it is paid.** SDL goes with the monthly CPF submission, payment code 11 in the CPF EZPay FTP file.

- EZPay auto-computes SDL for SC and SPR staff. **Foreigners' SDL must be entered manually.**
- Employers with only foreign staff pay SWDA directly.

### Implications for Crow HR

- **Compute:** SDL per employee per month, and the employer total for the CSN.
- **Display:** the per-employee SDL with four decimal places in the employer report, and the floored dollar total.
- **Never deduct** SDL from the employee. It is an employer levy.
- **Store:** an SDL-exempt flag with a reason (domestic worker employed by an individual, unverified exemptions).
- **Warn:** if an organisation has only foreign employees, SDL is paid to SWDA, not through CPF.

---

## 3. Foreign Worker Levy (FWL)

Sources: MOM, and the EFMA and Work Passes Regulations as read on SSO. EFMA here is the Employment of Foreign Manpower Act 1990, in the version in force from 1 Dec 2025. The Work Passes Regulations are S 569/2012, in the version in force from 1 Jan 2026.

### 3.1 Rule in plain English

**Who pays.** The employer pays the levy for every S Pass and Work Permit (WP) holder.
- The Minister imposes the levy "on employers" ([EFMA s.11(1)](https://sso.agc.gov.sg/Act/EFMA1990)).
- MOM: "As an employer, you must pay the levy for all your S Pass holders" ([MOM S Pass quota & levy](https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements), last updated 19 Feb 2026).
- Paying the monthly levy for each worker is a WP employer condition ([MOM WP conditions](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/work-permit-conditions)).
- EP, PEP, ONE Pass and TEP have **no levy or quota**:
  - [EP key facts](https://www.mom.gov.sg/passes-and-permits/employment-pass/key-facts)
  - [PEP key facts](https://www.mom.gov.sg/passes-and-permits/personalised-employment-pass/key-facts)
  - [ONE Pass key facts](https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/key-facts)
  - [TEP key facts](https://www.mom.gov.sg/passes-and-permits/training-employment-pass/key-facts)
- LOC and PLOC holders: no levy or quota ([PLOC key facts](https://www.mom.gov.sg/passes-and-permits/pre-approved-letter-of-consent/key-facts)).

**Liability period.**
- **Start:** "The levy liability starts from the day the S Pass is issued and ends when the pass is cancelled or expires" ([MOM S Pass levy](https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements)).
- **Statute:** the levy continues to be payable unless the pass has expired, been suspended or revoked, or been cancelled on the employer's application ([EFMA s.11(2)](https://sso.agc.gov.sg/Act/EFMA1990)).
- **End on cancellation:** the "When levy stops" row reads "1 day before cancellation" for both passes. See [Cancel a WP](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/cancel-a-work-permit) ("Your worker's levy will be charged until 1 day before the pass cancellation") and [Cancel an S Pass](https://www.mom.gov.sg/passes-and-permits/s-pass/cancel-a-pass).
- **Late renewal:** "If you renew the Work Permit late, you're still liable for the levy after it expires" ([Renew a WP](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/renew-a-work-permit)).
- **S Pass issued after the old pass expires:** levy penalties or overstay fines may apply, and "You still need to pay levy throughout this period" ([Renew an S Pass](https://www.mom.gov.sg/passes-and-permits/s-pass/renew-a-pass)).

**Billing.** MOM bills monthly ([Paying the levy](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/foreign-worker-levy/paying-the-levy), last updated 8 Jul 2026).
- The bill is viewable online on the **3rd working day** of each month.
- Each month's levy is due by the **17th of the following month**, or the next working day.
- Payment is by GIRO, or PayNow QR if there is no GIRO arrangement. GIRO deducts on the 17th.
- The regulations require payment "through GIRO or by such other means as may be approved by the Controller in writing":
  - WP: [Work Passes Regs, 4th Sch. Pt IV para 9](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)
  - S Pass: [5th Sch. Pt II para 9](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)

**Penalties** ([Paying the levy](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/foreign-worker-levy/paying-the-levy)):
- A late-payment penalty is charged.
- After two consecutive missed months, the employer's WPs and S Passes are revoked the following month.
- The employer cannot apply for new WPs, and related companies may be blocked.
- The statutory cap on the late penalty is 30% of the outstanding levy ([EFMA s.11(5)](https://sso.agc.gov.sg/Act/EFMA1990)).
- Construction: a levy bond applies after late payment at least 3 times in 12 months, among other triggers. It is $600 per skilled worker and $2,000 per unskilled worker ([Construction sector requirements](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements)).

### 3.2 The levy must not be deducted from the employee's salary

The law and MOM both say no, and worker consent does not change this.

- **Statute: the employer bears the levy.** "the employer of a foreign employee shall … bear and be liable to pay … (e) the levy imposed under section 11(1) in respect of the foreign employee and any penalty due thereon" ([EFMA s.25(6)(e)](https://sso.agc.gov.sg/Act/EFMA1990)).
- **Statute: financial penalty for passing it on.** If an employer "causes any foreign employee to bear any fee, cost, levy … that the employer shall bear … under subsection (6)", the Controller may impose a financial penalty of up to **$20,000** ([EFMA s.25(4)](https://sso.agc.gov.sg/Act/EFMA1990)).
- **Statute: deductions presumed unlawful.** s.22A(1) bars deducting from salary, or receiving, any sum "as consideration … for the employment". s.22A(3) presumes that a deduction which is not an employee-recoverable fee or an authorised Employment Act deduction was taken as such consideration. The offence carries a fine up to $30,000 and/or 2 years' jail ([EFMA s.22A](https://sso.agc.gov.sg/Act/EFMA1990)).
- **MOM FAQ:** "Can employers pass on the foreign worker levy costs to their foreign workers? **No.** … The Employment of Foreign Manpower Act (EFMA) states that employers must not recover the FW levy or other employment-related costs from their workers" ([MOM FAQ](https://www.mom.gov.sg/faq/levy/can-employers-pass-on-the-foreign-worker-levy-costs--to-their-foreign-workers), 24 Jul 2024).
- **MOM salary deductions page (Employment Act framing):** "The deduction also cannot contravene any other law. For example, if you are a foreign worker, your employer is not allowed to deduct your salary to recover levy costs". The same page lists "Levy payment" among items that cannot be deducted ([MOM Salary deductions](https://www.mom.gov.sg/employment-practices/salary/salary-deductions), 16 Dec 2024).
- **UNVERIFIED:** the Employment Act s.27 text itself could not be fetched because SSO was blocking.

### 3.3 Levy rates and quotas in force on 31 Oct 2026

**S Pass.**
- **$650/month**, harmonised across all sectors and tiers since **1 Sep 2025**.
- Daily rate: **$21.37**.
- Sources: [MOM S Pass levy](https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements); [COS 2025 factsheet](https://www.mom.gov.sg/-/media/mom/documents/budget2025/cos-2025-factsheet-on-foreign-workforce-policies.pdf) ("Tier 1 levy … increased from $550 and harmonised with the Tier 2 levy at $650 from 1 September 2025").

**Work Permit** (monthly rate, with the daily rate in brackets):

| Sector | Tier or source | Higher-skilled (R1) | Basic-skilled (R2) | Source |
|---|---|---|---|---|
| Services (DRC 35%) | Tier 1: ≤10% of workforce | $300 ($9.87) | $450 ($14.80) | [Services](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements) (16 Sep 2026) |
| | Tier 2: >10–25% | $400 ($13.16) | $600 ($19.73) | same |
| | Tier 3: >25–35% | $600 ($19.73) | $800 ($26.31) | same |
| Manufacturing (DRC 60%) | Tier 1: ≤25% | $250 ($8.22) | $370 ($12.17) | [Manufacturing](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements) (14 Sep 2026) |
| | Tier 2: >25–50% | $350 ($11.51) | $470 ($15.46) | same |
| | Tier 3: >50–60% | $550 ($18.09) | $650 ($21.37) | same |
| Construction (DRC 83.3%; 5 WP per local), from 1 Jan 2024 | Malaysia/NAS/PRC | $300 ($9.87) | $700 ($23.02) | [Construction](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements) (21 Oct 2026) |
| | NTS | $500 ($16.44) | $900 ($29.59) | same |
| | Off-site construction | $250 ($8.22) | $370 ($12.17) | same |
| | Issued without required certification ("Unskilled") | $900 for any source | | same |
| Process (DRC 83.3%; 5 WP per local) | Malaysia/NAS/PRC | $200 ($6.58) | $450 ($14.80) | [Process](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements) (1 Jul 2026) |
| | NTS | $300 ($9.87) | $650 ($21.37) | same |
| Marine shipyard (DRC 75%; 3 WP per local) | all | $350 ($11.51) | $500 ($16.44) | [Marine](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/marine-sector-requirements) (1 Jul 2026) |

The MOM quota and levy booklet, updated 1 Jul 2026, gives the same figures ([guide](https://www.mom.gov.sg/-/media/mom/documents/services-forms/passes/guide_on_comp_of_company_quota_balance.pdf)).

**Dependant's Pass holders on a Work Permit (DP-WP).** They pay the lowest levy rate for the sector or tier ([DP working in Singapore](https://www.mom.gov.sg/passes-and-permits/dependants-pass/working-in-singapore)):
- Construction $300 (off-site $250).
- Process $200.
- Marine $350.
- Manufacturing and Services: the R1 rates by tier.

**Daily rate formula.** "(Monthly levy rate x 12) / 365 = rounding up to the nearest cent". It applies only when the holder "did not work for a full calendar month" (all sector pages above). Applying ceil(monthly × 12 / 365) reproduces every daily figure MOM publishes. For example, 450 × 12 / 365 = 14.7945, which rounds up to 14.80.

**Changes in skill status.** For construction and process, a new levy rate "will start on the 1st of the following month" ([Construction](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements), [Process](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements)).

**Levy waivers** ([Apply for levy waiver](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/foreign-worker-levy/apply-for-levy-waiver)):
- Situations covered:
  - Overseas leave of **at least 7 consecutive days**.
  - Hospitalisation leave.
  - Both are capped at **60 calendar days per calendar year**.
  - Police or embassy custody.
  - Death.
  - Onboard centre attendance.
  - Malaysian National Service.
  - Harbour-craft vessel trips of 3 or more days.
- Apply from the 1st of the month after receiving the bill, and **within 1 year** of the bill.

**Announced changes** ([COS 2026 factsheet](https://www.mom.gov.sg/-/media/mom/documents/press-releases/2026/factsheet-on-foreign-workforce-policies-03032026.pdf), 3 Mar 2026). All take effect "from 2028"; the exact date is **UNVERIFIED**, as MOM "will release more details on the implementation timeline in due course".
- **Services:** Tier 1 and Tier 2 merge into one tier at R1 $400 / R2 $600 for up to 25% of workforce. Tier 3 is unchanged at $600 / $800.
- **Manufacturing:** Tier 1 and Tier 2 merge at R1 $300 / R2 $470 for up to 50%. Tier 3 is unchanged at $550 / $650.
- **Process R2:** Malaysia/NAS/PRC goes from $450 to **$600**; NTS from $650 to **$800**. R1 is unchanged.
- **Marine shipyard R2:** from $500 to **$600**.
- **S Pass levy:** no 2027 or 2028 change was announced in COS 2026. COS 2026 does say the S Pass minimum qualifying salary "is expected to be around $4,000 – $4,500 by around 2030".

### 3.4 Quota (dependency ratio ceiling) concepts

**DRC.** The DRC "is the maximum ratio of foreign workers to the total workforce that a company in a given sector can employ" ([MOM S Pass quota](https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements)).

| Sector | DRC (WP + S Pass) |
|---|---|
| Construction | 83.3% |
| Process | 83.3% |
| Marine shipyard | 75% |
| Manufacturing | 60% |
| Services | 35% |

**Sub-quotas** ([MOM S Pass quota](https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements)):
- **S Pass sub-DRC:** 10% of total workforce in Services; 15% in Construction, Manufacturing, Marine and Process.
- **PRC WP sub-quota:** 8% in Services; 25% in Manufacturing.
- **NTS Occupation List:** 8% NTS sub-DRC, and a fixed monthly salary of at least **$2,000** ([COS 2026 factsheet](https://www.mom.gov.sg/-/media/mom/documents/press-releases/2026/factsheet-on-foreign-workforce-policies-03032026.pdf)).
- **Construction R1 minimum:** at least 10% of construction WP holders must be Higher-Skilled (R1) before hiring or renewing R2 workers ([Construction](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements)).

**How locals are counted** ([LQS page](https://www.mom.gov.sg/employment-practices/progressive-wage-model/local-qualifying-salary), last updated 1 Jul 2026; [quota guide](https://www.mom.gov.sg/-/media/mom/documents/services-forms/passes/guide_on_comp_of_company_quota_balance.pdf)):
- Local employees are counted from the company's CPF data.
- A local earning **at least $1,800/month** counts as **1**. A local earning $900 to below $1,800 counts as **0.5**.
- The Local Qualifying Salary (LQS) is "$1,800 today". Part-timers working under 35 hours a week need at least $10.50/hr gross.
- The quota uses a **3-month average** of CPF data. Data declared by the 14th counts in the next month's quota.
- Local headcounts update every Saturday.
- Late CPF declarations reduce the quota and "may cause your foreign workers to be allocated higher levy tiers".
- A local can count toward the quota of at most two companies.

**Firms over the DRC** can keep excess workers until their permits expire, but cannot get new permits or renewals above the DRC ([Services](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements)).

### 3.5 Recommendation: record the levy, estimate it, never deduct it

**Agreed with your lean.** Crow HR should **record and estimate** the levy, not compute it as an authoritative bill, and never deduct it. Three reasons:
1. MOM computes the actual bill. Tier allocation depends on the firm's CPF-derived local headcount (3-month average, declaration timing), on MOM's own ordering of workers into tiers, on waivers, and on skill status. A payroll system cannot reproduce all of this reliably (sources in §3.3 and §3.4).
2. The levy is an employer cost, so it belongs in cost reports and the GL, not on the payslip.
3. A deduction line for the levy would expose the employer to EFMA s.25(4) and s.22A liability.

**Implications for Crow HR:**
- **Store per pass:**
  - Pass type, sector of the employer's MOM sector assignment, and skill level (R1, R2, or Unskilled for construction).
  - Source group (Malaysia/NAS/PRC, NTS, off-site) and whether the worker is on the NTS Occupation List.
  - Levy tier as shown on the MOM levy bill. Make it user-entered and overridable.
  - Pass issue date, expiry date and cancellation date.
  - Levy waiver periods.
- **Compute:**
  - A monthly levy estimate: monthly rate for full months; daily rate × days for part months; day-count convention per MOM's "until 1 day before cancellation".
  - An effective-dated rate table (`sg-rule-tables.json` → `foreignWorkerLevy`).
  - Totals by sector, tier, cost centre and month.
  - A reconciliation view against the MOM bill amount, which the user enters or imports.
- **Display:** an "Estimate — MOM levy bill is authoritative" label. Due-date reminders for the 17th of each month (or next working day). A warning when the estimated DRC or sub-DRC utilisation crosses a tier boundary or the ceiling.
- **Compute the local headcount** for the quota estimate using the LQS rule (≥ $1,800 counts 1; $900–$1,799.99 counts 0.5) from CPF-liable SC/PR employees.
- **Block** any deduction or recurring-deduction type tagged "levy", "work pass fee", "security bond", "medical insurance" or "repatriation" for WP and S Pass holders. Those costs are employer-borne under [EFMA s.25(6)(a)–(f)](https://sso.agc.gov.sg/Act/EFMA1990). Show the legal reason in the UI.
- **Ship the rates as effective-dated data**, not code. Mark the 2028 rows "announced, date TBA" and let admins pin a date when MOM publishes it.

---

## 4. Self-Help Group (SHG) funds: CDAC, ECF, MBMF, SINDA

**Sources:**

- [CPF: Contributions to self-help groups](https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups) (the tables below)
- [CPF FAQ: determining SHG](https://www.cpf.gov.sg/service/article/how-do-i-determine-which-self-help-group-shg-my-employee-should-contribute-to)
- [CDAC employer FAQ](https://www.cdac.org.sg/cdac-funding-info-information-for-employers)
- [MUIS MBMF employer information](https://www.muis.gov.sg/give-back/mbmf/employer-information/)
- [SINDA](https://www.sinda.org.sg/)

### Who contributes, and how the fund is decided

| Fund | Who | Basis |
|---|---|---|
| CDAC | Chinese; SC and SPR only | race on NRIC |
| ECF | Eurasian; SC and SPR only ("a person defined as such in his/her identity card or a person of both European and Asian ancestry") | race |
| MBMF | **Muslims**: SC, SPR **and foreign employees** | **religion** (statutory basis: Administration of Muslim Law Act s 78) |
| SINDA | Indian descent: SC, SPR **and Employment Pass holders** (includes Bangladeshis, Bengalis, Parsees, Sikhs, Sinhalese, Telegus, Pakistanis, Sri Lankans, Goanese, Malayalees, Punjabis, Tamils, Gujaratis, Sindhis and all people from the Indian sub-continent) | race |

- **Double-barrelled race:** "the first race listed determines the applicable SHG". For example, Indian-Chinese → SINDA. The employee may *choose* to give to both.
- **Muslims:** a Muslim pays MBMF **plus** the fund for their race. Official examples: Muslim of Indian race → MBMF + SINDA; Muslim of Indian-Chinese race → MBMF + SINDA.
- **Data source:** use the NRIC. If it is unavailable, the employee declares their race and religion and must tell the employer about any change.

### Contribution tables (monthly total wages → monthly contribution)

These are current as published by CPF on 31 Oct 2026.

**CDAC**

| Wages | Contribution |
|---|---|
| ≤ $2,000 | $0.50 |
| > $2,000–3,500 | $1.00 |
| > $3,500–5,000 | $1.50 |
| > $5,000–7,500 | $2.00 |
| > $7,500 | $3.00 |

**ECF**

| Wages | Contribution |
|---|---|
| ≤ $1,000 | $2 |
| > $1,000–1,500 | $4 |
| > $1,500–2,500 | $6 |
| > $2,500–4,000 | $9 |
| > $4,000–7,000 | $12 |
| > $7,000–10,000 | $16 |
| > $10,000 | $20 |

**MBMF** (effective for wages earned from 1 Jun 2016, per MUIS)

| Wages | Contribution | Mosque & Religious Education | Mendaki |
|---|---|---|---|
| ≤ $1,000 | $3.00 | $1.75 | $1.25 |
| > $1,000–2,000 | $4.50 | $3.00 | $1.50 |
| > $2,000–3,000 | $6.50 | $5.00 | $1.50 |
| > $3,000–4,000 | $15.00 | $11.00 | $4.00 |
| > $4,000–6,000 | $19.50 | $13.50 | $6.00 |
| > $6,000–8,000 | $22.00 | $14.50 | $7.50 |
| > $8,000–10,000 | $24.00 | $16.00 | $8.00 |
| > $10,000 | $26.00 | $17.50 | $8.50 |

The MUIS table prints the first band as "< $1,000", while CPF prints "$1,000 or less". We follow CPF, so exactly $1,000.00 → $3.00. The amount is the same either way.

**SINDA**

| Wages | Contribution |
|---|---|
| ≤ $1,000 | $1 |
| > $1,000–1,500 | $3 |
| > $1,500–2,500 | $5 |
| > $2,500–4,500 | $7 |
| > $4,500–7,500 | $9 |
| > $7,500–10,000 | $12 |
| > $10,000–15,000 | $18 |
| > $15,000 | $30 |

The effective dates of the CDAC, ECF and SINDA tables are not stated on the CPF page. The JSON records `effectiveFrom` as "verified current on 2026-10-31" and leaves the start date flagged (`effectiveFromVerified: false`).

### Which wages count

- **Total wages for the month, including AW, with no CPF ceiling.** MUIS: "'Wages' refers to all monetary remuneration … salary, overtime pay, allowances, leave pay, cash rewards, incentives, commissions and bonuses." CDAC FAQ 17: "compute the contribution rate based on the gross wages of the employee received in the month". A bonus month can therefore move the employee into a higher band.
- **Part months:** CDAC FAQ 15 says to pro-rate "based on the gross wages paid to the employee for that period". In practice, look up the band on the actual (pro-rated) wages paid. The table amount itself is not pro-rated.
- **Payments after leaving** (bonus, commission, leave encashment paid the month after) also attract SHG in that month (CDAC FAQ 17).
- **Interns:** CDAC, ECF and SINDA are payable only if CPF is payable for the intern. For MBMF, see the MUIS student-pay rules ([CPF FAQ](https://www.cpf.gov.sg/service/article/are-self-help-group-shg-contributions-payable-for-an-intern-on-an-internship-programme)).
- **Ambiguous:** whether SHG is due when TW ≤ $50 (CPF nil) for an SC or SPR. This is not stated anywhere. Default: deduct per the table, and allow an override.

### Opting out and varying the amount

- **Legal position:** contributions are deducted by default ("you're expected to deduct"). They are **voluntary in the sense that employees can opt out**, and the employee arranges it with the SHG.
  - The CPF (Contribution to Community Fund) Rules require the employee to notify the employer on the form the SHG provides. This comes from a search snippet of `sso.agc.gov.sg/SL/CPFA1953-R5`, a **secondary reading**, because SSO was not fetchable.
- **CDAC:** the employee sends the Opt-Out Form to CDAC (cdacfund@cdac.org.sg). "The employer can stop the CDAC contribution of the employee immediately after the Opt-Out Form is sent out. A copy of the Opt-Out Form should be filed by the employer for record. No acknowledgement will be given by CDAC."
  - A person with several employers may contribute through one employer and opt out at the others.
- **MBMF:** the employee may increase, decrease or opt out of any of the three components (Mosque Building, Religious Education, Mendaki) by submitting the MUIS Change Application Form. MUIS then issues a certificate; processing takes about 2 weeks.
  - **Payment deadline:** MBMF follows the CPF cut-off (14th of the following month).
  - **Penalty:** an employer who deducts MBMF but fails to pay it is liable to a fine of up to $2,000.
- **SINDA:** the "Notification to Opt-out of/Fix SINDA Fund Contribution" form is addressed to the employer (an online version also notifies SINDA). A new form is needed on each change of employer.
- **ECF:** use the opt-out form from the Eurasian Association. The eurasians.sg page was reachable but contained no extractable detail.

### How it is paid

SHG is deducted from the employee's net pay and paid with the CPF submission. FTP payment codes: 02 MBMF, 03 SINDA, 04 CDAC, 05 ECF. Refunds of overpaid SHG are claimed from the SHG directly, not from CPF.

### Implications for Crow HR

- **Store per employee:**
  - race (as on NRIC; if double-barrelled, both components in order);
  - religion (Muslim or not);
  - pass type;
  - SHG elections, effective-dated: default, opted out, fixed custom amount, or an extra fund (for example, also CDAC). Each election needs the evidence document (opt-out form or MUIS certificate) and the date sent.
- **Compute:** the SHG deduction from total wages paid in the month, after CPF eligibility checks.
- **Payslip:** show SHG as a separate employee deduction line.
- **Warn:**
  - race or religion is missing for an SC, SPR, EP holder or Muslim foreigner;
  - an opt-out has no attached form;
  - more than one fund applies.
- **Never** guess race or religion from a name.
- **PDPA:** race and religion are sensitive. Collect them only for SHG purposes, restrict who can see them, and log access.

---

## 5. Employment Act (EA)

**Sources.** All MOM pages below were read on 31 Oct 2026.

**Statute not read.** The Employment Act 1968 and the Employment of Part-Time Employees Regulations on sso.agc.gov.sg returned HTTP 403 to every automated fetch. I could not check statutory wording or section numbers. Everything below relies on MOM's published guidance.

### 5.1 Who is covered

**General coverage** ([MOM: who is covered](https://www.mom.gov.sg/employment-practices/employment-act/who-is-covered), updated 24 Jul 2025):
- Covers every employee under a contract of service, local or foreign: full-time, part-time, temporary and contract staff, however they are paid.
- **Excluded:** seafarers, domestic workers, and statutory board employees or civil servants.
- **Managers and executives (PMEs)** have been covered by the core provisions since 1 Apr 2019, when the old $4,500 PME ceiling was removed ([MOM 2019 guide](https://www.mom.gov.sg/-/media/mom/documents/speeches/2018/guide-to-employment-act-changes-1-april-2019.pdf)). The core provisions are:
  - salary paid within 7 days;
  - annual leave of 7–14 days;
  - sick leave of 14 days outpatient and 60 days hospitalisation;
  - 11 public holidays;
  - KETs, payslips and records;
  - recourse for wrongful dismissal.

**Part IV (Part 4): rest days, hours of work and overtime.** MOM says Part 4 "only applies to":
- "A workman (doing manual labour) earning a monthly basic salary of **$4,500 or less**";
- a non-workman earning "a monthly basic salary of **$2,600 or less**".

Points to note:
- **Basic salary excludes** overtime, bonus, AWS, productivity incentive, special-expense reimbursements and **all allowances**.
- **Managers and executives are never Part 4**, even at or below $2,600.
- The non-workman threshold rose from $2,500 to $2,600 on 1 Apr 2019.
- **No 2026 or 2027 change to these thresholds was found.** That is a negative search result, not a confirmation.
- A **workman** is someone who mainly does manual work. This includes the EA First Schedule occupations (cleaner, construction worker, labourer, machine operator, driver, and others) and supervisors who do manual work more than half the time.

**Implications for Crow HR:**
- Store per employee: `eaCovered`, `exclusionReason`, `isWorkman`, `isManagerOrExecutive`, `contractHoursPerWeek` and `monthlyBasic`.
- Derive:
  - `part4 = !isME && ((isWorkman && basic <= 450000) || (!isWorkman && basic <= 260000))`
  - `isPartTime = contractHoursPerWeek < 35`
- Re-derive both on every salary change and keep the history.
- Warn when an employee is marked as a manager or executive but has basic ≤ $2,600. That is a common misclassification.

### 5.2 Salary payment timing and deductions

**Payment timing** ([MOM: paying salary](https://www.mom.gov.sg/employment-practices/salary/paying-salary), updated 30 Jan 2026):
- **Salary period:** at most 1 month. Salary must be paid "**within 7 days** after the end of the salary period".
- **Overtime:** pay "within **14 days** after the end of the salary period".
- **Final pay:**

| Situation | When final pay is due |
|---|---|
| Resignation with notice served | Last day |
| Resignation without notice | Within 7 days of the last day |
| Dismissal for misconduct | Last day, or within 3 working days if not possible |
| Employer terminates | Last day, or within 3 working days if not possible |

- **Method:** pay on a working day, by bank transfer or cheque. A cheque counts only once it has cleared.
- **Foreign employees leaving:** the employer must withhold monies for IRAS tax clearance (IR21, §8.3).

**Deductions** ([MOM: salary deductions](https://www.mom.gov.sg/employment-practices/salary/salary-deductions)). Only these are allowed:

| Deduction | Limit |
|---|---|
| Absence | Authorised absence uses the incomplete-month formula. Unauthorised absence uses the gross rate, and only for the time actually absent: "If you were 30 minutes late, only 30 minute's salary can be deducted." |
| Damage or loss | Only after an inquiry. Max **25% of one month's salary**, as a lump sum. |
| Accommodation and amenities | Up to the value supplied, and max **25%**. |
| Advances | Instalments of up to **25%**, repaid within **12 months**. |
| Loans | Instalments of up to **25%**. |
| Overpaid salary | Full amount. |
| Employee CPF | From that month's salary. |
| Co-operative society | With consent. |
| Other deductions with written, revocable consent | Must benefit the employee. No liquidated damages. |
| Court order or tax | As ordered or required. |

**Overall cap.** "Your employer cannot deduct more than **50%** of your total salary payable in any one salary period."
- The cap does **not** include deductions for absence, advances, loans, overpaid salary, unearned benefits, or co-operative society payments.
- The cap **may be exceeded on the final salary payment**.
- CPF is not listed as excluded from the cap, so it counts towards the 50%. **Ambiguous.**

**Migrant workers.** Deductions for levy, security bond, medical insurance, repatriation, training or medical fees are **prohibited**.

**Implications for Crow HR:**
- Compute the pay date due (period end + 7 days), the OT pay date due (+14 days), and the final-pay due date from the termination type.
- Give every deduction a category. Enforce the per-category caps and the 50% cap, waiving the 50% cap on the final run.
- Store consent records, including the withdrawal date.
- Block levy and bond deductions for work-permit holders.

### 5.3 Overtime, hours and rest days (Part 4 only)

**Hours of work** ([MOM: hours of work, overtime and rest days](https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days)):
- Normal hours: up to **44 h a week**.
  - Working 5 days a week or fewer: up to **9 h a day**.
  - Working more than 5 days a week: up to **8 h a day**.
  - Alternate-week arrangement: up to 48 h a week, and up to 88 h over any 2 weeks.
- The week runs Monday to Sunday.
- Breaks: no more than 6 h of work without a break. A 45-minute meal break is required for 8 h of work.

**Overtime eligibility and rate:**
- Who is entitled: non-workmen with basic ≤ $2,600, and workmen with basic ≤ $4,500 ([MOM FAQ](https://www.mom.gov.sg/faq/hours-of-work-overtime-and-rest-days/is-there-a-salary-limit-for-overtime-pay-entitlement)).
- Rate: **at least 1.5× the hourly basic rate**. Time off cannot replace OT pay for Part 4 staff.

**Hourly basic rate:**
- Monthly-rated: **(12 × monthly basic rate of pay) / (52 × 44)**.
- Daily-rated: daily basic / hours per day.
- Piece-rated: weekly basic pay / hours worked that week.

**Non-workman cap.** "The overtime rate payable for non-workmen is capped at the salary level of $2,600, or an hourly rate of $13.60". MOM's example: $13.60 × 1.5 × 2 h = $40.80.
- The exact value is 12 × 2600 / 2288 = $13.6364, which gives $40.91 for the same example.
- MOM publishes no rounding rule. **Recommendation:** compute OT at full precision and round the final amount half-up to the cent. That never pays less than MOM's example.
- **Flag to product:** make "round hourly rate to cents first" a policy switch that defaults to off.
- Workmen have no cap.

**Limits:**
- **72 OT hours a month**, unless MOM grants an exemption. Rest-day and public-holiday hours do not count toward the 72, except hours beyond normal daily hours on those days.
- Maximum 12 h a day.

**Rest days:**
- One unpaid rest day a week.
- No more than 12 days between rest days.
- If the rest day is not Sunday, the roster must be issued before the month starts.

**Rest-day work pay**, in multiples of the **basic daily rate**:

| Hours worked on rest day | At employer's request | At employee's request |
|---|---|---|
| Up to half of normal daily hours | 1 day | ½ day |
| More than half of normal daily hours | 2 days | 1 day |
| Beyond normal daily hours | 2 days + OT | 1 day + OT |

**Implications for Crow HR:**
- Timesheets need daily and weekly totals, with the week running Monday to Sunday.
- Compute OT only when the employee is Part 4. For non-workmen, use `min(basic, $2,600)` as the base.
- Warn when OT exceeds 72 h in a month, a day exceeds 12 h, or a meal break is missing.

### 5.4 Public-holiday pay and substitution

Sources: [MOM: public holidays entitlement and pay](https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay) and the [MOM FAQ on a holiday falling on a rest day or non-working day](https://www.mom.gov.sg/faq/public-holidays/is-an-employee-entitled-to-another-day-off-if-a-public-holiday-falls-on-a-rest-day-or-non-working-day).

**Entitlement:**
- 11 paid public holidays a year, paid at the **gross** rate.
- An employer and employee may agree to swap a holiday for another day.
- **Lost** if the employee is absent without consent or a reasonable excuse on the working day immediately before or after the holiday.
- **Not paid** if the holiday falls inside approved unpaid leave.

**When the holiday falls on a day off:**
- **On a rest day:** the next working day is a paid holiday.
- **On a non-working day** (e.g. Saturday for a 5-day week): the employee gets another day off, or 1 extra day's salary at the gross rate.
- **There is no automatic Monday substitute for Saturday holidays** ([MOM written answer, 7 Nov 2022](https://www.mom.gov.sg/newsroom/parliament-questions-and-replies/2022/1107-written-answer-to-pq-on-treatment-of-public-holiday-on-saturday)).

**Working on a public holiday:**
- On a working day: 1 extra day's salary at the **basic** rate, on top of the gross holiday pay, plus OT beyond normal hours.
- On a non-working day: 1 extra day at the gross rate or a day off, plus OT.
- **Time off in lieu** instead of pay is allowed only for workmen earning > $4,500, non-workmen earning > $2,600, and all managers and executives.

**Holidays during leave:**
- **Sick leave:** a holiday inside an MC period is not counted as sick leave ([MOM: sick leave special situations](https://www.mom.gov.sg/employment-practices/leave/sick-leave/special-situations)).
- **Maternity leave:** if taken as a block, holiday pay is already included.
- **Annual leave:** no explicit MOM rule was found. By analogy, a holiday should not consume annual leave. **Unverified**, so make it a setting with that default.
- **Polling Day** is a public holiday under s 35 of the Parliamentary Elections Act. It was most recently Saturday 3 May 2025 ([MOM FAQ](https://www.mom.gov.sg/faq/public-holidays/can-mom-provide-printed-proof-notes-or-evidence-that-polling-day-is-a-public-holiday)). Admins must be able to add ad-hoc holidays.

### 5.5 Incomplete month, daily rates and part-time pro-ration

Source: [MOM: monthly and daily salary](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary), updated 8 Dec 2025.

**Incomplete month:**
- Formula: **"Monthly gross rate of pay / Total number of working days in that month × Total number of days the employee actually worked in that month"**.
- A month is incomplete when the employee starts after the 1st, leaves before the end of the month, takes no-pay leave, or does reservist (NS) training.
- **Working days in the month** "Excludes rest days and non-working days, but includes public holidays".
- **Days actually worked** "Includes public holidays, paid hospitalisation leave and annual leave". MOM does not mention outpatient sick leave or childcare leave; treat all paid leave as worked and **flag** this.
- **Gross rate of pay** excludes OT, bonus, AWS, productivity incentive, reimbursements, and travel, food and housing allowances.
- Half day = 5 hours or fewer.

**MOM working-days table for 2026** ([XLS](https://www.mom.gov.sg/-/media/mom/documents/employment-practices/incomplete-month.xls)), Sunday as rest day:

| Week pattern | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | Year |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5-day | 22 | 20 | 22 | 22 | 21 | 22 | 23 | 21 | 22 | 22 | 21 | 23 | 261 |
| 5.5-day | 24.5 | 22 | 24 | 24 | 23.5 | 24 | 25 | 23.5 | 24 | 24.5 | 23 | 25 | 287 |
| 6-day | 27 | 24 | 26 | 26 | 26 | 26 | 27 | 26 | 26 | 27 | 25 | 27 | 313 |

Use this table as a test fixture.

**Daily rates:**
- **Daily basic rate** = (12 × monthly basic) / (52 × average working days per week). Use it for rest-day and public-holiday **work** pay.
- **Daily gross rate** = (12 × monthly gross) / (52 × days per week). Use it for pay in lieu of notice, annual leave encashment, unauthorised absence deductions, and paid holidays and leave.
- **Encashment gross-rate components** ([MOM monthly and daily salary](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary), verified 1 Nov 2026): gross pay includes contractual salary allowances. Exclusions include overtime, bonuses, AWS, expense reimbursements, productivity incentives, and travel, food and housing allowances. Crow HR adds fixed recurring allowances explicitly classified `grossRateIncluded: true` to effective basic salary; variable/irregular payments must be classified `false`, and unclassified active allowances block the request. Both salary and allowances use the request date, or last working day for an employee who has already left. Effective end dates are exclusive. Payslip working preserves basic + included allowances → monthly gross → daily rate, multiplying the exact rate by leave quantity and rounding only the payout half up to cents. The prior basic-only feature brief was incorrect; fixed allowances no longer need a manual top-up.

**Part-time employees** (fewer than 35 h a week; [MOM part-time pages](https://www.mom.gov.sg/employment-practices/part-time-employment/leave)):
- **Hourly basic rate** = 12 × monthly basic / (52 × weekly hours).
- **Annual leave, sick leave, hospitalisation leave and public holidays are granted in hours:** **(PT working hours per year / FT working hours per year) × FT entitlement in days × FT hours per day**.
  - MOM's examples: 20 h a week for 7 days of annual leave at 8 h a day = **25.5 h**. Sick leave 14 days = **50.9 h**. Hospitalisation 60 days = **218.2 h**. Public holidays at 22/44 h = 44 h a year, or 4 h per holiday.
  - MOM's numbers are consistent with rounding **hours to 1 decimal place, half-up**. **Unverified**, because the Regulations were unreadable.
- **Annual leave or public-holiday pay may be folded into the hourly rate** if the contract says so, using entitlement hours / (weekly hours × 52) × hourly gross. MOM's example: $0.12 per hour. This is **not allowed** for employees working 5 or more days a week **and** 30–34 h a week.
- **Part-time OT:** hours up to the full-timer's normal hours are paid at 1.0×. Hours beyond the full-timer's normal hours are paid at 1.5×.

**Implications for Crow HR:**
- Each employee needs a work pattern: days per week as a decimal (e.g. 5.5), the rest day, and the non-working days.
- Generate each employee's working-day calendar from that pattern.
- Keep part-time leave balances in **hours**.

## 6. Leave

Sources are cited per item and were read on 31 Oct 2026. The MSF Government-Paid Leave portal is at [profamilyleave.msf.gov.sg](https://www.profamilyleave.msf.gov.sg/).

### 6.1 Annual leave (EA core provision)

Source: [MOM: annual leave eligibility and entitlement](https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement).

**Eligibility and entitlement:**
- The employee must have **at least 3 months of service**.
- Entitlement by year of service: year 1: 7 days, year 2: 8, year 3: 9, year 4: 10, year 5: 11, year 6: 12, year 7: 13, **year 8 onward: 14 days**.

**Pro-ration:**
- Applies in the first year, and in the year of leaving: **(completed months of service ÷ 12) × entitlement**.
- Rounding: "If the fraction of a day is less than one-half, round it down. If it is half or more, round it up to one day."
- Part months are ignored. MOM's example: 14 Mar to 31 Jul is 4 completed months, so 4/12 × 10 = 3.33, giving 3 days.
- **Unpaid leave is excluded from service.** In MOM's example, a month containing 2 weeks of unpaid leave is excluded entirely. Whether a single day of unpaid leave also breaks the month is ambiguous; make it a policy setting.

**Carry forward, forfeiture and encashment** ([MOM: annual leave special situations](https://www.mom.gov.sg/employment-practices/leave/annual-leave/special-situations)):
- **Part 4 employees must be allowed to carry unused statutory leave forward for 12 months.**
- Leave is forfeited if the employee is absent without leave on more than 20% of working days, or is dismissed for misconduct.
- **On termination**, unused leave is paid at the **gross rate of the last-drawn salary**, except on dismissal for misconduct.

### 6.2 Sick leave

Source: [MOM: sick leave eligibility and entitlement](https://www.mom.gov.sg/employment-practices/leave/sick-leave/eligibility-and-entitlement), updated 12 Jan 2026.

**Eligibility:**
- At least 3 months of service.
- The employer is informed within 48 hours.
- An MC from a registered doctor or dentist.

**Entitlement:** **14 days outpatient**, and **60 days hospitalisation, which includes the 14**.

| Completed months of service | Outpatient days | Hospitalisation days (incl. outpatient) |
|---|---|---|
| < 3 | 0 (unpaid) | 0 |
| 3 | 5 | 15 |
| 4 | 8 | 30 |
| 5 | 11 | 45 |
| ≥ 6 | 14 | 60 |

**Pay and limits:**
- Hospitalisation leave is paid at the gross rate. Outpatient sick leave is paid at the gross rate excluding shift allowance.
- No paid sick leave on a rest day, public holiday or non-working day.
- Whether the sick-leave year is the calendar year or the service year is **not specified**; make it a setting.

### 6.3 Maternity leave

Sources: [MOM: maternity leave eligibility and entitlement](https://www.mom.gov.sg/employment-practices/leave/maternity-leave/eligibility-and-entitlement) (updated 24 Aug 2026) and [MSF: maternity leave](https://www.profamilyleave.msf.gov.sg/schemes/maternity-leave).

**Government-Paid Maternity Leave (GPML): 16 weeks.**

Eligibility:
- The child is a Singapore Citizen, or becomes one within 12 months.
- The mother has 3 continuous months of service before the birth.
- **There is no marriage requirement.**

Notice: 4 weeks. Without notice, only half pay is due, unless there is a good reason.

**Who pays:**
- **1st and 2nd child:** the employer pays **weeks 1–8** at the gross rate. **The Government reimburses weeks 9–16**, capped at $10,000 per 4 weeks and **$20,000** in total.
- **3rd child onward:** the Government reimburses **all 16 weeks**, capped at $10,000 per 4 weeks and $40,000 in total.
- The daily cap is $10,000 / (4 × working days per week).
- Whether employer CPF is part of the reimbursement is **secondary information** only.

**Taking the leave:**
- By default, 16 consecutive weeks (112 calendar days).
- By agreement, the last 8 weeks can be taken flexibly within 12 months, capped at 48 working days.
- **Claims** go through the GPL portal within 3 months of the last day of leave.

**EA maternity leave: 12 weeks** (child not a Singapore Citizen):
- The employer pays the first 8 weeks if the mother has fewer than 2 living children.
- The last 4 weeks are unpaid.

### 6.4 Paternity leave (current 2026 rules)

Sources: [MOM: paternity leave](https://www.mom.gov.sg/employment-practices/leave/paternity-leave) (updated 5 Feb 2026) and [MSF: paternity leave](https://www.profamilyleave.msf.gov.sg/schemes/paternity-leave).

**Entitlement:**
- **4 weeks of mandatory Government-Paid Paternity Leave** where the child's birth date, expected delivery date or formal intent to adopt is **on or after 1 Apr 2025**.
- Before that date: 2 weeks, plus 2 more weeks if the employer agreed.

**Eligibility:**
- The child is a Singapore Citizen.
- The father is or was married to the mother between conception and birth, or within 12 months after.
- The father has 3 months of service.

**Pay:**
- 4 weeks × working days per week, capped at 6 days per week.
- The employer pays the gross rate. **The Government reimburses all 4 weeks**, capped at **$2,500 per week ($10,000 in total)**.

**Taking the leave:**
- By default, 4 continuous weeks within 16 weeks of the birth.
- By agreement, flexibly within 12 months.
- Notice: 4 weeks.

### 6.5 Shared Parental Leave (SPL)

Sources: [MOM: shared parental leave](https://www.mom.gov.sg/employment-practices/leave/shared-parental-leave) (updated 13 Aug 2026) and [MSF: shared parental leave](https://www.profamilyleave.msf.gov.sg/schemes/shared-parental-leave).

**Entitlement:**
- **6 weeks** for children born (or formally intended for adoption) between 1 Apr 2025 and 31 Mar 2026.
- **10 weeks** for those **on or after 1 Apr 2026**. MOM: "10 weeks of SPL for children born from 1 April 2026 onwards." If the expected delivery date was on or after 1 Apr 2026 but the child was born earlier, 10 weeks may still apply.
- The weeks are shared between the parents as they choose.

**Pay:** the employer pays and claims from the Government, capped at **$2,500 per week**.

**Taking the leave:**
- Maternity, paternity or adoption leave must be used first.
- By default, one continuous block within 26 weeks of the birth.
- By agreement, flexibly within 12 months.
- Notice: 4 weeks.
- Unused SPL is not encashed.

### 6.6 Childcare leave, extended childcare leave and unpaid infant care leave

Sources: [MOM: childcare leave](https://www.mom.gov.sg/employment-practices/leave/childcare-leave/eligibility-and-entitlement) (updated 24 Aug 2026), [MOM: pro-rated childcare leave](https://www.mom.gov.sg/employment-practices/leave/childcare-leave/pro-rated-childcare-leave) and [MOM: unpaid infant care leave](https://www.mom.gov.sg/employment-practices/leave/unpaid-infant-care-leave).

**Government-Paid Childcare Leave (GPCL)** (Singapore Citizen child under 7):
- **6 days a year per parent**, regardless of how many children; lifetime maximum 42 days per child.
- Requires 3 months of service.
- The employer pays days 1–3. **The Government reimburses days 4–6** at up to $500 a day, including CPF.
- **Pro-ration for new hires** (completed months → days): 3→2, 4→2, 5→3, 6→3, 7→4, 8→4, 9→5, 10→5, 11→6, 12→6. In effect this is round-half-up(6 × m/12), with a minimum of 2.

**Extended Childcare Leave** (youngest Singapore Citizen child aged 7–12):
- **2 days a year**, fully reimbursed at up to $500 a day.
- Not pro-rated.
- A parent can get at most 6 days a year across GPCL and extended childcare leave combined.

**EA childcare leave** (non-Singapore Citizen child under 7):
- 2 days a year, paid by the employer.
- Not pro-rated.

**Rules for all childcare leave:**
- No carry-forward and no encashment.
- The leave year is the calendar year by default.

**Unpaid Infant Care Leave:**
- **12 days a year per parent since 1 Jan 2024** (raised from 6); maximum 24 days per child.
- The child must be under 2 and a Singapore Citizen.
- Requires 3 months of service.

**Announced, but not yet effective** (2026 National Day Rally; [gov.sg](https://www.gov.sg/ndr2026/families/), [madeforfamilies.gov.sg](https://www.madeforfamilies.gov.sg/ndr-2026-supporting-families/), updated 29 Oct 2026):
- Childcare leave and extended childcare leave will merge into one scheme for children aged 12 and below: **8 days for 1 child, 10 days for 2 children, 12 days for 3 or more**.
- The Government will reimburse the **full duration** of maternity, adoption, paternity, shared parental and childcare leave for all child orders, up to a cap.
- **No effective date has been published.** Model this as a rule version with `effectiveFrom: null` and do not apply it.

### 6.7 Adoption, NS and compassionate leave

**Adoption leave (GPAL)** ([MOM: adoption leave](https://www.mom.gov.sg/employment-practices/leave/adoption-leave)):
- 12 weeks for the adoptive mother.
- The child must be under 12 months at the formal intent to adopt, and a Singapore Citizen (or become one).
- Requires 3 months of service.
- For the 1st and 2nd child, the employer pays weeks 1–4 and the Government reimburses weeks 5–12, capped at $20,000. For the 3rd child onward, all 12 weeks are reimbursed, capped at $30,000.

**NS (reservist) leave:**
- Under the Enlistment Act, employers **must grant leave** and keep NSmen in employment ([MINDEF](https://www.mindef.gov.sg/news-and-events/latest-releases/07feb23_pq/)).
- MINDEF pays make-up pay. Claims have been automated since H2 2022 using IRAS and CPF data. Under the DIRECT scheme, the employer keeps paying salary and is reimbursed.
- For CPF, contributions are computed on the employer's wages plus make-up pay (§1.7).
- MOM has no NS leave page. The DIRECT mechanics come from **secondary sources**.

**Compassionate, bereavement and marriage leave: not statutory.** MOM: "There is no statutory entitlement." Offer these as configurable company leave types.

### 6.8 Public holidays 2026 and 2027 (official MOM)

Sources: [MOM: public holidays](https://www.mom.gov.sg/employment-practices/public-holidays), the [2026 press release](https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026), the [2027 press release (18 Jun 2026)](https://www.mom.gov.sg/newsroom/press-releases/2026/0618-public-holidays-for-2027), and MOM's .ics files, which I cross-checked.

| 2026 | Day | Holiday | Notes |
|---|---|---|---|
| 1 Jan | Thu | New Year's Day | |
| 17–18 Feb | Tue–Wed | Chinese New Year | |
| 21 Mar | **Sat** | Hari Raya Puasa | no Monday substitute (non-working-day rule) |
| 3 Apr | Fri | Good Friday | |
| 1 May | Fri | Labour Day | |
| 27 May | Wed | Hari Raya Haji | |
| 31 May | Sun | Vesak Day | **Mon 1 Jun** observed |
| 9 Aug | Sun | National Day | **Mon 10 Aug** observed |
| 8 Nov | Sun | Deepavali | **Mon 9 Nov** observed |
| 25 Dec | Fri | Christmas Day | |

| 2027 | Day | Holiday | Notes |
|---|---|---|---|
| 1 Jan | Fri | New Year's Day | |
| 6 Feb | **Sat** | Chinese New Year | no substitute |
| 7 Feb | Sun | Chinese New Year | **Mon 8 Feb** observed ("Monday, 8 Feb 2027, will be a public holiday") |
| 10 Mar | Wed | Hari Raya Puasa | |
| 26 Mar | Fri | Good Friday | |
| 1 May | **Sat** | Labour Day | no substitute |
| 17 May | Mon | Hari Raya Haji | |
| 20 May | Thu | Vesak Day | |
| 9 Aug | Mon | National Day | |
| 28 Oct | Thu | Deepavali | |
| 25 Dec | **Sat** | Christmas Day | no substitute |

MOM's wording is that the Monday is a holiday "if your rest day falls on" the Sunday. For employees whose rest day is not Sunday, apply the general rest-day rule from §5.4 instead.

### 6.9 Implications for Crow HR (leave)

**Configure each leave type with:**
- its statutory basis;
- its unit (days or hours);
- which part the employer pays and which part the Government reimburses;
- caps per week, per day and lifetime per child;
- minimum service, notice period, and whether calendar days or working days are counted;
- whether it can be encashed or carried forward.

**Store a child registry:**
- date of birth or expected delivery date;
- citizenship and the date it was obtained;
- child order;
- adoption intent date;
- how SPL is split between the parents.

**Build a GPL reimbursement claim helper** that applies the week and day windows, the caps, and the 3-month claim deadline. Actual submission happens on the MSF GPL portal through Corppass; there is no public API (see §14).

**Effective-dated rules to support:**
- paternity leave 2+2 weeks, changing to 4 weeks from 1 Apr 2025;
- SPL 6 weeks, changing to 10 weeks from 1 Apr 2026;
- the 2026 National Day Rally changes, currently with no effective date.

## 7. Payslips, KETs and employment records

**Itemised payslips** ([MOM: itemised payslips](https://www.mom.gov.sg/employment-practices/salary/itemised-payslips)):
- Mandatory since 1 Apr 2016.
- Issue with the payment, or "within three working days of payment". On termination, issue with the final pay.
- Electronic payslips are allowed.

**Mandatory payslip fields:**
1. Employer's full name.
2. Employee's full name.
3. Date(s) of payment.
4. Basic salary. For hourly, daily or piece-rated staff, the rate and the number of units.
5. Start and end date of the salary period.
6. Allowances, fixed and ad hoc.
7. Other additional payments (bonus, rest-day pay, public-holiday pay).
8. Deductions, fixed (e.g. employee CPF) and ad hoc (e.g. no-pay leave).
9. Overtime hours.
10. Overtime pay.
11. Overtime period, if different from the salary period.
12. Net salary.

**Key Employment Terms (KETs)** ([MOM: key employment terms](https://www.mom.gov.sg/employment-practices/contract-of-service/key-employment-terms); [MOM: what is a contract of service](https://www.mom.gov.sg/employment-practices/contract-of-service/what-is-a-contract-of-service)):
- **Who gets them:** employees covered by the EA who started on or after 1 Apr 2016 and are employed for **14 days or more**. This is measured by contract length, not days worked, and includes part-timers.
- **When:** "Within 14 days after the start of employment". For example, an employee starting on 1 Jan must receive KETs by 15 Jan.
- **Format:** soft or hard copy. Soft copies should be printable.

**Mandatory KET fields:**
1. Employer's full name.
2. Employee's full name.
3. Job title and main duties.
4. Start date.
5. Duration of employment (fixed-term contracts only).
6. Working arrangements: daily hours, days per week, rest day.
7. Salary period.
8. Basic salary (or rate).
9. Fixed allowances.
10. Fixed deductions.
11. Overtime payment period.
12. Overtime rate.
13. Other salary components (bonus, incentives).
14. Types of leave.
15. Medical benefits.
16. Probation period.
17. Notice period.
18. Place of work (optional).

Items 11 and 12 may be omitted for employees who are not entitled to overtime.

**Employment records** ([MOM: employment records](https://www.mom.gov.sg/employment-practices/employment-records)):
- **Fields to keep:**
  - employee's address;
  - NRIC number, or for foreigners the work pass number and its expiry;
  - date of birth and gender;
  - start date and leaving date;
  - working hours, including breaks;
  - public holidays and leave taken.
- **Salary records** contain the same 12 items as the payslip.
- **Retention:** for current employees, the **latest 2 years**. For ex-employees, the last 2 years, **kept for 1 year after they leave**.
- Other regimes may require longer retention (IRAS and CPF); see §11 (PDPA retention).

**Implications for Crow HR:**
- Validate payslip completeness against the 12 fields before publishing.
- Alert if a payslip is issued more than 3 working days after payment.
- Track the KET due date (start date + 14 days) and keep KET versions.
- Never auto-purge records before the statutory minimum. Retention is configurable, with a conservative default.

---

## 8. Tax: IR8A, Appendix 8A/8B, IR8S, AIS, IR21

The primary sources are iras.gov.sg and file.go.gov.sg, all fetched in October 2026. Each source is cited inline.

### 8.1 Forms, year terminology, deadline

**Year of Assessment (YA).** Income earned in year N is assessed in YA N+1. IRAS gives the example "1 Jan 2026 to 31 Dec 2026 for YA 2027" ([IRAS: Join AIS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/join-the-auto-inclusion-scheme-(ais)-for-employment-income)).

**Legal basis.** The obligation is Income Tax Act s 68(2), renewed each year by gazette notice. The YA2027 notice is No. 4410 of 31 Jul 2026 ([PDF](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/s68(2)-gazette-ya-2027.pdf?sfvrsn=8acc440a_5)).

**Forms** (gazette para 11; [Explanatory Notes YA2027](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-form-ir8a-and-appendix-8a-for-ya2027.pdf?sfvrsn=7ae73f3a_5); [Appendix 8B notes](https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-appendix-8b-for-ya2027.pdf?sfvrsn=1630a9db_5)):
- **IR8A** reports remuneration.
- **Appendix 8A** reports benefits-in-kind.
- **Appendix 8B** reports gains from employee stock options (ESOP) and other share plans (ESOW).
- **Form IR8S has been discontinued with effect from YA2026** (Explanatory Notes item d6). Excess or voluntary employer CPF is now reported in IR8A item d6, net of refunds. This covers contributions:
  - above statutory rates;
  - on OW above $8,000 a month;
  - on AW above $102,000 minus OW;
  - for foreigners, or on director's fees.

  The [One-Stop Payroll FAQ](https://www.onestoppayroll.gov.sg/faq/) still mentions IR8S and looks stale. Primary sources do not say whether IR8S is still needed when amending YA2025 or earlier; flagged.

**Who must be reported:**
- full-time and part-time residents;
- non-residents, including overseas-based staff who served in Singapore;
- directors, including non-resident directors;
- board members who receive fees;
- pensioners;
- former employees who received income during the year, such as share gains.

**Who is excluded:**
- employees whose income was cleared through IR21;
- foreigners whose IR21 is filed before 1 Mar 2027;
- foreigners who worked wholly outside Singapore.

**Deadline: 1 March of the following year**, i.e. **1 Mar 2027** for income year 2026 (gazette para 7).

**Penalties:**
- Failing to file: a fine of up to $5,000, or up to 6 months' jail if the fine is unpaid (s 94).
- Filing incorrect information: a penalty of up to twice the tax undercharged, plus a fine (s 95).

**Copies to employees:**
- **Employers not in AIS** must give each employee a hardcopy IR8A by 1 Mar. It is not sent to IRAS.
  - A computer-printed IR8A needs no signature, but must show the authorised person's name, designation, contact number and date.
  - Exception: for SC/SPR employees who ceased employment or were posted overseas and have taxable ESOP/ESOW gains, Appendix 8B and the IR8A go to IRAS.
- **Employers in AIS** need not issue copies. If software prints a statement, it must carry the exact IRAS header text ([AIS technical specs page](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/technical-file-format-specifications)):

  > "This statement can only be issued by an employer in the Auto-Inclusion Scheme (AIS) and is for your retention. The information in this statement will be automatically included in your income tax return, so you need not declare them in your tax form. You can check if your employer is in the AIS at IRAS website, https://go.gov.sg/iras-ais-search."

**Edge cases** ([IRAS reporting page](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/reporting-employee-earnings-(ir8a-appendix-8a-appendix-8b))):
- Report the commencement date only if the employee joined during the year or before 1 Jan 1969.
- If the employee had several stints in the year, use the earliest start date and the latest end date.
- Select bank "Others" for employees paid by cash or cheque.
- ESOP gains are taxed on exercise. ESOW gains are taxed on grant, or on vesting where there is a vesting period. Where there is a selling moratorium, the gain is taxed when the moratorium is lifted.
- **Rounding** differs by channel. In the myTax screen and Excel template, income is **rounded down** to the dollar and deductions **rounded up**. The API accepts 2 decimal places.

### 8.2 Auto-Inclusion Scheme (AIS)

**Who must join for YA2027.** An employer must join if any of these apply:
- it had **5 or more employees** in 2026, counting leavers but excluding staff cleared through IR21;
- it received IRAS's notice;
- it is registered for AIS on 1 Mar 2027.

Sources: gazette paras 4–5; [IRAS Join AIS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/join-the-auto-inclusion-scheme-(ais)-for-employment-income).

- The 5-employee threshold has applied since YA2022.
- **Once registered, an employer stays in AIS** even if it later has fewer than 5 employees, and cannot file on paper.
- **No announcement making AIS mandatory for all employers was found.** The IRAS media release of 2 Feb 2026 says "regardless of workforce size", but only about employers already registered ([release](https://www.iras.gov.sg/news-events/newsroom/123-000-ais-employers-to-submit-employees--employment-income-data-by-1-mar-2026--enabling-iras-to-pre-fill-over-2-million-tax-returns)).
- Since 2026, employers can back-file up to 4 years and overwrite earlier submissions.
- **Inconsistency:** the AIS landing page says "registered on or before 1 Mar 2026", while the gazette and the Join page say 1 Mar 2027. The gazette is the legal instrument, so we treat 1 Mar 2027 as correct.

**Submission channels (current):**

1. **myTax Portal "Submit Employment Income Records" screen.** It takes manual entry or an import of the public **IR8A Import Template (XLSX)** ([go.gov.sg/ir8a-import-template](https://go.gov.sg/ir8a-import-template), which resolves to https://file.go.gov.sg/ir8a-import-template.xlsx).
   - The template has sheets IR8A, Appendix 8A (Accommodation), Appendix 8A (Hotel & Others), Appendix 8B and DropDownList.
   - Amounts are whole dollars; dates are YYYY-MM-DD.
   - A submission takes up to **200 records**.
   - Submitting needs the **Corppass e-service "Submission of Employment Income Records" with the Approver role** ([Corppass guide](https://www.iras.gov.sg/docs/default-source/uploadedfiles/pdf/corppass-authorisation-user-guide_employment-income.pdf?sfvrsn=61dfe5b5_24); [user guide](https://www.iras.gov.sg/docs/default-source/uploadedfiles/submit-employment-income-records-digital-service-user-guide.pdf?sfvrsn=ebc66009_10)).
   - **Data Link-up Service:** IRAS pre-fills CPF wages and MOM particulars. New registrants have been auto-enrolled since 15 Sep 2025. Data is pulled only if CPF was e-submitted and paid by 14 Jan, and only for a PTE CSN ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/sign-up-for-ais-data-link-up-service)).
2. **AIS-API 2.0 on GovTech APEX.** The current spec is v2.6 of 11 Sep 2026 ([spec PDF](https://file.go.gov.sg/aisapi2-specs.pdf); [data items XLSX](https://file.go.gov.sg/aisapi2-dataitems.xlsx); [OAuth spec](https://file.go.gov.sg/oauth-specs.pdf)). All three are publicly downloadable.
   - **Payload:** JSON, up to 2,000 records and 8 MB per call, 3,000 requests per hour per app.
   - **Authentication:**
     - header `x-apex-apikey`;
     - a Corppass bearer token with scope `EmpIncomeSub`;
     - OAuth 2.1 with PKCE;
     - a public EC P-256 JWKS endpoint and a signed client-assertion JWT;
     - exact-match HTTPS redirect URIs on a domain name;
     - **server-to-server calls from whitelisted IPs**.
   - **Payload fields** include `validateOnly`, `softwareCompanyName` and `softwareName`.
   - "Onboarding and usage of the AIS-API 2.0 Production API requires approval by IRAS."
   - **Registration:** an interest form ([go.gov.sg/aisreginterest](https://go.gov.sg/aisreginterest)) must be submitted by 30 Sep. It covers both vendors and employers with in-house systems.
   - **Vendor listing** ([IRAS](https://www.iras.gov.sg/digital-collaboration/for-software-developers/payroll-software/how-to-support-ais-submission-as-a-vendor)) requires the vendor to be the software's developer and to pass an **annual validation test**: a checklist plus sandbox acknowledgement numbers, due by 30 Nov. Listing is "not an endorsement", and no other certification exists.
   - Records submitted via the API are not visible in myTax Portal.
3. **No legacy text or XML IR8A upload format exists on current IRAS pages.** The retirement date could not be confirmed.

**The IRAS API Marketplace (apiservices.iras.gov.sg) shuts on 22 Dec 2026.** Build only against APEX.

### 8.3 IR21 tax clearance

Source: [IRAS IR21](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/tax-clearance-for-employees).

**When it applies.** IR21 is required for **non-Singapore-Citizen** employees, including SPRs leaving permanently and all pass types (including ONE Pass and PEP), who:
- cease employment;
- are posted overseas; or
- leave Singapore for more than 3 months.

**Filing and withholding:**
- File **at least 1 month before** the cessation date.
- **Withhold all monies** from the date the employer becomes aware. On resignation, start immediately regardless of the notice period. On garden leave, start when it begins.
- The employer may not build up a reserve by deducting part of the monthly salary.
- **Late filing:** there is generally a 10-day grace period. After that, a fine or composition of up to $5,000 per offence ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/late-filing-or-non-filing-of-tax-clearance)).
- The tax in the IRAS Directive must be paid **within 10 days**. GIRO is not allowed ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/when-to-pay-clearance-tax)).
- Processing takes about 21 days.
- Income paid after filing goes on an additional or amended IR21, not an IR8A.

**IR21 is not required for** ([IRAS summary of scenarios](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/tax-clearance-for-employees/summary-of-scenarios-where-tax-clearance-is-not-required)):
- Singapore Citizens.
- SPRs not leaving permanently who have a Letter of Undertaking. This does not cover overseas postings unless the 6-month conditions are met.
- Former work pass holders who are now SPRs.
- Non-Singapore-Citizens who had no other Singapore employer in the cessation year or the year before, and who either:
  - worked **60 days or less** in the year (not directors, entertainers or professionals); or
  - worked **183 days or more** and earned **under $21,000**.
- Group transfers notified through myTax Mail with the waiver template.
- Absences of 3–6 months, or overseas postings of up to 6 months, where the employee returns to the same employer, keeps the pass and stays on payroll.

There is no separate Work Permit exemption on current pages. Low earners fall under the $21,000 scenarios.

**Channels:**
- myTax e-File with Excel appendices 1–3, or paper ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-foreign-spr-employees-(ir21)/filing-tax-clearance)).
- An **IR21 API exists under #SFFS**. Access is via the IRAS API Interest Form ([form.gov.sg](https://form.gov.sg/688f1e7a816baa9521b13002)), and **the spec is not public** ([IRAS](https://www.iras.gov.sg/digital-collaboration/for-software-developers/payroll-software/seamlessfilingfromsoftware-(-sffs)-for-tax-clearance-(ir21))).

### 8.4 What a self-hosted, open-source Crow HR can and cannot do

| Capability | Without approval? | Notes |
|---|---|---|
| Compute IR8A / 8A / 8B figures per employee per YA | **Yes** | Pure computation from payroll data. |
| Printable IR8A / 8A / 8B for non-AIS employers (incl. AIS statement header) | **Yes** | |
| Generate a filled **IR8A Import Template XLSX** (chunked at 200 records, IRAS rounding) for the employer to upload in myTax Portal | **Yes** | The template is public, but its redistribution licence is unconfirmed. **Fetch it at runtime / link to it, don't vendor it into the MIT repo.** IRAS PDFs say "No part of this publication may be reproduced…". |
| Validate data against the public AIS-API data-items workbook; preview the API JSON | **Yes** | |
| **Submit directly to IRAS via AIS-API 2.0** | **No** | Needs: Corppass for the software developer; an APEX app, API key, OAuth client, public JWKS and a domain-name HTTPS redirect URI; whitelisted server IPs; the interest form by 30 Sep; sandbox testing; IRAS production approval; and (for vendor listing) the annual validation test. **Path A:** a Crow Tech legal entity onboards as the vendor and runs a hosted relay that holds the keys. **Path B:** each employer onboards its own instance as an "in-house payroll system". Secrets can never ship in the open-source code. |
| IR21 data pack for manual e-filing; withholding hold; 10-day directive tracker | **Yes** | |
| IR21 via API | **No** | Non-public spec plus IRAS onboarding. |

### 8.5 Implications for Crow HR

- Key tax data by YA, with the income year shown.
- Don't build IR8S. Report excess CPF in IR8A d6.
- Exclude employees cleared through IR21 from IR8A.
- AIS threshold check: warn when the organisation has had 5 or more employees in the year. Record an `isAisRegistered` flag; once true, it never auto-reverts.
- IR21:
  - A trigger engine for resignation or termination of a non-SC, overseas posting, or absence over 3 months.
  - An exemption check (the scenarios in §8.3, including the Letter of Undertaking).
  - An **automatic "withhold all monies" payroll hold** from the awareness date.
  - A reminder to file at least 1 month before cessation.
  - Tracking of the directive and its 10-day payment.
- Document AIS API and IR21 API submission as **NOT IMPLEMENTED / requires onboarding** in `docs/limitations.md`.

---

## 9. CPF submission (CPF EZPay)

### Deadlines and late payment

- Contributions are **due by the last day of the month** for that month's wages.
- Enforcement begins if they are not paid by the **14th of the following month**, or the next working day ([CPF enforcement](https://www.cpf.gov.sg/employer/compliance-and-rectifications/enforcement-and-penalties-for-non-compliance)).
- **Late-payment interest is 1.5% per month (18% p.a.) from the day after the due date, with a minimum of $5** ([CPF](https://www.cpf.gov.sg/employer/compliance-and-rectifications/enforcement-and-penalties-for-non-compliance); [MOM](https://www.mom.gov.sg/employment-practices/central-provident-fund/employers-contributions)).
  - The day-based formula, principal × 1.5% × days late ÷ days in month (rounded down to the dollar), comes from a **secondary** search snippet. CPF FAQ pages render via JavaScript and could not be read.
- **Composition** is up to $1,000 per offence (per employee-month).
- **On conviction:**
  - first offence: $1,000–$5,000 and/or 6 months;
  - repeat offence: $2,000–$10,000 and/or 12 months;
  - deducting the employee share without paying it: up to $10,000 and/or 7 years.

### CPF Submission Number (CSN)

- The CSN is UEN (or NRIC/FIN) + payment type + serial number, e.g. `234567891APTE01`.
- Payment types are PTE (mandatory), AMS, VCT and MSE. Each needs its own CSN.
- Corppass e-services:
  - "CPF Services for Employers and Business Partners", to apply;
  - "CPF EZPay", to submit.
- Source: [CPF](https://www.cpf.gov.sg/employer/making-cpf-contributions/applying-for-a-cpf-submission-number).

### Ways to submit

Source: [CPF](https://www.cpf.gov.sg/employer/making-cpf-contributions/submitting-cpf-contributions-via-cpf-ezpay).

- CPF EZPay online entry, or EZPay standing instruction.
- **EZPay "FTP"**, which is a **file upload inside the EZPay web app** (not an actual FTP server).
- Payment is by eGIRO direct debit or PayNow QR.
- **The FTP mode does not auto-compute CPF or SDL**, so the file must carry the computed amounts.

### The file format is public

**[CPF EZPay (FTP) File Specifications, effective 16 Jan 2025](https://www.cpf.gov.sg/content/dam/web/employer/making-cpf-contributions/documents/CPFEZPayFTPSpecifications.pdf)** (verified 31 Oct 2026).

**Layout:**
- The filename is `<CSN><MonthPaid><AdviceCode>.DTL` (.dtl, .dat or .txt).
- Records are fixed-length, **150 bytes**: a header, summary records (type 0) per payment code, detail records (type 1), and a trailer (type 9) carrying the record count and total amount.
- **Payment codes:** 01 CPF, 02 MBMF, 03 SINDA, 04 CDAC, 05 ECF, 07 penalty interest, 10 Community Chest (SHARE), 11 SDL.
- Detail records exist only for codes 01–05.

**Detail record fields:**
- relevant month (YYYYMM);
- payment code;
- employee CPF account number (9 characters, starting **S or T**, with check digit);
- contribution amount, 9(10)V99;
- OW and AW, each 9(8)V99;
- **employment status**: E existing, L leaver, N new joiner, O joins and leaves in the same month;
- employee name as on the NRIC (66 characters).

**Constraints:**
- No negative amounts.
- These characters are forbidden: ``_+$<>:;?!=[]`^|\"~``.
- Unused numeric fields are zero-padded.

**Ambiguity:** detail records require an S/T account number. The spec does not say how to report **MBMF for foreign Muslim employees or SINDA for EP holders**, who have F/G/M FINs. EZPay states that foreigners' SDL is keyed in manually; their SHG is probably the same. Flagged; ask CPF.

**Sample data.** The spec's sample file (2018 data) shows MBMF $19.50 on OW $4,000, but the published MBMF table gives $15.00 for "> $3,000 to $4,000". The sample is illustrative only. Do not use it as a test vector.

### CPF Contributions API

- An API exists under **One-Stop Payroll on APEX**, but **the spec is not public**. It can only be downloaded inside APEX after onboarding.
- Onboarding: Corppass + APEX app, then email one_stop_payroll@iras.gov.sg for sandbox access, then production testing and authorisation.
- Sources: [OSP FAQ](https://www.onestoppayroll.gov.sg/faq/); [OSP onboarding](https://www.onestoppayroll.gov.sg/partner-with-us/software-developer/onboarding-steps/).

### Implications for Crow HR

- **Generate and validate the .DTL file** per CSN per month:
  - CPF, SHG and SDL summary and detail records;
  - E/L/N/O status derived from join and leave dates;
  - sanitised names;
  - trailer totals.
- **Store** the CSN(s) per organisation and the advice code.
- **Show** the deadline (14th) and estimated late interest.
- The employer uploads the file in EZPay. Direct API submission is NOT IMPLEMENTED and needs OSP onboarding (vendor or each employer).

---

## 10. Work passes

### 10.1 Employment Pass (EP)

**Two-stage test.** A candidate must (1) earn at least the EP qualifying salary and (2) pass COMPASS, unless exempt. Employers must still meet the Fair Consideration Framework job-advertising requirement for new applications ([EP eligibility](https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility)).

**Qualifying salary.** The salary rises with age. Full age-by-age tables are in the JSON (`sg-rule-tables.json` → `workPasses`).

| Sector | Current (new applications from 1 Jan 2025; renewals of passes expiring from 1 Jan 2026) | New applications from **1 Jan 2027**; renewals of passes expiring from **1 Jan 2028** |
|---|---|---|
| All except financial services | $5,600 (≤23) rising to $10,700 (≥45) | $6,000 rising to $11,500 |
| Financial services | $6,200 rising to $11,800 | $6,600 rising to $12,700 |

Sources: [EP eligibility](https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility); effective dates from the [COS 2025 factsheet](https://www.mom.gov.sg/-/media/mom/documents/budget2025/cos-2025-factsheet-on-foreign-workforce-policies.pdf) para 3 and the [COS 2026 factsheet](https://www.mom.gov.sg/-/media/mom/documents/press-releases/2026/factsheet-on-foreign-workforce-policies-03032026.pdf) Annex B.

**Older candidates.** The higher bar for older candidates is the age progression. Each year of age above 23 adds about $232 (non-FS, current) up to age 45 (MOM age table).

**COMPASS: what to record** ([EP eligibility](https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility)):
- **Pass mark:** 40 points.
- **C1 Salary** (vs sector PMET benchmarks): 0, 10 or 20 points.
- **C2 Qualifications:** 0, 10 or 20 points.
- **C3 Diversity:** 0, 10 or 20 points. Firms with fewer than 25 PMETs get 10 points by default.
- **C4 Support for local employment:** 0, 10 or 20 points. Firms with fewer than 25 PMETs get 10 points by default.
- **C5 Skills bonus (Shortage Occupation List):** 10 or 20 points.
- **C6 Strategic Economic Priorities bonus:** 10 points.
- **Exemptions:** fixed monthly salary of at least **$22,500**; overseas intra-corporate transferees; roles of 1 month or less.
- **Where COMPASS applies:** to renewals of EPs expiring from 1 Sep 2024 ([Renew an EP](https://www.mom.gov.sg/passes-and-permits/employment-pass/renew-a-pass)).
- **SOL restriction:** candidates who needed C5 points to pass are tied to the specific shortage occupation. Redeployment needs MOM reassessment.

**Duration.** Up to 2 years for first-time passes and up to 3 years on renewal. A 5-year pass is available for some shortage tech roles ([EP key facts](https://www.mom.gov.sg/passes-and-permits/employment-pass/key-facts)).

**Renewal** ([Renew an EP](https://www.mom.gov.sg/passes-and-permits/employment-pass/renew-a-pass), 17 Aug 2026):
- Apply from **6 months (180 days) before expiry**, and before the expiry date. EP (Sponsorship) renewals open 3 months before.
- If the deadline is missed, a new application is needed.
- Up to 6 months of remaining validity is added to the renewed pass.
- The IPA is valid for 3 months.

### 10.2 S Pass

**Qualifying salary.** Full tables are in the JSON (`sg-rule-tables.json` → `workPasses`).

| Sector | Current (new applications from 1 Sep 2025; renewals of passes expiring from 1 Sep 2026) | New applications from **1 Jan 2027**; renewals of passes expiring from **1 Jan 2028** |
|---|---|---|
| All except financial services | $3,300 (≤23) rising to $4,800 (≥45) | $3,600 rising to $5,100 |
| Financial services | $3,800 rising to $5,650 | $4,000 rising to $5,650 |

Sources: [S Pass eligibility](https://www.mom.gov.sg/passes-and-permits/s-pass/eligibility) (1 Sep 2026); [COS 2025 factsheet](https://www.mom.gov.sg/-/media/mom/documents/budget2025/cos-2025-factsheet-on-foreign-workforce-policies.pdf) para 6; [COS 2026 factsheet](https://www.mom.gov.sg/-/media/mom/documents/press-releases/2026/factsheet-on-foreign-workforce-policies-03032026.pdf) Annex B.

**AMBIGUOUS (stale secondary snippet).** A web-search summary described an older MOM FAQ as saying that renewals of passes expiring from 1 Sep 2025 still used $3,150. That would conflict with the COS 2025 date of 1 Sep 2026 for renewals. I did not open that FAQ ([MOM FAQ](https://www.mom.gov.sg/faq/s-pass/when-will-the-changes-in-s-pass-qualifying-salary-apply-to-new-applications-and-renewals)). I treat the COS factsheets and the eligibility page as authoritative.

**Other S Pass facts:**
- Duration up to 2 years first time and up to 3 years on renewal, capped at 1 month before passport expiry ([S Pass key facts](https://www.mom.gov.sg/passes-and-permits/s-pass/key-facts)).
- Employers **must** provide medical insurance.
- Renewal opens **6 months (180 days) before expiry** ([Renew an S Pass](https://www.mom.gov.sg/passes-and-permits/s-pass/renew-a-pass)).
- Renewal needs at least 7 months' passport validity and enough quota. The IPA is valid for 60 days.

### 10.3 Work Permit (migrant worker)

**Sectors:** construction, manufacturing, marine shipyard, process and services. There is **no minimum qualifying salary** ([WP key facts](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/key-facts)).

**Duration:** up to 2 years, depending on passport, security bond and employment period. A 2-year permit needs at least 25 months of passport validity ([Renew a WP](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/renew-a-work-permit)).

**Source countries:**
- Services: Malaysia, PRC and NAS (Hong Kong, Macau, South Korea, Taiwan), plus NTS for NTS Occupation List roles ([Services](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements)).
- NTS was expanded to Bhutan, Cambodia and Laos from 1 Jun 2025 ([COS 2025 factsheet](https://www.mom.gov.sg/-/media/mom/documents/budget2025/cos-2025-factsheet-on-foreign-workforce-policies.pdf)).

**Maximum period of employment (POE) and age limits.**
- **From 1 Jul 2025**, MOM lifted the maximum POE (previously 14 to 26 years) and pegged the maximum employment age to the retirement age ([COS 2025 factsheet](https://www.mom.gov.sg/-/media/mom/documents/budget2025/cos-2025-factsheet-on-foreign-workforce-policies.pdf) paras 13–14).
- The retirement age has been **64 since 1 Jul 2026** ([MOM retirement](https://www.mom.gov.sg/employment-practices/retirement)).
- The Services page now says applications are for ages 18 to 62, and holders "can work until they reach the maximum age of 64".
- **AMBIGUOUS:** WP key facts says "below 62 years old when applying", while the Services page says "Maximum: 62". The difference is between "below 62" and "62 inclusive".

**Renewal:** renew **7 to 12 weeks before expiry** ([Renew a WP](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/renew-a-work-permit)).

### 10.4 Dependant's Pass, LTVP and Letter of Consent (LOC)

**Dependant's Pass (DP).** For EP or S Pass holders earning a fixed monthly salary of at least **$6,000** ([DP eligibility](https://www.mom.gov.sg/passes-and-permits/dependants-pass/eligibility)).

**MOM-issued LTVP.** Common-law spouse, step-children and handicapped children qualify. Parents qualify only if the pass holder earns over $12,000 ([LTVP](https://www.mom.gov.sg/passes-and-permits/long-term-visit-pass)).

**DP holders who want to work** ([DP working in Singapore](https://www.mom.gov.sg/passes-and-permits/dependants-pass/working-in-singapore), 25 Mar 2026):
- The employer must apply for an **EP, S Pass or DP-Work Permit**. DP-WP has no minimum salary, is tied to the DP's validity, and is subject to WP quota and levy at the lowest sector rate.
- The **LOC for DP holders survives only for business owners** ([LOC for DP business owners](https://www.mom.gov.sg/passes-and-permits/loc-for-dependants-pass-business-owners)).
- **UNVERIFIED:** I recall that DP holders lost general LOC access from 1 May 2021. The current MOM pages do not state that date.

**MOM-issued LTVP holders** need an EP, S Pass or WP to work ([LTVP working](https://www.mom.gov.sg/passes-and-permits/long-term-visit-pass/working-in-singapore-for-ltvp-holders)).

**ICA-issued LTVP/LTVP+ holders** (spouses and unmarried children under 21 of Singaporeans or PRs) can still work on an **LOC** applied for by the employer, or on a **Pre-approved LOC (PLOC)** offered with the LTVP application ([LOC for ICA LTVP](https://www.mom.gov.sg/passes-and-permits/loc-for-ica-issued-ltvp-holders/eligibility); [Work passes for ICA LTVP holders](https://www.mom.gov.sg/passes-and-permits/work-passes-for-holders-of-long-term-visit-passes-issued-by-ica)):
- These holders are "not affected by the changes to the work arrangements of Dependant's Pass holders".
- No levy or quota.
- The LOC lapses when the LTVP ends or the job ends, and the employer must still cancel it.

**So, is the LOC abolished?** No. It is restricted: DP business owners, plus ICA LTVP/LTVP+ holders. ONE Pass spouses can also work on an LOC ([ONE key facts](https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/key-facts)).

### 10.5 PEP, ONE Pass and TEP

**Personalised Employment Pass (PEP)** ([PEP eligibility](https://www.mom.gov.sg/passes-and-permits/personalised-employment-pass/eligibility)):
- Fixed monthly salary of at least **$22,500**.
- To keep the pass, the holder needs a fixed salary of at least **$270,000 per calendar year**, or $144,000 if they applied before 1 Sep 2023.
- Up to 3 years and **not renewable**. It is not employer-specific.
- The holder can stay unemployed for up to 6 months.
- No levy or quota.

**Overseas Networks & Expertise (ONE) Pass** ([ONE eligibility](https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/eligibility), 14 Sep 2026):
- Fixed monthly salary of at least **S$30,000** over the last 12 months, or with a prospective established Singapore employer. An "outstanding achievements" route also exists.
- **AI & Tech track from 28 Jan 2027:** at least S$30,000 a month total, of which fixed salary is at least S$22,500 and the rest may be vested ESOP/ESOW.
- Up to 5 years, renewable.
- Exempt from COMPASS and the FCF; the holder can work for multiple companies.

**Training Employment Pass (TEP)** ([TEP eligibility](https://www.mom.gov.sg/passes-and-permits/training-employment-pass/eligibility)):
- Fixed monthly salary of at least **$3,000**. A foreign student may qualify through an acceptable institution instead.
- Up to 3 months, **not renewable**, no levy.

### 10.6 Salary obligations tied to the work pass

**When to pay.** Pay at least the fixed monthly salary due within **7 days** after the end of the salary period. The salary period may not exceed 1 month.
- WP: [4th Sch. Pt III para 3](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)
- S Pass: [5th Sch. Pt I para 1](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)
- EP: [6th Sch. Pt I para 2](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)

**Declared salary is the floor.**
- **WP:** pay at least "the amount declared as the fixed monthly salary in the work pass application", or the last revised amount, "regardless of whether there is actual work" (except no-pay leave outside Singapore) ([4th Sch. Pt III para 4](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)).
- **"Fixed monthly salary"** means basic salary plus fixed monthly allowances (para 4A). MOM: "You must pay your foreign worker the monthly salary that you declare to us" ([Paying the salary](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/paying-the-salary)).
- **WP reductions:** cutting basic salary, fixed allowances, OT rate or daily rate below the declared amount, or raising fixed deductions above the declared amount, needs the **worker's prior written agreement**. The employer must also **inform the Controller in writing before** making the change ([4th Sch. Pt IV para 6A](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)).
- **EP and S Pass reductions:** before reducing below the declared fixed monthly salary, the employer must submit a request for **reassessment**. If the holder would no longer qualify, the reduction cannot be made without a new appropriate pass.
  - Regulations: [6th Sch. Pt II paras 2–3A](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012) (EP); [5th Sch. Pt II paras 12–13A](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012) (S Pass).
  - MOM: "you must notify us if you lower or raise a pass holder's salary". Submit a lowering request **at least 1 month before** the date. For a raise, "You don't need to inform us immediately unless you are applying for dependant privileges. Instead, you can indicate the change in salary when you renew". A salary drop below the DP/LTVP threshold leads to revocation of those passes ([EP notify MOM](https://www.mom.gov.sg/passes-and-permits/employment-pass/notify-mom-of-changes); [S Pass notify MOM](https://www.mom.gov.sg/passes-and-permits/s-pass/notify-mom-of-changes)).

**Electronic or GIRO payment of salary.**
- **S Pass: mandatory by regulation.** "The employer shall pay the wages of the foreign employee through General Interbank Recurring Order (GIRO) or by such other means as may be approved by the Controller in writing". The exceptions are passes of 3 months or less, last-month salary, overtime pay, and a written exemption ([5th Sch. Pt II para 5](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)).
- **WP (non-domestic): regulation.** Pay by direct transfer to a Singapore bank account **if the foreign employee so requests** ([4th Sch. Pt IV para 5](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)).
- **WP: MOM page.** It goes further: "You must pay the salary by crediting the wages directly into the worker's bank account **if they stay in dormitories**. If your workers do not stay in dormitories, you can pay the salary by cash" ([Paying the salary](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/paying-the-salary), 14 Mar 2024). **AMBIGUOUS:** I did not find the dormitory rule in the Work Passes Regs text I reviewed. It may come from another instrument, such as dormitory or licence conditions.
- **EP:** no GIRO condition found in the 6th Schedule.

**Salary records.** Keep a record of the monthly salary paid and produce it on request:
- WP: [4th Sch. Pt IV para 6](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)
- S Pass: [5th Sch. Pt II para 4](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)

**No CPF for foreign workers** ([Paying the salary](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/paying-the-salary)).

### 10.7 Cancellation and notification timelines

**Cancellation.**
- Cancel EP, S Pass and WP **within 1 week after the last day of notice**, or within 1 week of permanent departure.
- An advance request up to **14 days** ahead is allowed for EP and S Pass.
- Cancellation is not needed if the holder becomes a PR or the pass has expired. A Short-Term Visit Pass or Special Pass is needed if the person stays on.
- Sources: [EP cancel](https://www.mom.gov.sg/passes-and-permits/employment-pass/cancel-a-pass); [S Pass cancel](https://www.mom.gov.sg/passes-and-permits/s-pass/cancel-a-pass); [WP cancel](https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/cancel-a-work-permit).
- The regulations also require the employer to "inform the Controller in writing **within 7 days** after such cessation of employment" ([6th Sch. Pt II para 7](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012); 4th Sch. Pt IV para 12).

**Before cancelling** (same pages):
- Seek IRAS tax clearance **at least 1 month** before the last day.
- Settle salary.
- Buy the repatriation ticket. For WP, the departure must be within 14 days of cancellation.

**Other notifications:**
- **Missing worker:** inform MOM within 7 days (WP and S Pass regulations). For EP, make a police report and cancel within 1 week ([EP notify](https://www.mom.gov.sg/passes-and-permits/employment-pass/notify-mom-of-changes)).
- **Death:** inform MOM within **12 hours** ([5th Sch. Pt II para 11](https://sso.agc.gov.sg/SL/EFMA1990-S569-2012)).
- **Address or mobile change:** within **5 days** (EP holder or employer) ([EP notify](https://www.mom.gov.sg/passes-and-permits/employment-pass/notify-mom-of-changes)).
- **Occupation change:** EP employers submit a request, and the outcome takes about 3 weeks (same page).

### 10.8 Implications for Crow HR: data model and workflows

**Data model.** A `work_pass` record, effective-dated, with many per employee:
- **Identity and type:**
  - `pass_type`: EP, EP_SPONSORSHIP, S_PASS, WP, DP_WP, TWP, PEP, ONE, TEP, LOC, PLOC, DP, LTVP, OTHER.
  - `fin`: treat as a national ID number under the PDPA (§11.1). Validate the format, but don't hard-code prefixes.
  - `work_permit_no` or pass card serial, if the user enters it. Treat it as a national ID number too.
  - `application_no` or `ipa_ref`.
- **Dates:** `ipa_date`, `ipa_expiry`, `issue_date`, `expiry_date`, `cancellation_date`, `cancellation_reason`.
- **What was declared to MOM:**
  - `employer_uen` and the CPF submission number used for the quota.
  - `occupation` as declared (MOM standard occupation list).
  - `declared_basic_monthly_cents`, `declared_fixed_allowances_cents`, and their sum `declared_fixed_monthly_cents`.
  - `declared_fixed_deductions_cents` (WP).
  - `declared_ot_rate` and `declared_daily_rate` (WP).
- **Levy and quota fields:**
  - `mom_sector`.
  - `skill_level`: R1, R2 or UNSKILLED.
  - `source_group`: MYS_NAS_PRC, NTS or OFFSITE.
  - `nts_occupation_list` flag.
  - `levy_tier`, as billed.
  - `security_bond_ref` and expiry (non-Malaysian WP).
  - `medical_insurance` policy and expiry (WP and S Pass).
  - `pcp` flag for the Primary Care Plan.
- **COMPASS (EP):**
  - `compass_score`, plus `c1`–`c4`, `c5`, `c6` points.
  - `compass_exempt_reason`: SALARY_GE_22500, ICT or SHORT_TERM.
  - `sol_dependent` flag, which drives the redeployment warning.
- **Other:** `dependants` linked passes (DP/LTVP); `passport_no` (masked) and `passport_expiry`.

**Workflows:**
- **Renewal alerts:**
  - EP and S Pass: open 180 days before expiry, with escalation at 90, 60 and 30 days.
  - WP: open at 12 weeks, deadline 7 weeks.
  - Passport validity: S Pass renewal needs at least 7 months; a 2-year WP needs at least 25 months.
  - Upcoming qualifying-salary changes: from 1 Jan 2028, **renewals** use the new EP and S Pass tables. Flag holders whose `declared_fixed_monthly_cents` is below the 2027/28 table for their age at renewal.
- **Salary-change guard:**
  - If a proposed fixed salary is below the declared amount for EP or S Pass, block payroll effectivity until "MOM reassessment approved" is recorded. Suggest filing at least 1 month ahead.
  - For WP, require the worker's written-consent attachment and a "Controller informed" date.
  - If the new salary falls below $6,000 or $12,000, warn about DP/LTVP revocation.
  - If it falls below the age-graded qualifying salary, warn that the pass may no longer qualify.
- **Payroll checks:**
  - Paid fixed monthly salary must be at least the declared amount.
  - Pay date must be within 7 days of period end; the period must not exceed 1 month.
  - S Pass pay method must be GIRO or bank transfer unless an exception flag is set.
  - WP pay method: bank transfer if the worker requested it or lives in a dormitory.
- **Offboarding checklist:**
  - Cancel the pass within 1 week (advance up to 14 days for EP and S Pass).
  - File IR21 tax clearance at least 1 month before the last day.
  - Inform MOM within 7 days, book repatriation, and end the levy estimate the day before cancellation.


## 11. PDPA

### 11.1 NRIC and other national ID numbers: the Advisory Guidelines

**Source:** Advisory Guidelines on the PDPA for NRIC and other National Identification Numbers, issued 31 Aug 2018 ([PDPC page](https://www.pdpc.gov.sg/organisations/regulations-decisions/regulatory-guidance/advisory-guidelines-on-the-personal-data-protection-act-for-nric-and-other-national-identification-numbers); [PDF](https://www.pdpc.gov.sg/assets/cc9c647a-465f-4fbb-8bc2-5efa0bbe7ed2)).

**Effective date.** PDPC applies Part II "from **1 September 2019**" (para 6.1). Since 14 Dec 2024, a banner says the guidelines "will be updated. In the meantime, these guidelines remain valid."

**Scope:**
- Organisations are "generally not allowed" to collect, use or disclose NRIC numbers or copies (para 1.4).
- The same treatment applies to **Birth Certificate numbers, FINs and Work Permit numbers** (para 1.4).
- **Passport numbers** should get similar treatment. If they must be collected, limit collection to **partial** numbers and secure them (para 1.5).

**When collection is allowed** (para 3.1):
1. It is **required under the law**, or a PDPA exception applies.
2. It is necessary to establish or verify identity "to a high degree of fidelity".

**Employment is covered.** Example 3.9: under **Employment Act s.95**, employers must keep employment records that include NRIC numbers. So an employer "may obtain Benny's NRIC number where it is required for compliance with the Employment Act". But "There is no requirement under the law to ask for NRIC numbers for the purpose of **job applications**."

**Physical NRIC.** Organisations "should generally not retain an individual's physical NRIC unless … required under the law" (para 4.1). This also applies to work passes, passports and driving licences (para 1.6).

**Higher security expected for NRIC data** (para 2.4).

**Retention:** don't keep NRICs "just in case" (para 2.5).

**Partial NRIC** (para 5.2). Collecting up to the last 3 digits plus the checksum (e.g. "567A") is not treated as collecting the full NRIC. It is still personal data (para 5.3).

**Masking (government position).** MDDI, 13 Dec 2024: "there is no need to mask the NRIC number, nor is there much value in doing so … public agencies are phasing out the use of masked NRIC numbers" ([MDDI statement](https://www.mddi.gov.sg/newsroom/mddi-reply-disclosure-of-nric-number-on-bizfile-system)). **Note:** this is not a PDPC rule change. The 2018 guidelines still say the full NRIC deserves heightened protection. Masking is no longer *relied on* as a safeguard, but minimising display remains good practice for the Protection obligation (my inference).

**NRIC must not be used for authentication. This is a dated obligation.**
- **14 Dec 2024:** PDPC advised against NRIC numbers as passwords, for authentication, or as default passwords ([PDPC reply to media](https://www.pdpc.gov.sg/media-events/pdpcs-reply-to-media-queries-on-the-use-of-nric-numbers)).
- **26 Jun 2025, updated 7 May 2026:** PDPC and CSA joint advisory ([joint advisory](https://www.pdpc.gov.sg/media-events/joint-advisory-against-using-nric-numbers-for-authentication-by-the-personal-data-protection-commission-pdpc-and-cyber-security-agency-of-singapore-csa)).
  - Organisations "should not set NRIC numbers as default passwords, nor should they use full or partial NRIC numbers together with other easily obtainable personal data for authentication (e.g., passwords combining an individual's partial NRIC number and date of birth, such as '567A01Jan80')".
  - Footnote 1 example: "password-protected files sent via e-mail".
- **2 Feb 2026 press release:** "Private organisations will have until **31 December 2026** to phase out the use of NRIC numbers for authentication. From **1 January 2027**, the PDPC will step up enforcement … including imposing directions or financial penalties" ([PDPC media release](https://www.pdpc.gov.sg/media-events/organisations-to-cease-the-use-of-nric-numbers-for-authentication-by-31-december-2026)). Using NRIC numbers this way may breach the Protection obligation.
- **This hits a common SG payroll practice head-on:** emailing payslip or IR8A PDFs protected with NRIC plus date of birth.

### 11.2 Core obligations, with the timelines that matter for HR

**Employee data: consent and notification.**
- Consent is not needed where collection, use or disclosure "is reasonable for the purpose of … entering into an employment relationship … or managing or terminating the employment relationship" ([PDPA First Sch. Pt 3 para 10](https://sso.agc.gov.sg/Act/PDPA2012)).
- The organisation **must still notify** the purpose "on or before" collecting ([PDPA s.20(4)–(5)](https://sso.agc.gov.sg/Act/PDPA2012)).
- Collection must be for purposes a reasonable person would consider appropriate ([s.18](https://sso.agc.gov.sg/Act/PDPA2012)).

**Access (s.21).**
- Provide the personal data, plus information on how it "has been or may have been used or disclosed … **within a year** before the date of the request", "as soon as reasonably possible".
- If the organisation cannot respond **within 30 days**, it must tell the individual in writing within 30 days when it will respond ([Key Concepts AG](https://www.pdpc.gov.sg/assets/34058be5-ae13-4c40-89e6-1c945d19f65c), revised 29 Apr 2026, para 15.18; PDP Regulations 2021).
- A **reasonable fee** may be charged (para 15.25).
- If any data is withheld, keep a complete copy of it **for at least 30 calendar days** after rejecting (para 15.42).
- Exceptions: Fifth Schedule, and s.21(3) (e.g. data about other individuals).

**Correction (s.22).** Correct the data, or inform the individual within 30 days of when it will be done (Key Concepts para ~15.6x, at text line "If an organisation is unable to correct the personal data within 30 days"). The paragraph number is **UNVERIFIED**; the rule itself is confirmed.

**Protection (s.24).** "reasonable security arrangements to prevent (a) unauthorised access, collection, use, disclosure, copying, modification or disposal … and (b) the loss of any storage medium" ([PDPA s.24](https://sso.agc.gov.sg/Act/PDPA2012)).

**Retention limitation (s.25).** Stop retaining data, or anonymise it, once the purpose is no longer served **and** retention is no longer needed for legal or business purposes ([PDPA s.25](https://sso.agc.gov.sg/Act/PDPA2012)). The PDPA sets **no fixed period**. Statutory floors come from other laws:
- **Employment Act records:** current employees, latest 2 years; ex-employees, the last 2 years of records kept for **1 year after they leave** ([MOM Employment records](https://www.mom.gov.sg/employment-practices/employment-records)).
- **WP and S Pass salary records:** must be producible on request (§10.6).
- **IRAS and CPF periods:** not researched here (**UNVERIFIED**; commonly 5 years for tax records).

**Transfer limitation (s.26).**
- No transfer overseas except under prescribed requirements that ensure comparable protection ([PDPA s.26](https://sso.agc.gov.sg/Act/PDPA2012)).
- The PDP Regulations 2021 accept legally enforceable obligations (law, contract naming the destination countries, binding corporate rules, or another binding instrument) or specified certifications ([Key Concepts](https://www.pdpc.gov.sg/assets/34058be5-ae13-4c40-89e6-1c945d19f65c) paras 19.4–19.6).
- This is relevant when a self-hosting company runs Crow HR on overseas cloud regions or uses overseas SMTP or backup services.

**Data breach notification (Part 6A).**
- **Notifiable** if a breach results in, or is likely to result in, **significant harm**, or is of **significant scale** ([s.26B](https://sso.agc.gov.sg/Act/PDPA2012)).
  - Significant scale means **500 or more** affected individuals ([Key Concepts](https://www.pdpc.gov.sg/assets/34058be5-ae13-4c40-89e6-1c945d19f65c) para 20.20). If the count is unknown, notify when there is reason to believe it is at least 500 (para 20.21).
  - **Deemed significant harm:** full name, alias or **full national ID number** combined with prescribed data, which includes "**the amount of any wages, salary, fee, commission, bonus, gratuity, allowance or other remuneration**" and **bank account numbers** (para 20.15, from the PDP (Notification of Data Breaches) Regulations 2021). **A payroll breach is therefore almost always notifiable, even below 500 people.**
  - Breaches confined within the organisation are deemed not notifiable ([s.26B(4)](https://sso.agc.gov.sg/Act/PDPA2012)).
- **Assess** "in a reasonable and expeditious manner" ([s.26C(2)](https://sso.agc.gov.sg/Act/PDPA2012)). PDPC expects assessment "generally … within **30 calendar days**", and **all assessment steps must be documented** ([Key Concepts](https://www.pdpc.gov.sg/assets/34058be5-ae13-4c40-89e6-1c945d19f65c) paras 20.4–20.5).
- **Data intermediaries** must notify the controlling organisation "without undue delay" ([s.26C(3)](https://sso.agc.gov.sg/Act/PDPA2012)).
- **Notify PDPC** "as soon as is practicable, but in any case no later than **3 calendar days** after the day the organisation makes that assessment" ([s.26D(1)](https://sso.agc.gov.sg/Act/PDPA2012)).
- **Notify affected individuals** for significant-harm breaches ([s.26D(2)](https://sso.agc.gov.sg/Act/PDPA2012)). This is not required if remedial action, or prior technological measures such as encryption, make harm unlikely ([s.26D(5)](https://sso.agc.gov.sg/Act/PDPA2012)). Individuals must not be notified if law enforcement or PDPC directs otherwise ([s.26D(6)](https://sso.agc.gov.sg/Act/PDPA2012)).

**Accountability and DPO** ([s.11–12](https://sso.agc.gov.sg/Act/PDPA2012)):
- Designate at least one individual responsible for PDPA compliance (s.11(3)). Responsibility may be delegated (s.11(4)).
- **Make that person's business contact information public** (s.11(5)).
- Have policies, a complaints process, staff communication, and information available on request (s.12).

**Penalties.** Up to **10% of annual Singapore turnover** if turnover exceeds $10m, **otherwise up to $1m** ([PDPA s.48J(3)](https://sso.agc.gov.sg/Act/PDPA2012), wef 1 Oct 2022).

**Who is the organisation for a self-hosted install.** The employer is the organisation and controller. The Crow HR open-source project is neither an organisation nor a data intermediary for that data, unless it, or a reseller, hosts or processes data for the employer. An outsourced payroll processor is a data intermediary ([Key Concepts](https://www.pdpc.gov.sg/assets/34058be5-ae13-4c40-89e6-1c945d19f65c), payroll example). It must still protect the data and must notify the employer of breaches without undue delay.

### 11.3 Product requirements for Crow HR

1. **NRIC/FIN handling:**
   - Collect only on the employee record, for EA, CPF and IRAS purposes. Never on applicant or candidate forms; enforce this through a field policy.
   - Store encrypted at the field level.
   - Apply role-based "reveal" with a reason, and audit each reveal.
   - Default list and report views to partial display (e.g. `****567A`). Present this as data minimisation, not security, in line with the MDDI view.
   - Exports include the full NRIC only where a statutory file needs it (CPF, IR8A/AIS, MOM).
2. **Never use NRIC, FIN or DOB for authentication** (deadline 31 Dec 2026; enforcement from 1 Jan 2027):
   - No default passwords derived from NRIC or DOB.
   - No "enter last 4 of NRIC" verification.
   - **No NRIC+DOB-protected payslip or IR8A PDFs.** Ship portal download behind login (MFA or passkeys), or expiring single-use links with a separately delivered password. These match the PDPC/CSA "alternative methods" table.
   - Add a lint or check that refuses such configurations.
3. **Physical ID:** offer optional upload of a pass or NRIC image only where needed, e.g. for verifying a work pass. Set a short default retention, with auto-purge after verification. Warn that physical NRICs must not be retained.
4. **Retention policy engine:**
   - Per-category schedules: applicant data, employee master, payroll, work pass, medical/MC, bank details.
   - Defaults set to the statutory minimum: EA records 2 years plus 1 year after exit; tax records configurable, e.g. 5 years.
   - Legal-hold override.
   - Purge or anonymise jobs, with a deletion log.
5. **Access and correction requests:**
   - A DSAR workflow with intake date, a 30-day clock, and a templated "extension" letter.
   - A one-click export of all data about the person, plus the log of disclosures and uses in the last 12 months (e.g. CPF/IRAS submissions and exports).
   - Withheld-item preservation of at least 30 days.
   - A correction workflow, with notice to recipients from the past year where relevant (s.22(2) obligation; **UNVERIFIED**, s.22 detail not quoted).
6. **Audit logs:** append-only logs of views, reveals, exports, changes and logins for HR, payroll and admin roles. Make them exportable for breach assessment.
7. **Breach module:**
   - Incident record with a "reason to believe" timestamp.
   - Assessment checklist: count affected individuals and flag ≥500; flag prescribed data (name or full ID **plus** salary or bank account means notify individuals); flag intra-organisation only.
   - A 30-day assessment target, then a **3-calendar-day** PDPC deadline counter from the assessment date.
   - Templates for notifying PDPC and individuals.
   - Data-intermediary notice for hosting partners.
8. **DPO settings:**
   - DPO name, role and business email or phone (required at setup).
   - Show them on the employee privacy notice and the portal footer.
   - A generated employee **privacy notice** listing purposes under s.20(4).
9. **Transfer:**
   - Admin setting for data-residency region, with a warning when backups, SMTP or object storage are configured outside Singapore.
   - A checklist for contractual safeguards (s.26, Regs 2021).
10. **Security baseline for self-hosters:**
    - TLS everywhere; secrets in a KMS or vault; MFA for admin and payroll roles.
    - Encryption at rest for bank and ID fields.
    - Least-privilege roles separating HR, payroll, manager and employee.


## 12. Singpass, Myinfo and Corppass

### 12.1 Current Singpass API: FAPI 2.0 with OIDC

**Deadlines.**
- "All Singpass APIs must be fully compliant with FAPI 2.0 by **31 Dec 2026**" ([Singpass docs home](https://docs.developer.singpass.gov.sg/docs/getting-started/readme)).
- New app registrations "after **10 February 2026** require FAPI compliance". The legacy, pre-FAPI documentation was retired on 14 Jul 2026 ([Changelog](https://docs.developer.singpass.gov.sg/docs/technical-specifications/changelog)).
- **Myinfo v3/v4 → v5** by "end Sep 2026", already past ([Myinfo FAQ Q2](https://docs.developer.singpass.gov.sg/docs/products/singpass-myinfo/faq)). Moving from v3/v4 needs a **new app / client_id** ([Migration guides](https://docs.developer.singpass.gov.sg/docs/technical-specifications/migration-guides)).

**Endpoints** (live discovery at [id.singpass.gov.sg/fapi/.well-known/openid-configuration](https://id.singpass.gov.sg/fapi/.well-known/openid-configuration), fetched 31 Oct 2026):

| Item | Production value |
|---|---|
| issuer | `https://id.singpass.gov.sg/fapi` |
| PAR | `/fapi/par` |
| authorization | `/fapi/auth` |
| token | `/fapi/token` |
| userinfo | `/fapi/userinfo` |
| Singpass JWKS | `https://id.singpass.gov.sg/.well-known/keys` |
| Staging | `stg-id.singpass.gov.sg` |

Supported values from the same document:
- `response_types_supported`: `code` only.
- `token_endpoint_auth_methods_supported`: `private_key_jwt` only (ES256, ES384 or ES512).
- ID token: signed ES256; encrypted with `ECDH-ES+A256KW` (also `+A192KW` or `+A128KW`) and enc `A256CBC-HS512`.
- Userinfo: enc `A256GCM`.
- `dpop_signing_alg_values_supported`: ES256, ES384 or ES512.
- `authorization_response_iss_parameter_supported`: true.

**Mandatory client behaviour** ([Authorization request](https://docs.developer.singpass.gov.sg/docs/technical-specifications/integration-guide/1.-authorization-request); [Login/Myinfo v5 migration](https://docs.developer.singpass.gov.sg/docs/technical-specifications/migration-guides/login-myinfo-v5-apps); [DPoP](https://docs.developer.singpass.gov.sg/docs/technical-specifications/technical-concepts/demonstrating-proof-of-possession-dpop); [JWKS](https://docs.developer.singpass.gov.sg/docs/technical-specifications/technical-concepts/json-web-key-sets-jwks); [Client assertion](https://docs.developer.singpass.gov.sg/docs/technical-specifications/technical-concepts/generation-of-client-assertion); [Discovery](https://docs.developer.singpass.gov.sg/docs/technical-specifications/technical-concepts/openid-connect-discovery)):
- **PAR (RFC 9126)** is required. The `request_uri` lives for 60 s. The redirect carries only `client_id` and `request_uri`.
- **PKCE** with S256 only.
- **DPoP (RFC 9449)** on PAR, token and userinfo calls:
  - Use a new ephemeral key per authentication session, the same key across all three calls.
  - Send `Authorization: DPoP <token>`.
- **Client authentication** by `private_key_jwt`:
  - Claims: `iss` = `sub` = client_id; `aud` = issuer.
  - `exp` must be no more than **2 minutes** after `iat`.
  - `jti` must be unique.
- **Client JWKS:**
  - **EC keys only** (P-256, P-384 or P-521), with at least one `sig` and one `enc` key, unique `kid`, and no `d`.
  - Registered either as inline JSON, or as a URL that is "publicly accessible at all times" and responds **within 3 s**.
- **ID token** is always JWE-encrypted. `sub` is the **UUID**.
  - NRIC/FIN comes back only in `sub_attributes` when the `user.identity` scope is approved, and that scope "need[s] justification".
- **Login apps** must send `authentication_context_type` (e.g. `APP_AUTHENTICATION_DEFAULT`).
- **Redirect URIs** must be HTTPS. Custom URL schemes are no longer supported. Staging samples use `http://localhost:3001/callback`.
- **Discovery:** cache it for at least 1 hour, and don't pin TLS leaf certificates.
- **Login scopes** are limited to `openid`, `user.identity`, `name`, `email` and `mobileno` ([Create production app](https://docs.developer.singpass.gov.sg/docs/singpass-developer-portal-sdp/app-management/create-production-app)).
- **QR only:** "new Singpass Login/Myinfo apps will only support QR Login. Password/SMS OTP login will no longer be offered" ([Login FAQ Q3](https://docs.developer.singpass.gov.sg/docs/products/singpass-login/faq)).
- **Who can log in:** foreigners need to be at least 15 and be PRs or FIN holders with a Singpass account (same FAQ, Q4).

### 12.2 Eligibility, onboarding, approval and fees (Singpass Login and Myinfo)

**Organisation.**
- "Your organisation must be a **Singapore-registered entity** (government or private sector)". Prepare ACRA details and any regulatory licences ([Pre-requisites](https://docs.developer.singpass.gov.sg/docs/getting-started/pre-requisites-for-onboarding)).
- **Corppass is required.** A Corppass Admin must authorise the user's Singpass account for the "Singpass Developer Portal" e-service ([Obtaining SDP access](https://docs.developer.singpass.gov.sg/docs/singpass-developer-portal-sdp/getting-access/obtaining-access-to-the-singpass-developer-portal-sdp)).

**Process** ([Quick Start](https://docs.developer.singpass.gov.sg/docs/getting-started/quick-start); [Create production app](https://docs.developer.singpass.gov.sg/docs/singpass-developer-portal-sdp/app-management/create-production-app); [Consent to Service Agreement](https://docs.developer.singpass.gov.sg/docs/singpass-developer-portal-sdp/service-agreement/consent-to-singpass-service-agreement)):
1. Create a staging app (no approval needed).
2. Accept the **Singpass Services Agreement** and set billing contacts.
3. Upload a **user journey** and give a justification for each scope.
4. Create the production app: redirect URIs, JWKS and scopes. **Approval takes up to 2 weeks.**

**Use-case rules:**
- Request only necessary data, with each scope justified.
- Display all retrieved data to the user.
- "Singpass cannot be the only form-filling or authentication option" ([Pre-requisites](https://docs.developer.singpass.gov.sg/docs/getting-started/pre-requisites-for-onboarding)).
- One request per distinct use case or user journey ([Myinfo FAQ Q5](https://docs.developer.singpass.gov.sg/docs/products/singpass-myinfo/faq)).

**No DPIA or security questionnaire requirement was found** in the public docs. **UNVERIFIED:** the agreement or the review may ask for more; the agreement is only visible after SDP login.

**Fees** ([Pricing FAQ](https://partnersupport.singpass.gov.sg/hc/en-sg/articles/34880999253145-Singpass-Pricing-Model-and-Service-Level-Subscription-FAQ-for-Private-Organisations), updated 7 Jul 2026):
- "There are **no setup and onboarding fees**".
- Freemium per **UEN**: the first **50,000 completed Login transactions per month per UEN** are free, and the first **5,000 Myinfo Standard transactions per month per UEN** are free.
- **Myinfo Plus** (CPF, NOA and property scopes) is charged from the first transaction.
- Rates are visible only in SDP ([Pricing](https://docs.developer.singpass.gov.sg/docs/pricing/pricing)).
- Pricing was revised on 1 Jan 2026. Assurity Trusted Solutions (ATS) remains the billing party ([30 Jun 2025 notice](https://partnersupport.singpass.gov.sg/hc/en-sg/articles/48432886540185--30-June-2025-Singpass-Services-Update-Pricing-Updates-Effective-1-January-2026-and-Services-Agreement-Revision)).
- **Implication:** a typical SME would pay nothing for employee Login, and nothing for Myinfo Standard onboarding of new hires, if it onboards **under its own UEN**.

**Myinfo data rules** ([Myinfo key principles](https://docs.developer.singpass.gov.sg/docs/products/singpass-myinfo/key-principles); [Myinfo FAQ](https://docs.developer.singpass.gov.sg/docs/products/singpass-myinfo/faq)):
- Display retrieved data **as-is**; government data is **un-editable**.
- **Store only if the form is submitted**, and purge unsubmitted drafts periodically.
- No backend-only retrieval (Q8).
- Fetch fresh data each time; don't repopulate from a session or cookie (Q6).
- Provide a manual alternative (Q7).
- If the user corrects data manually, do not save the Myinfo values (Q9).
- **HR-relevant scopes:**
  - `employment` (name of employer) and `occupation`: data is available for FIN holders, sourced from MOM ([Education and Employment catalog](https://docs.developer.singpass.gov.sg/docs/data-catalog-myinfo/catalog/education-and-employment)).
  - From the live discovery `scopes_supported`: `passtype`, `passstatus`, `passexpirydate`, `employmentsector`, `regadd`, `dob`, `nationality`, `cpfcontributions` and others.

### 12.3 Myinfo Business and Corppass

**Myinfo Business** ([product](https://docs.corppass.gov.sg/products/myinfo-business); [prerequisites](https://docs.corppass.gov.sg/products/myinfo-business/getting-started/prerequisites); [pricing](https://docs.corppass.gov.sg/products/myinfo-business/pricing-plan)):
- Retrieves verified corporate data (ACRA etc.) with consent from an authorised Corppass user.
- Available only to ACRA-registered entities with authorised Corppass users.
- **Currently free of charge.**
- v3 runs on FAPI 2.0. Existing v1/v2 apps must migrate **by 31 May 2027** ([Corppass FAPI 2.0](https://docs.corppass.gov.sg/technical-specifications/corppass-authorization-api-fapi-2.0)).
- Crow HR use: pre-fill company UEN, name, address and SSIC at setup. This is a nice-to-have.

**Corppass Login for private-sector services.**
- Corppass lets entities "transact digitally with Singapore Government agencies **and participating private sector services**" ([About Corppass](https://docs.corppass.gov.sg/introduction/readme)).
- Private relying parties onboard through the **Corppass Developer Portal (CDP)**: staging app, then production app submitted for approval ([Corppass Login getting started](https://docs.corppass.gov.sg/products/corppass-login/getting-started)).
- **FAPI 2.0** was launched on 23 Feb 2026 and is required for new services. Existing services onboarded before 23 Mar 2026 must migrate **by 31 Mar 2027**; the legacy profile is deprecated on 1 Apr 2027 ([launch changelog](https://docs.corppass.gov.sg/technical-specifications/corppass-authorization-api-fapi-2.0/changelog/corppass-authorization-api-fapi-2.0-launch)).
- The flow mirrors Singpass: PAR, PKCE, DPoP, client assertion with exp ≤ 2 min and unique `jti`, JWE ID token, and a **1-minute** authorization code TTL.
- Corppass returns `auth_info` (roles and parameters per digital service) and, for third-party authorisations, `tp_auth_info`. Example: a firm acting for several client entities ([Third-party Auth Info](https://docs.corppass.gov.sg/technical-specifications/corppass-authorization-api-fapi-2.0/integration-guide/4.-userinfo-endpoint/third-party-auth-info)).
- Some settings are locked once published: entity types, roles and parameters ([CDP digital services FAQ](https://docs.corppass.gov.sg/corppass-developer-portal-cdp/user-guide/faq/digital-services)).
- **Pricing for private entities:** "submit a request via the Partner Support Portal". Not public, **UNVERIFIED** ([Corppass Login pricing](https://docs.corppass.gov.sg/products/corppass-login/pricing-plan)).
- **Fit for Crow HR:** low. Corppass suits a multi-tenant service where users act on behalf of many entities. In a self-hosted single-company instance, admins can use Singpass Login or local MFA.

### 12.4 Vendor model versus each employer onboarding

- **Primary guidance.** Myinfo FAQ Q17: "We are a solution company looking to build a product/platform integrated with Myinfo for our client. How do we go about doing so? — **Please submit a joint link-up request through your client.**" ([Myinfo FAQ](https://docs.developer.singpass.gov.sg/docs/products/singpass-myinfo/faq)). The relying party is the client entity, under its UEN, with its own Services Agreement and billing. The vendor participates in the link-up.
- **Supporting evidence:** onboarding is UEN-scoped (Corppass-authorised SDP access, a per-UEN Service Agreement, per-UEN free tiers), and each use case or user journey needs its own request.
- **Aggregator model (SECONDARY):** Persona says it obtained GovTech approval to act as an aggregator on behalf of companies ([Persona blog, 6 Jul 2026](https://withpersona.com/blog/persona-launches-singpass-integration-to-help-companies-scale-in-apac)). Such arrangements seem to be approved case by case. **UNVERIFIED:** I found no public "software provider" or partner programme on Singpass pages. Partner-support searches for "SaaS", "aggregator" and "intermediary" returned 0 results.
- **Conclusion for a self-hosted, MIT product:** **each employer must onboard as its own relying party**, with its own client_id, its own keys and JWKS, its own redirect URIs on its own domain, its own approved user journey, and its own Service Agreement. The Crow HR project cannot hold a shared client_id: it is not necessarily a registered entity, and a shared ID would also break per-tenant key custody. A hosted Crow HR cloud run by a registered entity could explore the "joint link-up" route per client. **Confirm with partnersupport.singpass.gov.sg.**

### 12.5 What Crow HR can ship versus what needs approval

**Can ship without anyone's approval** (it is code):
- A **generic FAPI 2.0 OIDC relying-party module**, configurable per instance:
  - Issuer and discovery URL, with staging and production presets for Singpass and Corppass.
  - client_id.
  - `private_key_jwt` client authentication (ES256/384/512) with `jti` and `exp` ≤ 2 min.
  - **PAR**, **PKCE S256**, **DPoP** (ephemeral per-session keys), and JWE decryption of the ID token and userinfo (ECDH-ES+A*KW with A256CBC-HS512 / A256GCM).
  - Validation of `iss` in the authorization response.
  - Discovery caching for at least 1 hour.
  - Singpass-specific parameters: `authentication_context_type`, defaulting to `APP_AUTHENTICATION_DEFAULT`, and an optional `authentication_context_message`.
- **Key management UI:**
  - Generate EC P-256 signing and encryption keys inside the instance and keep the private keys in a vault or KMS.
  - Publish a **public JWKS endpoint** (no `d`), with rotation that never reuses a `kid`.
  - A "copy JWKS JSON" option for instances not reachable from the internet, since inline JWKS registration is allowed.
- **Login mapping:** link the Singpass `sub` (UUID) to an employee account by invite and one-time binding. **Do not** require `user.identity` (NRIC). Keep local login or passkeys as the mandatory alternative.
- **Myinfo onboarding form for new hires:**
  - Scopes such as name, dob, nationality, regadd, passtype, passexpirydate and email/mobile.
  - Display as-is and read-only; persist only on submit; purge drafts.
  - Manual-entry path.
  - Avoid Myinfo Plus scopes such as `cpfcontributions` unless needed, because they are chargeable.
- **Docs and templates:** a setup wizard that tells the company what to submit in SDP (redirect URI, JWKS URL, scopes with justification text, user-journey screenshots). Also a FAPI conformance self-test against staging.

**Needs approval or onboarding by each employer:**
- Corppass admin access to SDP or CDP.
- Acceptance of the Services Agreement.
- Production app approval (up to 2 weeks).
- Approval of each scope, including `user.identity`.
- `acr_values` LOA3, which needs whitelisting and is chargeable.
- Corppass Login app approval.
- Myinfo Business app approval.

**Self-hosting gotchas:**
- The redirect URI must be public HTTPS.
- The JWKS URL must be internet-reachable within 3 s, or the JWKS must be registered inline.
- Outbound access to `id.singpass.gov.sg` is required. Corppass also has IP allow-list guidance ([Corppass onboarding notes](https://docs.corppass.gov.sg/what-you-need-to-know-before-onboarding-a-digital-service-in-corppass)).
- Clock sync matters because of the 2-minute assertion window and the 1-minute Corppass authorization code.

---

---

## 13. Bank GIRO / bulk payment files

No bank-neutral public Singapore payroll file standard was found.

- **DBS IDEAL "Universal File Format (UFF)":**
  - A CSV-style format, uploaded as .txt or .csv up to 15 MB.
  - **The spec (v2.2) is available only after logging in to IDEAL** (Resource Center).
  - The public help page lists the April 2026 ISO 20022-driven changes: a `UFFv2` version field, a 140-character payee name, and removal of unstructured addresses after Oct 2026.
  - Source: [DBS](https://www.dbs.com.sg/corporate/contact-us/files-upload-of-universal-file-format).
- **OCBC Velocity:**
  - Accepts "Velocity format-compliant" uploads ([OCBC](https://www.ocbc.com/business-banking/help-and-support/business-internet-banking/general)), but **there is no public spec**.
  - Vendor guides (secondary) say OCBC must activate bulk payroll upload, and they cite format names such as "GIROFASTWITHINV" ([Talenox](https://help.talenox.com/en/articles/421825-uploading-ocbc-bank-file)).
- **UOB Infinity:**
  - "FAST/GIRO Payroll" upload, with **no public spec** (secondary: [StaffAny](https://help.staffany.com/en/articles/8898672-uploading-uob-bank-file-giro)).
  - UOB's host-to-host service RFTS (SFTP with PGP) accepts **ISO 20022 pain.001 V3** and UOB formats ([UOB RFTS](https://www.uob.com.sg/business/digital/regional-file-transfer-services.page)).

**Implications for Crow HR:**
- Ship a pluggable "bank export" interface.
- Ship a generic CSV and an **ISO 20022 pain.001.001.03** generator, which is an open standard.
- Let an employer configure a column template from its own bank's spec.
- Label bank-specific templates "unverified by bank" until a customer validates them with a bank test upload.
- Do not claim DBS, OCBC or UOB compatibility without validation.

---

## 14. Integrations needing government or vendor onboarding (consolidated)

**What to document as limitations.** Everything in the "No" rows below must go in `docs/limitations.md` and be marked `// NOT IMPLEMENTED:` until real onboarding exists. Don't fake any of them.

| Integration | Ship without approval? | Onboarding required | Who must onboard |
|---|---|---|---|
| CPF EZPay **FTP file** (.DTL; CPF + SHG + SDL) | **Yes** (public spec) | CSN (PTE), Corppass "CPF EZPay"; employer uploads file | Each employer |
| CPF Contributions **API** (One-Stop Payroll, APEX) | **No** | Corppass + APEX app, OSP sandbox by email, spec available only inside APEX, production authorisation | Vendor (hosted relay) or each employer as in-house; plus employer consent |
| IRAS **IR8A Import Template XLSX** (≤200 records per upload) | **Yes** (fetch the template at runtime) | AIS registration; Corppass "Submission of Employment Income Records" (Approver role) | Each employer |
| IRAS **AIS-API 2.0** direct submission | **No** | Corppass, APEX app/API key/OAuth 2.1, public JWKS, domain HTTPS redirect, whitelisted IPs, interest form by 30 Sep, sandbox, IRAS production approval; vendor listing needs an annual validation test by 30 Nov | Vendor entity (relay), or each employer as "in-house" |
| Printable IR8A / 8A / 8B | **Yes** | — | — |
| IR21 data pack for manual e-filing | **Yes** | myTax authorisation (e-service name UNVERIFIED) | Each employer |
| IR21 **API** (#SFFS) | **No** | IRAS interest form; spec not public | Vendor |
| MSF Government-Paid Leave reimbursement claims | Claim **computation**: yes. **Submission: no** | GPL portal via Corppass (manual) | Each employer |
| MOM work-pass transactions (apply, renew, cancel, levy bill) | **No** (no public API found) | EP Online / WP Online via Corppass (manual) | Each employer |
| Singpass Login (FAPI 2.0) | Code: **yes**. Production: **no** | SDP via Corppass, Services Agreement, user journey with scope justification, approval up to 2 weeks, QR-only, mandatory non-Singpass alternative | **Each employer** (own UEN, client_id, keys) |
| Myinfo v5 (new-hire pre-fill) | Code: **yes**. Production: **no** | As above, plus per-scope justification. A solution provider must submit a "joint link-up request through your client" | Each employer |
| Myinfo Business / Corppass Login | Code: **yes**. Production: **no** | Corppass Developer Portal approval | Each employer (vendor model UNVERIFIED) |
| Bank bulk files: DBS UFF / OCBC Velocity / UOB Infinity | Generic CSV and ISO 20022 pain.001: **yes**. Bank-specific formats: **no public spec** | Bank customer access to the spec; test upload | Each employer |

### Recommended product stance

- **Ship the generators and validators:** .DTL, IR8A XLSX, pain.001, and the FAPI 2.0 client module.
- **Ship the setup wizards** that tell each employer what to register.
- **Never ship shared credentials.** Never bundle IRAS/CPF spec PDFs or templates whose licence forbids reproduction; link to them instead.

## 15. Unverified items, ambiguities and questions for agencies

### CPF / SDL / SHG

1. **Sub-cent rounding.** Is the "round to nearest dollar" rule applied to the exact amount, or to the amount already rounded to cents? We use the exact amount (vectors RD-03 and RD-04). Before go-live, confirm in [CPF's calculator](https://www.cpf.gov.sg/employer/tools-and-services/calculators) with TW $1,001.34, age ≤55: we expect total $370, employee $200.
2. **Wage band when non-subject AW is the only thing pushing TW past $500 or $750.** CPF's example 16 covers TW > $750. Edge cases within the $500–$750 band are not covered.
3. **SPR F/G and F/F elections.** CPF does not say when they take effect or whether they can be reversed.
4. **OW ceiling with multiple employers.** Is the OW ceiling applied per employer? The AW ceiling is stated to be per employer; the OW ceiling is implied to be per employer.
5. **Effective date of the $102,000 Annual Salary Ceiling.** The 2016 date is from memory.
6. **SDL rounding and exemptions.** Per-employee rounding is not published. The SWDA FAQ listing exempt categories was unreachable (TLS error).
7. **SHG.**
   - Effective dates for the CDAC, ECF and SINDA tables.
   - Whether SHG is due when TW ≤ $50.
   - How to report SHG for foreign employees in the CPF .DTL file, which requires S/T account numbers.
   - The ECF opt-out procedure.
8. **CPF late-payment interest formula.** The day-count method (1.5% per month, prorated by days, minimum $5) comes from a SECONDARY snippet.
9. **Recovering an underpaid employee share in later months.** The CPF Act s 7 rules on recovering an underpaid employee share from later months' wages could not be read on SSO. Until verified, treat a correction of the employee share as needing legal review.

### Employment Act / leave

10. **Overtime hourly rate.** MOM's example uses $13.60 where the formula gives $13.6364. No rounding rule is published.
11. **50% deduction cap.** Does the employee CPF share count towards the cap?
12. **"Days actually worked" in the incomplete-month formula.** Does it include outpatient sick leave and childcare leave?
13. **Unpaid leave and annual-leave pro-ration.** Should a single unpaid day exclude the whole month from the pro-ration of annual leave?
14. **Public holidays falling during annual leave, or on a Saturday for 5.5-day workers.** No explicit MOM rule was found.
15. **Part-time leave-hour rounding.** It appears to be 1 decimal place, half up, but the Regulations were unreadable.
16. **Government reimbursement and employer CPF.** Whether GPML, GPPL and SPL reimbursement includes employer CPF is SECONDARY.
17. **NDR 2026 childcare and parental leave changes.** Start date, cap and citizenship rules are not yet published.
18. **NS leave.** The DIRECT mechanics are SECONDARY, and MOM has no page on them.
19. **Sick-leave year basis.** Calendar year or service year?

### Tax

20. **AIS registration date.** The AIS landing page says 1 Mar 2026; the gazette says 1 Mar 2027. We follow the gazette.
21. **IR8S for amendments.** Is IR8S still needed when amending YA2025 or earlier?
22. **AIS API onboarding.** Must an in-house AIS API user pass the validation test? Does API consent need the Approver role?
23. **IR8A Import Template.** Its redistribution licence is unknown.
24. **IR21.** The Corppass e-service name and the API spec are not public.

### Work passes / PDPA / Singpass

25. **FWL.** The implementation date of the 2028 changes is not set.
26. **WP application age limit.** "Below 62" or "62 inclusive"?
27. **Dormitory bank-payment rule for WP holders.** Its legal source was not found in the Work Passes Regs.
28. **Singpass DPIA or security review requirements.** These sit behind the SDP login.
29. **Singpass vendor/aggregator programme.** None is publicly documented (aggregator claim is SECONDARY).
30. **Record retention.** IRAS and CPF retention periods were not researched. Five years for tax records is common practice but **UNVERIFIED**.

**Agency contacts:**
- CPF: Employer hotline / "Text Us".
- IRAS: myTax Mail; one_stop_payroll@iras.gov.sg for OSP.
- MOM: EP/WP enquiries.
- Singpass: partnersupport.singpass.gov.sg.

## 16. What HR/payroll systems commonly get wrong

The sources for these come from CPF's own *Mistakes by Employers* list, the official AW examples, and the rules above.

1. **Rounding the employer share independently.** CPF rounds the **total** to the nearest dollar on the exact amount, floors the employee share, and sets employer = total − employee. Systems that round employer and employee separately, or round to cents first, are off by $1 (e.g. OW $7,999.99 gives employer $1,361, not $1,360).
2. **Mishandling the AW ceiling.** Common errors:
   - applying the OW ceiling to bonuses (CPF mistake #5);
   - not estimating the year's OW at each AW payment;
   - not **re-computing in the last month of employment or in December**;
   - not re-subjecting earlier AW at the rate of the month it was paid;
   - ignoring AW paid after cessation;
   - not resetting for mid-year joiners or rehires.
3. **Changing the age band in the birthday month.** New rates start the month **after** the 55th, 60th, 65th or 70th birthday. The 2027 rate changes for ages 55–65 make this more visible.
4. **SPR year boundaries and options.** Common errors:
   - starting year 2 on the anniversary date instead of the 1st of the following month;
   - charging full-month CPF in the conversion month;
   - ignoring F/G and F/F joint elections.
5. **Choosing the wage band on subject wages instead of total wages.** For example, deducting nothing from an employee on $500 OW who also has an AW above the ceiling. CPF's example 16 says the full rate applies.
6. **Misclassifying pay items.** Common errors:
   - treating OT paid after the 14th of the following month as OW;
   - treating retrospective increments as OW;
   - treating allowances as reimbursements;
   - charging CPF on notice pay or retrenchment benefit.
7. **SHG mistakes.** Common errors:
   - using capped CPF wages instead of total wages;
   - picking the second race of a double-barrelled race;
   - not deducting MBMF for foreign Muslims or SINDA for EP holders;
   - ignoring opt-out forms.
8. **SDL mistakes.** Common errors:
   - omitting foreigners;
   - rounding each employee instead of the total;
   - forgetting that EZPay does not auto-compute SDL for foreigners or in FTP mode.
9. **Deducting FWL from salary.** It is prohibited (EFMA s 25(6)(e), s 22A).
10. **Using NRIC + DOB as the PDF password for payslips or IR8A.** It must stop by 31 Dec 2026 (PDPC).
11. **Overtime for ineligible staff, or the wrong base.** Paying OT to managers/executives (or none to Part IV staff), not capping non-workmen at the $2,600 base, or breaching the 72 h/month limit.
12. **Annual leave pro-ration and the 3-month eligibility gate.** Common errors:
    - rounding fractions the wrong way (MOM: below ½ goes down, ½ or more goes up to a full day);
    - counting partial months;
    - granting leave before 3 months of service.
13. **Saturday public holidays.** Treating them as an automatic Monday off. MOM gives no automatic Monday substitute: the employee gets another day off or a day's gross pay.
14. **Parental leave.** Common errors:
    - stale rules (paternity leave is 4 weeks, SPL is 10 weeks from 1 Apr 2026, unpaid infant care leave is 12 days);
    - wrong reimbursement windows (GPML 1st and 2nd child: employer weeks 1–8, Government weeks 9–16).

## 17. Review follow-up: taxable cash claims and holiday gross pay (1 Nov 2026)

- [IRAS: Tax Principles and Flexible Benefits](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/tax-principles-and-flexible-benefits) requires employers to track taxable flexible benefits and report them in IR8A; exemptions still depend on the underlying benefit. Crow HR reports claim-type taxable cash reimbursements in d1 allowances. Non-cash benefits (Appendix 8A) and employer-borne tax remain separate manual entries, not inferred from that flag.
- [IRAS: Transport](https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/transport) distinguishes non-taxable official-duty reimbursements from taxable private mileage. Do not mark every reimbursement taxable or exempt merely because it is a claim.
- [MOM: Monthly and daily salary](https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary) defines the daily gross rate and excludes travelling, food and housing allowances and expense reimbursements from the gross base. The existing sg-rules dailyRate calculator is used; allowance inclusion is explicitly configured.
- [MOM: Public holiday entitlement and pay](https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay) gives an off-day holiday another day off or an extra day's gross pay. A rest-day holiday becomes a substitute working-day holiday; it is not silently cashed out.
- [MOM: Annual leave in special situations](https://www.mom.gov.sg/employment-practices/leave/annual-leave/special-situations) requires Part IV unused statutory annual leave to remain available for the next 12 months. An earlier company carry expiry cannot shorten that minimum.
