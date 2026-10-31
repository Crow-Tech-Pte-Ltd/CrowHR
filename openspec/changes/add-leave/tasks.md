## 1. Statutory rules (packages/sg-rules)

- [x] 1.1 packages/sg-rules: write `src/leave/*.test.ts` (stillbirth paternity 2 weeks, SPL excluded for stillbirth, paternity rows at 1 Jan 2024 and 1 Apr 2025, SPL 6 → 10 weeks at 1 Apr 2026 incl. EDD rule, GPML 1st vs 3rd child funding, EA maternity, childcare pro-ration table, ECL/GPCL combined cap, infant care 6 → 12 days, adoption infant-age predicate, MOM part-time hour examples) then implement `src/leave/`; `bun run coverage:sg-rules` stays ≥ 95%

## 2. Schema and setup (packages/core)

- [x] 2.1 packages/core: add `db/schema/leave.ts` (types, settings, children, holidays, requests, request days, attachments, ledger; composite org FKs) and the migration; `testing/schema.leave.test.ts` proves org_id everywhere and cross-org FK rejection
- [x] 2.2 packages/core: write the setup case in `testing/schema.leave.test.ts` (lazy, idempotent statutory types) and the settings defaults in `leave/admin.http.test.ts`, then implement `ensureLeaveSetup`

## 3. Calculation

- [x] 3.1 packages/core: write `leave/calendar.test.ts` (PH on Saturday for Mon–Fri; PH on Saturday rest day → Sunday; Sunday PH → gazetted Monday; off-day setting; half days; ad-hoc holiday; shift schedule warning; split across years) then implement the working-day calculator
- [x] 3.2 packages/core: write `leave/entitlement.test.ts` (3-month eligibility and first-year pro-rating; upfront vs monthly accrual; service-year scale and below-statutory refusal; sick steps; part-timer hours; parental per child incl. stillbirth paternity and SPL date rows; childcare per year) and the balance cases in `leave/apply.http.test.ts`, then implement entitlements and balances

## 4. Applications and approvals

- [x] 4.1 packages/core: write `leave/apply.http.test.ts` (quote; insufficient balance; overlap by session; MC required; half days disallowed; on-behalf by HR; concurrent applications racing a balance) then implement quote and apply
- [x] 4.2 packages/core: write `leave/approval.http.test.ts` (manager approves in the engine → ledger taken; reject/withdraw release pending; approval refused when balance no longer covers; cancellation approval restores balance; cancellation rejected keeps approved; HR direct cancel audited) then implement the `leave` and `leave_cancellation` adapters and register the plugin
- [x] 4.3 packages/core: write `leave/visibility.http.test.ts` attachments case (content-type sniffing, size cap, medical visibility: requester/HR/approver yes, colleague 404) then implement attachments

## 5. Views, admin and jobs

- [x] 5.1 packages/core: write `leave/visibility.http.test.ts` calendar case and `leave/outputs.http.test.ts` LeaveCalendar case (manager sees reports' types; colleague sees "On leave" for sensitive types) then implement the team calendar and `LeaveCalendar`
- [x] 5.2 packages/core: write `leave/admin.http.test.ts` (adjustment with audit; policy update with statutory floor; custom type; ad-hoc holiday; settings) then implement admin routes
- [x] 5.3 packages/core: write `leave/year-end.test.ts` (carry-forward cap, Part 4 floor, forfeit, encashment flag, expiry using carried days first, idempotent re-run) then implement the `leave_year_end` transition

## 6. Outputs and access

- [x] 6.1 packages/core: write `leave/outputs.http.test.ts` (unpaid-leave source per date in half days incl. infant care; payroll-input route payroll:read only; government-paid report GPML split and CSV) then implement
- [x] 6.2 packages/core: matrix rows `leave:update`, `leave_claims:read` (matrix.http.test.ts) and one org-B row per leave table in `access/cross-org.test.ts`; both pass

## 7. Web (apps/web)

- [ ] 7.1 apps/web: apply-leave sheet (type, dates, sessions, live day count and balance after, MC upload, child picker), My leave with balances, team calendar, Settings → Leave policies and holidays
- [ ] 7.2 e2e: write `e2e/leave.spec.ts` (apply → manager approves in the Inbox → balance updates → no-pay leave in payroll input) and capture 1440/390 screenshots
