# SEO and search intent: crow.sg product page

Researched 31 Oct 2026.
- No keyword-volume tool was available, so the signals below are **qualitative**: who ranks, what format ranks, and which questions recur in FAQ-style ranking pages.
- No People-Also-Ask box was accessible directly. The PAA-style questions are **inferred** from pages built to target them, such as Omni HR's `/faqs/*` URLs.

## 1. What the SERPs look like

| Query cluster | Who ranks | What the intent is | Opening for Crow HR |
| --- | --- | --- | --- |
| "HR software Singapore", "best HR software Singapore SME 2026" | Vendor-written listicles: [QuickHR](https://quickhr.co/resources/blog/best-hrms-software-singapore-2026), [Omni HR](https://www.omnihr.co/blog/best-hr-software-singapore), [brioHR](https://briohr.com/blog/best-hr-software-singapore/), [Talenta](https://www.talenta.co/en-sg/blog/best-hr-software-in-singapore/), [Employment Hero](https://employmenthero.com/sg/blog/best-hr-software-in-singapore/), [JustLogin](https://ads.justlogin.com/post/top-5-hr-software-in-singapore-for-2024). Directories (Capterra SG, GetApp SG). | Commercial comparison. People want a shortlist with prices and CPF/IRAS confidence. | Hard to win head-on. Earn a mention in these listicles by being the only free, open-source option. |
| "payroll software Singapore" | [JustLogin](https://justlogin.com/payroll-software/) ("CPF, IRAS AIS, MOM Compliant" in the title), [Talenox](https://www.talenox.com.sg/payroll/), [Swingvy](https://www.swingvy.com/sg/products/payroll), plus listicles from [Sleek](https://sleek.com/sg/resources/best-payroll-software-singapore/), [Aspire](https://aspireapp.com/en-sg/blog/payroll-software-for-small-business), [Volopay](https://www.volopay.com/sg/blog/mom-approved-payroll-software/) and [Wise](https://wise.com/sg/blog/singapore-payroll-software) | Commercial. Compliance words (CPF, IRAS, AIS, MOM) sit in the titles. | Use the same vocabulary, *truthfully* (see §4). |
| "free payroll software Singapore", "free HR software Singapore" | [Singroll](https://singroll.com/web/pricing) (free for ≤4 staff), [Counto](https://counto.sg/free-payroll-software-guide/) (free for ≤5), [AIMM](https://www.aimmpayroll.com/guides/free-payroll-software-singapore-sme) (free for ≤3), [acciyo](https://www.acciyo.com/free-hr-software-singapore-with-payroll-and-leave-management/), Capterra "free" directory | Price-sensitive micro-SMEs. Every result caps free use at 3–5 employees. | **Best fit.** Crow HR has no headcount cap. Talenox ended its FREE plan on 31 Mar 2026 ([Talenox](https://www.talenox.com/blog/important-talenox-pricing-changes-starting-today-january-5-2026/)), so displaced users are searching now. |
| "CPF payroll", "CPF calculator employer" | Lead-magnet calculators from [QuickHR](https://quickhr.co/cpf-calculator), [Omni HR](https://omnihr.co/?p=17442), [JustLogin](https://ads.justlogin.com/cpf-calculator), [Info-Tech](https://www.info-tech.com.sg/cpf-calculator), plus CPF Board's own pages | Informational to transactional. Employers checking a number. | Ship a free **CPF contribution calculator** page backed by `packages/sg-rules`, showing the working. This is a linkable asset and a demo of accuracy. |
| "open source HR software", "free HRMS", "self-hosted payroll" | Global results: [TechRepublic](https://www.techrepublic.com/article/best-open-source-payroll-software/), [Frappe HR on GitHub](https://github.com/frappe/hrms), [Horilla](https://www.horilla.com/), [OpenHRMS](https://www.openhrms.com/payroll-management/), openalternative.co, alternativeto.net. For "free HRMS open source Singapore", the [OrangeHRM 2012 SG blog post](https://orangehrm.com/resources/blog/orangehrme28099s-singapore-version-is-released/) and Capterra SG open-source directories. | Technical buyers and IT-savvy SME owners. | **Open lane.** No Singapore-specific open-source payroll ranks. Get listed on openalternative.co, alternativeto.net and awesome-selfhosted, and on GitHub topics `hrms`, `payroll`, `singapore`. |
| Brand-alternative queries ("QuickHR alternative", "Talenox alternative") | Competitor comparison pages, e.g. [Swingvy vs Talenox](https://www.swingvy.com/sg/compare/a-better-alternative-to-talenox) | Switchers. | P1: factual comparison pages (see the trademark caution in §4). |

### PAA-style questions to answer on the page or in an FAQ (inferred)

- How much does HR/payroll software cost in Singapore? (cf. [Omni HR FAQ](https://www.omnihr.co/faqs/how-much-does-hr-software-cost-for-a-singapore-business))
- Does HR software in Singapore handle CPF automatically? (cf. [Omni HR FAQ](https://www.omnihr.co/faqs/does-hr-software-in-singapore-handle-cpf-contributions-automatically))
- Is there MOM-approved payroll software? (Answer honestly: MOM does not approve payroll software; see [Wise](https://wise.com/sg/blog/singapore-payroll-software).)
- Is there free HR software in Singapore?
- How do I submit IR8A / what is AIS?
- Can I self-host HR software? Is open-source payroll safe?

## 2. Recommended page copy skeleton

**Title (≤60 chars):** `Free Open-Source HR & Payroll Software for Singapore | Crow HR`
- Fallback, if "free" tests poorly with the brand: `Crow HR: Open-Source Payroll & HR for Singapore SMEs`.

**Meta description (≤155 chars):**
`Run CPF payroll, leave and claims for your Singapore team, free. MIT-licensed, self-hostable, no per-employee fees. Try the live demo.`

**H1:** `Free, open-source HR and payroll for Singapore SMEs`

**H2/H3 outline**
1. **H2 Payroll with CPF worked out, line by line**
   - H3 CPF, SDL and SHG fund contributions by age and residency
   - H3 MOM-compliant itemised payslips
   - H3 CPF EZPay file and bank payout file, ready to upload
2. **H2 Leave and claims your team can do from their phone**
   - H3 Employment Act leave types, proration and Singapore public holidays
   - H3 Claims with receipts, reimbursed through payroll
3. **H2 Year-end IR8A without the scramble**
   - Describe exactly what v1 does: it prepares IR8A/Appendix 8A data for myTax Portal.
4. **H2 Free means free**
   - H3 No per-employee fees, no feature tiers
   - H3 MIT licence: your data, your server
5. **H2 Self-host in minutes, or try the demo in your browser**
   - H3 One container plus Postgres (Docker Compose)
   - H3 Demo with fictional data at hr.crow.sg
6. **H2 Built for how SMEs actually work**
   - Approvals, work-pass expiry reminders, keyboard-first tables.
7. **H2 Crow HR vs typical SaaS payroll**
   - A factual table: price model, hosting, licence, data export. Name no competitor here (see §4).
8. **H2 FAQ**
   - Covers cost, CPF accuracy, IRAS submission, security and PDPA, migration from spreadsheets or another system, and support.

## 3. Target phrases (13)

1. payroll software Singapore
2. free payroll software Singapore
3. HR software Singapore
4. free HR software Singapore
5. CPF payroll software
6. CPF contribution calculator for employers
7. open source HR software
8. open source payroll software
9. self-hosted HR software / self-hosted payroll
10. free HRMS
11. HRMS for SMEs Singapore
12. leave management system Singapore
13. IR8A software / MOM itemised payslip generator

Secondary, for later comparison pages: "Talenox free plan alternative", "QuickHR alternative".

## 4. Claims we must avoid (or only make once true and verified)

| Don't say | Why | Say instead |
| --- | --- | --- |
| "IRAS approved", "IRAS certified", "IRAS endorsed" | IRAS says listing "does not endorse your payroll software" ([IRAS](https://www.iras.gov.sg/digital-collaboration/for-software-developers/payroll-software/how-to-support-ais-submission-as-a-vendor)) | Only once listed: "listed by IRAS as an AIS payroll software vendor for YA20xx". Before that: "prepares IR8A data for submission via myTax Portal". |
| "Submit IR8A directly to IRAS", "AIS-ready" | Needs AIS-API 2.0 onboarding plus #SFFS listing, and we are not listed. | "Exports IR8A/Appendix 8A data." |
| "MOM approved payroll software" | MOM has no approval scheme. The listicle using that phrase only means "generates itemised payslips" ([Volopay](https://www.volopay.com/sg/blog/mom-approved-payroll-software/)). | "Generates payslips with the items MOM requires." |
| "CPF Board approved", "OSP-ready", "submits CPF automatically" | OSP readiness is a government vendor list ([OSP](https://www.onestoppayroll.gov.sg/osp-vendor-listing)), and we are not on it. | "Generates a CPF EZPay file you upload." |
| "PSG/EDGE grant eligible", "IMDA pre-approved" | Only true for listed vendor solutions. It is also irrelevant for a free product. | Omit. |
| "PDPA compliant", "PDPA certified" | Compliance is the deploying organisation's duty. The certification that exists (DPTM) is per organisation. | "Built to help you meet PDPA obligations: role-based access, audit log, NRIC masking." |
| "ISO 27001", "MTCS", "bank-grade security" | We hold no certifications. QuickHR does, so the contrast would be checked. | Describe the concrete controls only. |
| "100% accurate", "guaranteed compliant", "always up to date with the latest rates" | We can't guarantee this, and rates change each January. | "Rates are effective-dated with cited sources. See our test cases." |
| "Singpass login" / "MyInfo" | Not in v1. | Omit until shipped. |
| "Free forever" without qualification | Hosting still costs money. | "Free and open source (MIT). Self-host at no licence cost." |
| Competitor names or logos in ads or headings, "better than QuickHR" | Trademark and comparative-advertising risk. AGENTS rule: no QuickHR branding. | Factual comparison pages, if any, should use sourced statements and no logos. |
| Fake trust signals ("6,800+ companies", testimonials, review stars) | Untrue for a new product. | Show the GitHub repo, the licence and the demo instead. |
