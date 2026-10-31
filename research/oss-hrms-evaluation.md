# Open-source HRMS evaluation: build on, or build from scratch?

Researched 31 Oct 2026.
- Licence and activity data come from the GitHub API on that date (licence SPDX, last push, latest release, commits since 1 Aug 2026, capped at 100 by the query).
- "Commits since 1 Aug" shows *at least* that many when it reads 100.
- This is not legal advice. The licence implications are the standard reading of each licence.

## Summary

**Recommendation: keep "build from scratch in TypeScript, MIT". Borrow ideas, not code.**

- No candidate is both permissively licensed *and* has Singapore payroll.
- Every mature payroll engine is copyleft (GPL-3.0 or AGPL-3.0) or source-available (Elastic-2.0). None ships CPF, SHG, SDL, IR8A or AIS.
- Even the best option (Frappe HR) would still need the hard part built: the CPF and AW-ceiling logic, CPF EZPay files, IR8A, and SG leave rules. It would also force GPL on us, a Python/MariaDB/Redis stack, and an ERP-style UX.

The strongest counter-case is in §3. It only wins if speed to market beats MIT and the decided stack.

## 1. Candidates

| Project | Licence (SPDX) | Stack | Maintenance (31 Oct 2026) | SG payroll / CPF | UX quality | Self-host complexity |
| --- | --- | --- | --- | --- | --- | --- |
| **Frappe HR** ([frappe/hrms](https://github.com/frappe/hrms)) | **GPL-3.0** | Python (Frappe Framework), Vue (Frappe UI), MariaDB, Redis | **Very active**: v16.53.0 released 30 Oct 2026; ≥100 commits since 1 Aug; ~9.0k stars. | **None.** Regional folders exist only for `india` and `united_arab_emirates` ([repo](https://github.com/frappe/hrms/tree/develop/hrms/regional)). A 2014 forum thread asked about CPF with no solution ([discuss.frappe.io](https://discuss.frappe.io/t/singapore-cpf-contribution-on-erpnext/904)). Frappe's Singapore app covers GST, not payroll ([frappe.io/erpnext/singapore](https://frappe.io/erpnext/singapore)). The payroll engine is strong: salary structures, components, additional salary, arrears, payroll corrections, withholding, gratuity, tax slabs ([doctypes](https://github.com/frappe/hrms/tree/develop/hrms/payroll/doctype)). | Good: a modern Vue PWA for employees (leave, check-in, expenses). The admin side is Frappe "Desk", which is dense and form-heavy ERP UI. | **High.** Needs bench, MariaDB 10.8, Redis and Node; the docker-compose uses `frappe/bench:latest`. It is heavy for a 1–50 person SME and conflicts with our in-browser PGlite demo. |
| **ERPNext HR** ([frappe/erpnext](https://github.com/frappe/erpnext)) | **GPL-3.0** | Same as Frappe | Very active (~40.8k stars) | HR and payroll moved out to Frappe HR from v14. ERPNext regional folders cover AU, IT, ZA, TR, UAE and US, with **no SG**. | ERP UX | High (full ERP) |
| **OrangeHRM Starter** ([orangehrm/orangehrm](https://github.com/orangehrm/orangehrm)) | **GPL-3.0** | PHP 8 + Vue 3, MySQL/MariaDB | **Slow**: v5.9 released 28 Jun 2026; **0 commits since 1 Aug**; ~1.2k stars. | **No payroll module at all.** Plugins: Admin, PIM, Leave, Time, Attendance, Recruitment, Performance, Claim, Buzz, Directory ([src/plugins](https://github.com/orangehrm/orangehrm/tree/main/src/plugins)). A 2012 "Singapore version" added NRIC and work-pass fields only ([OrangeHRM blog](https://orangehrm.com/resources/blog/orangehrme28099s-singapore-version-is-released/)). | Clean but dated; decent leave and PIM flows | Low–medium (LAMP) |
| **Odoo Community HR** ([odoo/odoo](https://github.com/odoo/odoo)) | **LGPL-3.0** (core; LICENSE file) | Python, OWL JS, PostgreSQL | Very active | **Payroll (`hr_payroll`) is Odoo Enterprise, not Community.** The SG payroll module `l10n_sg_hr_payroll` (Serpent CS) "requires Odoo Enterprise Edition" and lists at about US$5,014 ([Odoo Apps](https://apps.odoo.com/apps/modules/18.0/l10n_sg_hr_payroll)). Community-side options: [OCA/payroll](https://github.com/OCA/payroll) (**AGPL-3.0**, 124 stars), and ERP Heritage's free `eh_hr_payroll_sg` (LGPL-3; covers CPF by age band with OW/AW ceilings, but **excludes SDL and income tax**, and depends on 4 vendor modules) ([Odoo Apps](https://apps.odoo.com/apps/modules/18.0/eh_hr_payroll_sg)). | Polished, but Odoo is an ERP first | Medium (Postgres + Python). Module dependency hell for payroll. |
| **Horilla** ([horilla/horilla-hr](https://github.com/horilla/horilla-hr)) | **LGPL-2.1** | Python 3.12+ / Django 5.2, server-rendered HTML (HTMX-style), PostgreSQL, Redis | **Active**: 2.2.0 released 21 Oct 2026; ≥100 commits since 1 Aug; ~1.5k stars. v1 is deprioritised in favour of v2. | **None.** It has a generic payroll module (allowances, deductions, from attendance and leave) with no SG statutory rules. | Feature-rich: geofencing, face detection, biometric, onboarding/offboarding, helpdesk, assets, WhatsApp. The UI is busy. | Low–medium (official Docker image `horilla/horilla-hr`, Postgres + Redis + nginx) |
| **IceHrm** ([gamonoid/icehrm](https://github.com/gamonoid/icehrm)) | **Elastic-2.0** from 25 Aug 2026 (was GPL-3.0). Commit "Remove legacy UI and update license" ([history](https://github.com/gamonoid/icehrm/commits/master/LICENSE)) | PHP + JS, MySQL | Active (v36.0.1, Oct 2026) | Generic payroll with country templates (Ghana, Sri Lanka); **no SG** | Modernised UI | Medium |
| **Sentrifugo** ([sapplica/sentrifugo](https://github.com/sapplica/sentrifugo)) | GPL-3.0 | PHP (Zend 1), MySQL | **Abandoned**: last push Jul 2021; no releases | None | Dated | Low, but unmaintained PHP is a security liability |
| **Ever Gauzy** ([ever-co/ever-gauzy](https://github.com/ever-co/ever-gauzy)) | **AGPL-3.0** | **TypeScript** (NestJS + Angular) | Very active (~8.7k stars) | No statutory payroll. It is an ERP/CRM/HRM/ATS/PM platform centred on time tracking. | Broad but generic | High (many services) |
| **Open HRMS** ([CybroOdoo/OpenHRMS](https://github.com/CybroOdoo/OpenHRMS)) | **AGPL-3.0** | Odoo addons | Active | None | Odoo UX | Medium (needs Odoo) |
| Dolibarr ([Dolibarr/dolibarr](https://github.com/Dolibarr/dolibarr)) | GPL-3.0 | PHP | Active | Minimal HR, no payroll engine | ERP | Low–medium |

### What each licence means for an MIT project

| Licence | Can we copy code into Crow HR (MIT)? | Other notes |
| --- | --- | --- |
| **GPL-3.0** (Frappe HR, ERPNext, OrangeHRM, Sentrifugo, Dolibarr) | **No.** Any derivative must be GPL-3.0. | We can study the code and reimplement *ideas* independently, since copyright covers expression, not concepts. Don't transcribe schemas, field lists, strings or UI. Building *on* it would make Crow HR GPL. |
| **AGPL-3.0** (OCA/payroll, Open HRMS, Ever Gauzy) | **No**, and it is stricter. | Network use counts as distribution, so hosted demos and SaaS must offer source. |
| **LGPL-2.1 / LGPL-3.0** (Horilla, Odoo core) | Only as a separately linked library. Copied source files stay LGPL. | Neither is a library we would link from TypeScript. In practice the options are to fork the whole app (and stay LGPL) or to borrow ideas. |
| **Elastic-2.0** (IceHrm ≥ Aug 2026) | **No.** It is source-available, not OSI open source. | It bans offering the software as a managed service and bans removing licence-key checks. It is incompatible with MIT redistribution. Older GPL-3.0 releases remain GPL. |

## 2. SG building blocks we *can* legally reuse

**Code libraries**

| Item | Licence | Status | How to use |
| --- | --- | --- | --- |
| [samliew/singapore-nric](https://github.com/samliew/singapore-nric) (npm `singapore-nric` 2.0.0) | **MIT** | Updated Sep 2026, 11 stars | NRIC/FIN checksum validation and test-data generation for fixtures. It is small enough to vendor with notice, or reimplement (the algorithm is public). Check that the "M"-prefix FIN series (issued from 2022) is handled. |
| [vacanza/holidays](https://github.com/vacanza/holidays) (Python) | **MIT** | Very active, about 2k stars | Cross-check only. It has SG rules, including in-lieu Mondays. Not a runtime dependency (Python). |
| [rjchow/singapore_public_holidays](https://github.com/rjchow/singapore_public_holidays) | **Unlicense** | Small (11 stars) | A CSV/JSON mirror. Prefer the primary data.gov.sg source and use this only to diff. |
| [commenthol/date-holidays](https://github.com/commenthol/date-holidays) | Code ISC; **data CC BY-SA 3.0** | Active | **Avoid bundling its data.** Share-alike would attach to our data files. |
| [GovTechSG/sgds](https://github.com/GovTechSG/sgds) | MIT | — | Reference only. We use the Crow Tech UI kit, and we must not look like a government service. |
| PayNow QR (`paynowqr`, ISC) | ISC | 2020, stale | Not needed for payroll (salaries go by GIRO or FAST). |

**Government data and specifications** (public, but not open-source licensed)

| Item | Licence | Status | How to use |
| --- | --- | --- | --- |
| **MOM public holidays** on data.gov.sg: [2027](https://data.gov.sg/datasets/d_0ba69fc6d56717ff0bf8083c6af3bb84/view), [2026 and consolidated 2020–2026](https://data.gov.sg/dataset/singapore-public-holidays) | **Singapore Open Data Licence v1.0** ([licence](https://data.gov.sg/open-data-licence)) | 2027 dataset updated 3 Jul 2026 | Commercial use, modification and redistribution are allowed. **Attribution notice and licence link required.** We must not imply government endorsement. Sub-licensing is limited, so keep the data in a separate folder with its own NOTICE (not "MIT"). Cross-check against [MOM's page](https://www.mom.gov.sg/employment-practices/public-holidays). |
| **CPF contribution rates and ceilings** ([CPF Board](https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay)) | Government copyright; facts and rates | Changes most Januaries | Encode as effective-dated rule tables with source URL (AGENTS rule 3). Don't copy the PDFs into the repo. |
| **CPF EZPay (FTP) file specification** ([PDF](https://www.cpf.gov.sg/content/dam/web/employer/making-cpf-contributions/documents/CPFEZPayFTPSpecifications.pdf)) | Government publication; no licence stated | **Public.** Effective 16 Jan 2025. 150-byte fixed-width records: header, summary, detail, trailer. CPF accepts payroll-generated files directly. | Implementing the format is fine; cite it and don't redistribute it. This gives v1 a CPF submission path with no vendor onboarding (CPF + SDL + SHG in one file). |
| **IRAS AIS-API 2.0 spec** ([IRAS technical specs](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/technical-file-format-specifications)) | Government publication; access through APEX | Public PDF. **Usage requires vendor onboarding**: register interest by 30 Sep, pass a validation test by 30 Nov, then be listed on #SFFS ([vendor steps](https://www.iras.gov.sg/digital-collaboration/for-software-developers/payroll-software/how-to-support-ais-submission-as-a-vendor)) | YA2027 is closed, so YA2028 is the earliest. **Open question:** how a *self-hosted* open-source product fits a vendor-credential model, since each employer's instance would call APEX. Email `data_mgmt@iras.gov.sg` before investing. v1 alternative: export data matching the **myTax Portal IR8A import template**, which takes up to 200 records per submission ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/submit-employment-income-records)). |
| **One-Stop Payroll (OSP)**: CPF + AIS + MOM OED APIs on APEX ([FAQ](https://www.onestoppayroll.gov.sg/faq/), [vendor list](https://www.onestoppayroll.gov.sg/osp-vendor-listing)) | Government programme | 37 listed vendors, including QuickHR, Talenox, Payboy, HReasily and JustLogin. Swingvy and Employment Hero are absent. | P2 target. Same self-hosting question as AIS. |
| **MOM itemised payslip and KET requirements and templates** ([payslips](https://www.mom.gov.sg/employment-practices/salary/itemised-payslips), [KETs](https://www.mom.gov.sg/employment-practices/contract-of-service/key-employment-terms)) | Government publication | Public | Derive required fields. Design our own layout; don't copy templates verbatim. |
| **Bank GIRO / FAST payroll files**: DBS IDEAL UFF, UOB Infinity, OCBC Velocity | **Not public.** Templates are downloadable only inside each bank's portal ([DBS](https://www.dbs.com.sg/sme/contact-us.page/files-upload-of-universal-file-format)) | UOB is migrating bulk formats to **ISO 20022 XML v3** and UFF ([UOB FAQ](https://www.uob.com.sg/assets/web-resources/pdfs/business/transact/payments/telegraphic-transfers/uob-iso-20022-cbpr-faq.pdf)). OCBC Velocity uses a "GIROFASTWITHINV" upload type (per [Swingvy help](https://help.swingvy.com/knowledge/upload-bank-file-to-singapore-ocbc)). | Get real templates from friendly users' bank portals (no personal data needed, just the blank template). Consider ISO 20022 `pain.001` as a generic path: it is an open standard. |

**No usable open-source CPF calculation library exists.**
- GitHub and npm searches for "CPF singapore" return Brazilian CPF validators, or small unlicensed hobby calculators such as `zionsg/cpf-calculator` and `dudenuk3m/CPF-Calculator`. These have no licence, so copying them is not allowed.
- `packages/sg-rules` is the right call, and it is itself a differentiator: it could be the first well-tested MIT CPF library.

## 3. Challenging our position

**The case for building on Frappe HR (strongest alternative)**
- It is the most mature open payroll engine and very actively maintained, with very frequent releases.
- It already handles salary structures, off-cycle pay, arrears, corrections, expense claims with accounting, a mobile PWA, geolocated check-in, appraisals and onboarding.
- A Singapore localisation app (CPF salary components, SHG, SDL, IR8A print formats, EZPay export) would get a feature-complete product to market faster than a greenfield build.
- Zero SG localisation exists, so we would be first.

**Why it still loses for Crow HR**
1. **Licence.** GPL-3.0 makes Crow HR GPL. That conflicts with the stated MIT goal and with any future proprietary hosting add-ons by Crow Tech.
2. **The hard part isn't saved.** CPF needs age bands by month of birth, citizenship/PR year (graduated rates), OW ceiling per month, the annual AW ceiling of S$102k minus total OW, and specific rounding rules. That cross-period state does not fit Frappe's per-slip formula components. It would be custom Python regardless.
3. **Stack and constraints.** It needs MariaDB, Redis and bench, while we decided on TS, Postgres, Drizzle and Hono. Our static browser demo (PGlite) is impossible with Frappe. Self-hosting is heavier than one app container plus Postgres.
4. **UX.** Frappe Desk is a generic ERP UI. Our differentiation vs QuickHR is precisely calm, task-first UX.

**When to revisit.** If the product lead decides that time-to-first-paying-user under about 3 months matters more than MIT and the decided stack, the fastest path is Frappe HR plus a GPL `crowhr_sg` app. Record that as an explicit OpenSpec decision if taken.

**Rejected outright**
- OrangeHRM: no payroll, and stalling.
- Odoo: payroll is Enterprise-only or AGPL via OCA.
- IceHrm: no longer open source.
- Sentrifugo: dead.
- Ever Gauzy: AGPL and not payroll.
- Horilla: LGPL and Django, no SG; good for feature ideas.

## 4. Ideas worth borrowing (concepts only; reimplement independently)

| From | Idea | Where it lands |
| --- | --- | --- |
| Frappe HR | Separate salary *structure* (template) from *assignment* (employee + effective date + base). "Additional salary" for one-off items. A payroll *entry* (batch) that generates slips. An explicit "payroll correction" document instead of editing finalised slips. | `core` payroll domain model |
| Frappe HR | Holiday lists you can pull per region, plus a leave policy assigned by employee grade | Leave policies |
| OrangeHRM | Leave entitlements as explicit ledger rows (granted, used, adjusted), not a single balance field | Leave ledger, for auditability |
| Horilla | Geofencing and face detection as **optional add-ons, off by default** | Attendance (P1/P2) |
| Horilla | Master-data import covering employees, leave balances and salary structures | Migration wizard, plus YTD opening balances for mid-year switchers |
| Odoo `eh_hr_payroll_sg` | Its scope statement explicitly excludes SDL and income tax, which shows how easily "CPF support" is overclaimed | Our docs: list exactly what is and isn't computed |
