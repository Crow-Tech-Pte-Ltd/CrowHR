# QuickHR feature matrix and SG market context

Researched 31 Oct 2026. Public sources only: no logins, no accounts, no forms submitted.

## How to read this

**Evidence status**
- **VERIFIED**: read directly at the linked URL.
- **VERIFIED\***: seen only in a search-engine snippet of the linked page. Capterra, GetApp, G2 and Software Advice block automated reads (HTTP 403), so treat these as indicative.
- **INFERRED**: a reasonable conclusion from adjacent evidence. The reason is given.
- **UNKNOWN**: no public evidence found.

**Note on quickhr.co.** The site is a client-rendered React SPA, so a plain HTTP fetch gets an empty shell. The marketing copy quoted below comes from the site's own published JS bundle (`/assets/index-*.js`, served 31 Oct 2026), and each claim is mapped to the page that renders it (`/sme/payroll`, `/sme/pricing`, and so on). If QuickHR redeploys, the bundle hash and wording may change.

**Priority for Crow HR (SG SME, v1)**
- **P0**: must-have for v1.
- **P1**: next.
- **P2**: later.
- **skip**: not planned.

---

## 1. Feature matrix

| Area | What QuickHR does (public claims) | Evidence | Crow HR priority | Why |
| --- | --- | --- | --- | --- |
| **Employee records & lifecycle** | "Employee Database Organiser (EDO)" profile. It holds identity, role and payroll data. Employment type drives CPF, leave and statutory setup. Salary, allowances and deductions carry effective dates. Supports departments, groups and projects, entity transfers with record continuity, bulk upload for migration and history, captured OED (MOM Occupational Employment Dataset) fields, and stored dependents and documents. ESS edits to personal and bank details go to HR approval. | VERIFIED [sme/hris](https://quickhr.co/sme/hris) | **P0** | Every other module reads from this record. Effective-dated salary and citizenship/PR status drive CPF. |
| Work pass tracking | Not mentioned on current product pages. OrangeHRM-style pass expiry alerts were not found for QuickHR. | UNKNOWN | **P0** (alerts on home screen) | Pass type also drives CPF eligibility (none for foreigners) and FWL. An expired pass is a compliance risk, and our design brief already puts expiring passes on the home screen. |
| **ESS (web)** | Employees apply for leave, submit claims, view and download current and past itemised payslips, download IR8A/tax forms and KETs, and update their own records (subject to HR approval). | VERIFIED [sme/hris](https://quickhr.co/sme/hris), [FAQ](https://quickhr.co/resources/faqs) | **P0** | Self-service is the main reason SMEs leave Excel. |
| **ESS (mobile app)** | Native iOS, Android and Huawei apps. They cover clock-in with GPS and face, leave, claims with receipt photo, payslips, KET/IRAS documents, and manager approvals. Each company enables features per role. Recent releases (per the App Store history) added offline clock-in, better geofencing, claim OCR, AI remarks on leave and claims, Google SSO, Singpass login, and PIN/face app login. | VERIFIED [sme/mobile-app](https://quickhr.co/sme/mobile-app), [App Store](https://apps.apple.com/us/app/quickhr/id1281626091) | **P0 as responsive web/PWA**; native **P2** | A PWA on 360px screens covers the ESS jobs without app-store overhead. Native apps only pay off for kiosk or face clock-in. |
| **Payroll** | Pitched as "run payroll in three clicks": generate, preview, then submit. Approved leave, claims and attendance feed in. Supports monthly and ad-hoc runs for full-time, part-time and freelance staff; runs per entity, department or group; allowances, deductions and loans with effective dates; a configurable multi-level approval chain before submission; off-cycle runs (bonus, final pay, adjustments); proration on policy changes; and an immutable audit log. Payslips are itemised, also available in Mandarin, Malay and Tamil. | VERIFIED [sme/payroll](https://quickhr.co/sme/payroll), [FAQ](https://quickhr.co/resources/faqs) | **P0** | This is the core product. Off-cycle and final pay belong in v1 because resignations happen in month one. |
| **CPF** | CPF applied "automatically by age tier, with correct wage ceilings and AWC capping". QuickHR is on the government One-Stop Payroll (OSP) list, which means it submits CPF contributions via API. | VERIFIED [sme/payroll](https://quickhr.co/sme/payroll), [OSP vendor listing](https://www.onestoppayroll.gov.sg/osp-vendor-listing) | **P0** (calculation and CPF EZPay FTP file). OSP API **P2** | The [CPF EZPay FTP file spec](https://www.cpf.gov.sg/content/dam/web/employer/making-cpf-contributions/documents/CPFEZPayFTPSpecifications.pdf) is public (effective 16 Jan 2025). The OSP API requires vendor onboarding with GovTech APEX. |
| SDL | Says SDL submissions are "handled automatically". | VERIFIED [sme/payroll](https://quickhr.co/sme/payroll) | **P0** | SDL goes on the same CPF submission, so it is cheap to add. |
| FWL | FWL is mentioned only as an obligation ("Payroll in Singapore carries CPF, SDL, FWL…"). No explicit statement that QuickHR computes levy. | INFERRED (likely tracked as an employer cost) | **P0** (cost tracking per pass/tier; no payment) | FWL is billed by MOM, not deducted via payroll. SMEs still want it in labour-cost reports. |
| SHG funds (CDAC/SINDA/MBMF/ECF) | Not mentioned anywhere in current copy. | UNKNOWN (almost certainly supported, since SHG deductions are submitted with CPF) | **P0** | SHG deductions are part of the CPF submission. Competitors such as [Swingvy](https://www.swingvy.com/llms.txt) list them explicitly. |
| **IR8A / AIS** | "IR8A, IR8S, IR21, and appendices filed directly with real-time validation and amendments." IRAS lists QuickHR as an #SFFS Gold partner with a direct AIS API integration (IR8A, A8A, A8B) since YA2021. | VERIFIED [sme/payroll](https://quickhr.co/sme/payroll), [IRAS SFFS listing](https://www.iras.gov.sg/digital-collaboration/for-businesses-employers/sffs-solution-partners/sffs-solution-partners-listing/quickhr) | **P0**: IR8A/A8A data plus export for manual myTax Portal submission. AIS API **P2** | IRAS now accepts software submissions **only via AIS-API 2.0**. It requires vendor registration by 30 Sep and a validation test by 30 Nov each year ([IRAS vendor page](https://www.iras.gov.sg/digital-collaboration/for-software-developers/payroll-software/how-to-support-ais-submission-as-a-vendor)). The YA2027 window has closed, so YA2028 is the earliest. Until then employers use the myTax Portal "Submit Employment Income Records" service, which takes up to 200 records per submission and offers an IR8A import template ([IRAS](https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/submit-employment-income-records)). |
| **Leave** | Leave types with entitlement, accrual, eligibility and blackout rules. Entitlement prorated from the employee profile; shared limits across related types; carry-forward with expiry and conversion; off-in-lieu generated from OT or rest-day work. Half-day and session-based applications; mandatory documents per type; optional no-approval types; backdated applications logged; public holidays applied automatically; team leave calendar; leave deductions shown on payslip. EA statutory types are preset. | VERIFIED [sme/leave-management](https://quickhr.co/sme/leave-management) | **P0** | Leave is the highest-frequency ESS action. Holidays come from [data.gov.sg](https://data.gov.sg/dataset/singapore-public-holidays). |
| **Attendance & time tracking** | Mobile clock-in with GPS geolocation and geofencing, plus face recognition (selfie liveness, "NPU-powered" on the AI page). A shared-device group clock-in and supervisor clock-in for staff without phones. Tablet kiosk with facial recognition. Thermal and biometric devices (Enterprise tier). Late/absent reports. No QR clock-in found. Attendance requires the **Growth** tier. | VERIFIED [sme/time-attendance](https://quickhr.co/sme/time-attendance), [sme/mobile-app](https://quickhr.co/sme/mobile-app), [sme/pricing](https://quickhr.co/sme/pricing). QR: UNKNOWN | **P1** (web/PWA clock-in with optional geolocation). Face/kiosk **P2**. Biometric hardware **skip** | Office SMEs often skip attendance. F&B, retail and cleaning need it, but it is the area with the worst public reviews (see §3), so it is worth doing well rather than fast. |
| **Shift scheduling / rostering** | "Timesheets & Scheduling" in the Growth tier. Approved leave shows on the daily roster, and attendance is checked against schedules. | VERIFIED [sme/pricing](https://quickhr.co/sme/pricing), [sme/time-attendance](https://quickhr.co/sme/time-attendance) | **P1** | Rostering is a key buying reason for shift-based SMEs, where Payboy and Employment Hero compete. It is not needed for office SMEs. |
| **Overtime** | Normal, 1.5x and 2.0x rates calculated "based on MOM guidelines". Says it handles the Part IV (Employment Act) hours, rest-day and OT rules. Managers approve OT and timesheet exceptions on mobile. | VERIFIED [sme/time-attendance](https://quickhr.co/sme/time-attendance) | **P0** for OT pay from entered hours. Auto from timesheets **P1** | Payroll is wrong without OT. MOM: OT is claimable by non-workmen on basic pay ≤ S$2,600 and workmen ≤ S$4,500, at ≥1.5x the hourly basic rate ([MOM](https://www.mom.gov.sg/maintenance/employment-practices/salary/calculate-overtime-pay)). |
| **Claims & expenses** | Submit via web or mobile with receipt upload, several claims in one session, project tagging, and the live entitlement balance shown while submitting. Fixed and variable claim types with GST, CPF and tax settings; spend caps with shared limits; probation-based entitlement; eligibility by department, group or project. Multi-level approval by hierarchy or amount, duplicate-receipt detection, mandatory attachments, co-payment, multi-currency with live FX, custom fields, and petty cash or payroll payout paths. AI OCR fills the form from a receipt photo. | VERIFIED [sme/expense-claims](https://quickhr.co/sme/expense-claims), [sme/ai](https://quickhr.co/sme/ai) | **P0** (submit, approve, pay via payroll, with caps). OCR, FX and co-pay **P1** | Medical, transport and client-entertainment claims are near universal in SG SMEs. The tax treatment flag matters for IR8A. |
| **Benefits** | No benefits-administration module (insurance, flex benefits) on current pages. A UOB/Acc Pro PSG listing mentions "benefits" for the outsourced service only. | UNKNOWN | **P2** | Most SMEs handle benefits outside HR software. Claims caps cover medical/dental benefits. |
| **Onboarding / offboarding** | ATS hand-off creates employee records without re-keying. LMS auto-enrols new joiners by joining date. UOB's bundle lists "on/off-boarding" as a module. IR21 is supported for leavers. | VERIFIED [sme/applicant-tracking](https://quickhr.co/sme/applicant-tracking), [sme/learning-management](https://quickhr.co/sme/learning-management), [UOB page](https://www.uob.com.sg/business/digital/hr-payroll/quickhr.page). Checklist detail: UNKNOWN | **P1** (checklists). Final pay and leaver steps **P0** | Leaver handling (final pay, leave encashment, IR21 flag for foreigners, CPF for the last month) is compliance work. Welcome checklists are nice to have. |
| **Documents / e-letters** | "Report & Document Generator" and "Mail Content Editors" in every tier. UOB's bundle lists a "form generator". Documents are stored per employee. ESS downloads KETs, and the app notifies employees when a document is uploaded. | VERIFIED [sme/pricing](https://quickhr.co/sme/pricing), [sme/hris](https://quickhr.co/sme/hris), [App Store](https://apps.apple.com/us/app/quickhr/id1281626091) | **P1** (KET generator from template, document store). **P0**: store uploaded documents | KETs are mandatory under the Employment Act. Generating them from the record saves SMEs real time. |
| **Appraisals / performance** | Self, 180°, 360°, confirmation, promotion and custom appraisal types. Templates with KPIs, goals, ratings and comments; assignment by department, group or individual; approval routing per appraisal; results feed salary and bonus changes. Enterprise tier only. | VERIFIED [sme/performance-appraisal](https://quickhr.co/sme/performance-appraisal), [sme/pricing](https://quickhr.co/sme/pricing) | **P2** | QuickHR itself puts this in the top tier. SMEs under 50 staff rarely run formal cycles. |
| ATS / recruitment | Job posting to JobStreet (SEEK), LinkedIn and Indeed; screening questions; side-by-side comparison; interview scheduling with calendar sync; offer approval; AI résumé parsing. Enterprise tier. | VERIFIED [sme/applicant-tracking](https://quickhr.co/sme/applicant-tracking) | **skip** (v1) | Not part of the payroll/HR core. Job boards and ATS tools do this better. |
| LMS / training | Courses, quizzes with cut-off marks, sessions with waitlists, certificate expiry alerts. Enterprise tier. | VERIFIED [sme/learning-management](https://quickhr.co/sme/learning-management) | **skip** | Out of scope. Certification expiry can reuse the document-expiry alert pattern. |
| Asset / inventory | "Inventory Management" (assigning and tracking equipment) in the Growth tier. | VERIFIED [sme/pricing](https://quickhr.co/sme/pricing), [FAQ](https://quickhr.co/resources/faqs) | **P2** | Laptop tracking is useful on offboarding, but it is not core. |
| **Reporting & analytics** | Pre-built reports, including leave balance and entitlement, leave by status, pending vs paid claims, late and absent, employee data export by period, GL export to Xero, payroll export to QuickBooks, GL by cost centre, claim limit and balance, claims by category and department, and qualifications. Excel and TXT export. Dashboards, plus an AI assistant ("QBot") for HR questions and summaries. | VERIFIED [sme/reports-analytics](https://quickhr.co/sme/reports-analytics), [sme/ai](https://quickhr.co/sme/ai) | **P0** (statutory and payroll reports plus CSV/XLSX export of every table). Custom report builder **P1** | "Limited custom reporting" is a recurring complaint (§3). |
| **Approval workflows** | Routing follows the reporting structure, and a change of supervisor updates workflows automatically. Multi-level approval with auto-escalation (leave) and amount-based routing (claims); approvals on mobile. The Standard tier has "Workflow & Security Access". The FAQ says *configurable multi-level chains are an Enterprise feature*. | VERIFIED [sme/leave-management](https://quickhr.co/sme/leave-management), [sme/expense-claims](https://quickhr.co/sme/expense-claims), [enterprise/pricing FAQ](https://quickhr.co/enterprise/pricing) | **P0** (manager, then HR fallback, plus delegation while on leave). Multi-level **P1** | One level plus fallback covers most firms under 50 staff. Delegation fixes the "approver is on leave" stall. |
| **Notifications** | App push notifications for approvals, payslips, schedule changes and new documents; email with editable templates ("Mail Content Editors"); SMS (Employment Hero charges per SMS; QuickHR: UNKNOWN). | VERIFIED [sme/mobile-app](https://quickhr.co/sme/mobile-app), [App Store](https://apps.apple.com/us/app/quickhr/id1281626091) | **P0** (email plus in-app). Web push **P1** | Reviewers report push notifications that stopped working (§3), so make in-app the reliable channel. |
| **RBAC** | The legacy FAQ describes two levels: "Super Admin" and user. Current copy covers role-based access by user type, scoped so that employees see their own data, managers their team, and HR everything, plus a full audit trail. *Configurable* roles and audit trails are listed as Enterprise features. SSO and AD sync for Enterprise. | VERIFIED [FAQ](https://quickhr.co/resources/faqs), [sme/hris](https://quickhr.co/sme/hris), [enterprise/pricing FAQ](https://quickhr.co/enterprise/pricing) | **P0** (fixed roles: owner, HR admin, payroll admin, manager, employee; audit log for all). Custom roles **P1** | Payroll data needs separating from HR data even in small firms. An audit log costs little if built in from the start. |
| **Integrations: accounting** | Xero and QuickBooks Online integrations (Growth tier). GL export by cost centre. | VERIFIED [sme/pricing](https://quickhr.co/sme/pricing), [sme/reports-analytics](https://quickhr.co/sme/reports-analytics) | **P1** (Xero/QBO journal CSV). API connectors **P2** | Xero is the dominant SME ledger in SG. A journal CSV import covers it until OAuth apps exist. |
| **Integrations: bank** | GIRO files, FAST and PayNow "supported". UOB host-to-host salary disbursement. | VERIFIED [sme/payroll](https://quickhr.co/sme/payroll), [UOB page](https://www.uob.com.sg/business/digital/hr-payroll/quickhr.page) | **P0** (bank payout file for at least DBS/POSB, plus a generic CSV). OCBC/UOB **P1**. H2H **skip** | Bank formats are *not* publicly specified. Templates live inside DBS IDEAL, UOB Infinity and OCBC Velocity, and UOB is moving formats to ISO 20022 ([UOB FAQ](https://www.uob.com.sg/assets/web-resources/pdfs/business/transact/payments/telegraphic-transfers/uob-iso-20022-cbpr-faq.pdf)). We need sample templates from a user's bank portal. |
| **Integrations: APIs / other** | "Our API supports custom integrations" (Enterprise, scoped during implementation). SSO, AD sync, JobStreet/SEEK, calendar sync, biometric devices. No public API docs found. | VERIFIED (claim) [enterprise/pricing FAQ](https://quickhr.co/enterprise/pricing). API docs: UNKNOWN | **P1** (document our own Hono API; tokens per org) | An open, documented API is a cheap differentiator because QuickHR's is enterprise-only and undocumented. |
| **Mobile apps** | iOS (App Store SG **2.7★ from 78 ratings**; US 4.1★ from 9), Android (**3.9★ from 707 ratings, 50K+ installs**, updated 27 Aug 2026), Huawei AppGallery. | VERIFIED [App Store SG](https://apps.apple.com/sg/app/quickhr/id1281626091), [Google Play](https://play.google.com/store/apps/details?id=com.exceloid_android.quickhrmobileapp&hl=en&gl=SG) | see ESS | Low SG app ratings make mobile a clear opportunity. |
| **Singpass / MyInfo** | Singpass QR login and MFA (launched Apr 2022; app v6.2 Oct 2024). No MyInfo (data pre-fill) integration found. | VERIFIED [press release](https://quickhr.co/resources/press-release/quickhr-transforms-hr-tech-with-singpass-login), [App Store history](https://apps.apple.com/us/app/quickhr/id1281626091). MyInfo: UNKNOWN (likely none) | **P2** (Singpass login). MyInfo **skip** | Singpass login needs a relying-party onboarding with GovTech for each deployment, which is awkward for self-hosted installs. Use passkeys or TOTP for MFA in v1. |
| **Multi-company** | Multi-entity is a headline Enterprise feature, with entity-level access, approval and compliance settings, consolidated reporting, and SG + MY. | VERIFIED [enterprise/hris](https://quickhr.co/enterprise/hris), [FAQ](https://quickhr.co/resources/faqs) | **P1** (multiple UENs/CSNs within one org). Data model in **P0** | Many SMEs run 2–3 related entities, each with its own CSN. Retrofitting the data model later is expensive. |
| Security / compliance badges | ISO 27001, MTCS (SS 584), OSPAR. AWS-hosted in Singapore with AES-256 at rest and TLS 1.2+. PDPA claims. Old FAQ says "IMDA-approved" (this refers to former PSG pre-approval). | VERIFIED (vendor claims) [FAQ](https://quickhr.co/resources/faqs), [App Store](https://apps.apple.com/us/app/quickhr/id1281626091) | n/a | Self-hosters own their own compliance. We cannot claim certifications (see `seo-intent.md`). |
| Languages | UI in English and Mandarin. Payslips in English, Mandarin, Malay and Tamil. | VERIFIED [FAQ](https://quickhr.co/resources/faqs) | **P2** (Mandarin UI, multilingual payslip labels) | English-only is acceptable for v1. Multilingual payslip labels are a cheap later win for blue-collar workforces. |
| **Pricing tiers** | See §4. | VERIFIED | n/a | Crow HR is free, so the gating QuickHR uses is the contrast we can draw. |

### Tier gating at a glance (SME pricing page)

- **Standard**: employee database (EDO); payroll, leave and claims; report and document generator; iOS/Android app; workflow and security access; mail content editors.
- **Growth** (Standard plus): inventory management, attendance tracking, timesheets and scheduling, Xero, QuickBooks.
- **Enterprise** (Growth plus): biometric identification, AI facial-recognition tablet, performance appraisal, ATS, LMS, custom deployment.

Source: [quickhr.co/sme/pricing](https://quickhr.co/sme/pricing). The legacy FAQ used the names Essentials, Enhanced and Enterprise with similar content.

---

## 2. UX structure: what public material shows

All of this is described in our own words. It is thin because the in-app user guide (`sg.quickhr.co/guide/`) redirects to login, and no public QuickHR walkthrough videos were found. The official YouTube channel exists but search surfaced no tutorials.

- **Two audiences in marketing.** The site splits into `/sme/*` and `/enterprise/*` versions of every module page with the same features framed differently. Multi-entity, configurable approvals, custom roles, SSO and APIs are pushed to Enterprise ([enterprise/pricing FAQ](https://quickhr.co/enterprise/pricing)).
- **Navigation (web portal).** The portal opens on a dashboard. A collapsible right-hand panel holds the user's profile (view/edit, change password) and the link to the help guide. Work is organised by module tabs: Employee Database, Leaves, Claims, Payroll, Timesheets/Attendance, Reports, plus the higher-tier modules ([FAQ](https://quickhr.co/resources/faqs)). INFERRED: this is module-first navigation, not task-first.
- **Leave flow.** The employee opens Leaves and applies. The same module shows application status, company holidays and remaining balance. Balance appears as entitlement, used, pending and rejected. Approval routes up the reporting line, with escalation if it stalls. Once approved, the balance updates and any deduction shows on the payslip ([sme/leave-management](https://quickhr.co/sme/leave-management)).
- **Claims flow.** The employee opens Claims and chooses Apply. They pick a claim type and enter description, amount and date, then attach the receipt. Remaining entitlement is visible while filling the form. Several claims can go in one sitting. Approval goes by hierarchy or amount, and duplicate receipts are blocked before approval. Approved claims are paid with the next payroll and itemised on the payslip ([FAQ](https://quickhr.co/resources/faqs), [sme/expense-claims](https://quickhr.co/sme/expense-claims)).
- **Payroll run flow (as marketed).**
  1. Generate the run for an entity, department or group. Approved leave, claims and attendance are pulled in automatically.
  2. Preview, with net pay checked before submission.
  3. Pass the run through an optional multi-level sign-off chain.
  4. Submit. This releases payslips (push notification to employees), produces the bank file or UOB H2H instruction, and makes the CPF/IRAS data available.
  - Off-cycle runs exist separately for bonus, final pay and corrections ([sme/payroll](https://quickhr.co/sme/payroll)).
  - UNKNOWN: whether a run can be reopened after submission, how retro adjustments are entered, and whether the CPF breakdown per employee is visible before finalising.
- **Approvals.** Approvers are derived from the org structure, not configured per request. A supervisor change re-routes pending items. Approvals can be given on mobile. Some leave types can be set to need no approval.
- **Mobile.** The app is the same system, not a companion. Features show according to role and what the company has enabled ([App Store](https://apps.apple.com/us/app/quickhr/id1281626091)). The clock-in flow blocks devices with developer options or VPN switched on, according to a developer reply to a review ([Google Play](https://play.google.com/store/apps/details?id=com.exceloid_android.quickhrmobileapp&hl=en&gl=SG)).
- **Onboarding to QuickHR itself.** Standard and Growth are self-serve with a 14-day trial (no credit card). The vendor says most teams are running payroll within a day. Data migration of records, leave balances and payroll history is supported on all plans ([sme/pricing FAQ](https://quickhr.co/sme/pricing)). The legacy FAQ lists one-time fees for setup, training and migration.

---

## 3. What users say (UX opportunity list)

The review pool is small: about 13 reviews each on Capterra, GetApp and Software Advice, and about 2 on G2. App-store reviews are the larger, harsher sample. Vendor-curated testimonials on quickhr.co are excluded.

### Complaints

| Theme | Evidence | Opportunity for Crow HR |
| --- | --- | --- |
| **Clock-in fails because of GPS or network** | Android reviews: location "can't be detected", clock-in fails "half the time", wrong postcode shown, and simultaneous clock-ins failing ([Google Play](https://play.google.com/store/apps/details?id=com.exceloid_android.quickhrmobileapp&hl=en&gl=SG)). The vendor added offline clock-in and "improved geo-fencing" in v7.8 (Apr 2026), which suggests a known problem ([App Store](https://apps.apple.com/us/app/quickhr/id1281626091)). | Geofence as a *flag*, not a hard block. Record the accuracy radius, queue punches offline, and show a clear "pending location" state with manager review. |
| **Strict device checks** | The app refuses to run with developer options on, and the vendor says VPN and developer-option prompts appear at clock-in ([Google Play](https://play.google.com/store/apps/details?id=com.exceloid_android.quickhrmobileapp&hl=en&gl=SG)). | Make anti-spoofing a per-org policy, and explain to the user why a punch was flagged. |
| **Login and notification glitches** | "Error email", "wrong password" popups; push notifications stopped after an update; team calendar showing "No Data Found" for one user ([App Store SG](https://apps.apple.com/sg/app/quickhr/id1281626091), [Google Play](https://play.google.com/store/apps/details?id=com.exceloid_android.quickhrmobileapp&hl=en&gl=SG)). The SG iOS rating is 2.7★. | Use a web/PWA first, with in-app inbox as the reliable channel and push or email as extras. Test empty and error states. |
| **Payroll accuracy and "semi-auto"** | "A lot of room to improve in the payroll module"; "semi-auto"; auto-calculation "sometimes not accurate" compared with government calculators for employee contributions ([Capterra SG](https://www.capterra.com.sg/reviews/180277/quickhr), VERIFIED\*). | Show CPF *workings* per employee: age band, OW/AW, ceiling used, rounding. Publish test vectors against CPF Board tables. |
| **Limited custom reporting** | "Limited advanced reporting & analytics"; enough for mandatory reports but limited for management review; analytics "not very well integrated" ([Capterra SG](https://www.capterra.com.sg/reviews/180277/quickhr), [G2](https://www.g2.com/products/quickhr/reviews), VERIFIED\*). | Make every table filterable and exportable (CSV/XLSX). Add saved views. Allow direct SQL/BI access when self-hosted. |
| **Timesheet module inflexible** | Timesheet module "not very flexible and thus difficult to use sometimes" ([G2](https://www.g2.com/products/quickhr/reviews), VERIFIED\*). | Keep timesheet edits inline and spreadsheet-like, with a reason captured for each manual change. |
| **Support reachability** | Hard to get in touch, and a promised callback did not come for a week (Jun 2024). A 1★ review criticises support and says new modules cost extra ([Capterra SG](https://www.capterra.com.sg/reviews/180277/quickhr), VERIFIED\*). | Searchable docs, an in-product guide, a resettable demo, and public issue tracking. |
| **Learning curve and paid extras** | Extra training was needed to use more features. Setup, training and migration fees are unclear ([GetApp](https://www.getapp.sg/software/2052724/quickhr), VERIFIED\*; [hr.software](https://www.hr.software/reviews/quickhr)). | Offer every module free, with an import wizard that includes opening YTD balances. |

### Praise

| Theme | Evidence |
| --- | --- |
| Easy to use and quick to set up, with no extra training needed for basics | Ease of use 4.3/5 on GetApp and Software Advice ([GetApp](https://www.getapp.sg/software/2052724/quickhr), [Software Advice](https://www.softwareadvice.com/hr/quickhr-profile/), VERIFIED\*) |
| Leave and claims on the go; staff access their own payslips | Positive App Store SG reviews from Dec 2023 ([App Store SG](https://apps.apple.com/sg/app/quickhr/id1281626091)); Capterra snippets |
| Facial-recognition clock-in "really works" | 2020 App Store reviews ([App Store](https://apps.apple.com/us/app/quickhr/id1281626091)) |
| SME-focused pricing, PSG grant support, local support | Capterra snippets (VERIFIED\*) |
| Good support (on balance) | GetApp customer support 4.4/5 (VERIFIED\*) |

---

## 4. Pricing (as of 31 Oct 2026)

All prices are per employee per month, in SGD, and labelled "From" with a "Get Quote" button. GST is extra.

| Tier | Price | Notes |
| --- | --- | --- |
| Standard | **S$5** | No minimum headcount, no fixed term, billed on active employees each month. |
| Growth | **S$10** | Adds attendance, scheduling, Xero, QuickBooks and inventory. Marked "popular". |
| Enterprise | **from S$15** | Custom pricing. The FAQ says there is "no fixed per-seat rate". |
| Promo | **S$1** | Introductory rate for new sign-ups for a limited period. Covers core payroll, leave and claims; full price applies afterwards. |
| Trial | 14 days | No credit card. |

Sources: [quickhr.co/sme/pricing](https://quickhr.co/sme/pricing), [quickhr.co/enterprise/pricing](https://quickhr.co/enterprise/pricing).

Other pricing evidence:
- **UOB BizSmart bundles:** from S$1, S$3 and S$9 per employee per month, each with 6 months free. One-time setup and training fees apply. A PSG package costs from S$2,700, with a minimum of 10 employees and a 12-month term ([UOB](https://www.uob.com.sg/business/digital/hr-payroll/quickhr.page)).
- **Grants:** QuickHR now markets the **EDGE grant** (the 2026 consolidation of EDG, PSG and MRA): up to 50%, capped at S$10,000, for HRMS for eligible SMEs ([sme/pricing FAQ](https://quickhr.co/sme/pricing)).
- **Third-party figures:** TrustRadius lists $2 and $4 tiers, which look stale or USD ([TrustRadius](https://www.trustradius.com/products/quickhr/pricing)).
- **Worked example:** a 20-person SME on Growth pays about S$200/month (S$2,400/year) before GST, setup fees and grant.

---

## 5. Market context: other SG players

**Talenox** (Singapore). It is known for a clean payroll engine with CPF and IR8A handling. It is on the OSP list, so it submits CPF and AIS via API ([OSP](https://www.onestoppayroll.gov.sg/osp-vendor-listing)). SUITE (payroll + leave) is S$40 for the first 5 employees, then S$8 per full-timer and S$4 per part-timer, before GST ([Talenox help](https://help.talenox.com/en/articles/8679724-pricing-plans-for-singapore)). Talenox **sunset its FREE plan**: SG and MY free accounts went view-only on 31 Mar 2026 ([Talenox blog](https://www.talenox.com/blog/important-talenox-pricing-changes-starting-today-january-5-2026/)). That leaves a gap for genuinely free SME payroll, which Crow HR can occupy.

**Swingvy** (Malaysia-based, Samsung-backed). It is praised for a modern UI and modular "make your own plan" pricing. It covers SHG funds, SDL and IR8A, plus shift scheduling and mobile clock-in ([Swingvy llms.txt](https://www.swingvy.com/llms.txt)). Payroll is an add-on at S$5 per employee per month on top of Premium ([Swingvy payroll](https://www.swingvy.com/sg/products/payroll)). Swingvy is **not on the OSP vendor list**, so assume no direct CPF or AIS API submission.

**Payboy** (Singapore). It is favoured by F&B, retail and construction for rostering and complex pay schemes, and it is OSP-listed. Pricing is pay-per-module per active employee (about S$3.50 per module before GST, per third-party listings; not verified with the vendor) ([listicler](https://listicler.com/tools/payboy), [Payboy pay schemes](https://support.payboy.biz/en/articles/2095388-pay-schemes)). QuickHR gap: Payboy sells rostering as its own module, while QuickHR gates scheduling behind the Growth tier.

**HReasily** (Singapore). It is cited as the budget option: payroll from about S$4.30 per employee per month, or about S$10 for the full bundle (third-party figures). It is OSP-listed and has a strong Xero marketplace presence with a 14-day trial ([Xero App Store](https://apps.xero.com/sg/app/hreasily), [Aspire](https://aspireapp.com/sg/blog/payroll-software-for-small-business/)).

**JustLogin** (Singapore). It runs a broad suite on quote-based pricing (entry about S$5 per user, unverified), is OSP-listed, and pushes CPF, IRAS AIS and MOM compliance hard in search ([JustLogin](https://justlogin.com/payroll-software/)).

**Employment Hero** (Australia; strong SG presence). Payroll costs S$6 or S$8 per employee per month with S$120 or S$160 monthly minimums. Its rostering is the strongest of the group: shift swapping and bidding, budgeting, and iPad or mobile clock-in with image capture ([EH comparison](https://employmenthero.com/sg/comparison-table-payroll/)). It is **not on the OSP list**.

**Deel** rarely appeared as an SG SME *payroll* pick in the 2026 SERPs. It shows up for cross-border EOR and contractor payments, which is not our segment.

**Free tiers that do exist:**
- Singroll: free for 4 or fewer employees ([pricing](https://singroll.com/web/pricing)).
- Counto: free for up to 5 employees, bundled with its accounting ([guide](https://counto.sg/free-payroll-software-guide/)).
- AIMM: claims a permanent free tier for 3 employees ([guide](https://www.aimmpayroll.com/guides/free-payroll-software-singapore-sme)).

None of these is open source or self-hostable.

**Feature expectations QuickHR under-serves for SMEs:**
- Rostering and attendance available without a tier jump.
- Transparent pricing with no setup fees.
- A documented open API.
- Flexible reporting.
- A mobile experience SG users rate well.
