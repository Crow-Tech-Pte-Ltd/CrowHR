## Why

Leave is the most frequent self-service action in a Singapore SME, and the one most often done wrong: first-year pro-rating, hospitalisation leave that includes outpatient days, public holidays on rest days, and a dozen government-paid schemes with date-dependent rules. Payroll (M1) needs no-pay leave days to pro-rate salary, and approvals now exist to route requests. An SME should never have to configure statutory leave by hand.

## What Changes

- **Leave types, preconfigured per organisation:** annual, outpatient sick, hospitalisation (60 days including the outpatient 14), maternity (GPML / EA maternity, employer-paid vs reimbursable weeks), paternity, shared parental, childcare, extended childcare, unpaid infant care, adoption, NS, no-pay leave and a compassionate example. Eligibility predicates and effective dates come from `sg-rules` (new `sg-rules/src/leave/`: stillbirth branches, 1 Jan 2024 and 1 Apr 2025 paternity rows, SPL 6 → 10 weeks on 1 Apr 2026, ECL/infant-care/adoption predicates, NDR 2026 recorded but not applied). Admins add custom types.
- **Policies per type:** entitlement (statutory, fixed, or by years of service, never below statutory), first-year pro-rating, accrual (upfront or monthly), carry-forward cap and expiry (Part 4 employees always carry unused statutory annual leave for 12 months), encashment flag, half days, attachment rule, sensitivity. Part-timers hold annual, sick and hospitalisation leave in hours from the comparable full-timer's hours.
- **Applications:** working-day count from the employee's work schedule (working, half, off and rest days), Singapore public holidays plus ad-hoc holidays, with MOM substitution (Sunday holiday → gazetted Monday for Sunday rest days; holiday on another rest day → next working day; holiday on an off day → setting). Live quote (days and balance after), balance check under a per-employee lock, overlap check by half-day session, MC attachments, child records for parental leave, on-behalf applications by HR.
- **Approvals** through the workflows engine: `leave` and `leave_cancellation` subject adapters; approval writes the ledger in the decision's transaction; cancelling approved leave is itself approved and restores the balance.
- **Views:** my leave and balances, team calendar (reports for managers; colleagues see "On leave" without sensitive types), admin adjustments with audit, holiday list.
- **Year-end job** on the workflows `tick`: carry forward, forfeit beyond the cap, expire carried leave.
- **Outputs:** an unpaid-leave source for payroll pro-ration (per date, half days), a government-paid leave report for manual GPL portal claims (CSV), and the `LeaveCalendar` interface scheduling consumes.
- **Web:** apply-leave sheet, My leave, team calendar, Settings → Leave policies and holidays.

## Capabilities

### New Capabilities
- `leave`: leave types and policies, entitlements and balances, applications and approvals, cancellations, calendar, year-end processing, payroll and government-claim outputs.

### Modified Capabilities
None. `leave` and `leave_cancellation` are subject types the workflows change already names; the permission matrix gains `leave:update` and `leave_claims:read` rows (access-control table "Leave… create/update" and "Reports").

## Non-goals

- Submitting GPL claims to MSF or make-up pay to MINDEF (no public API; we export what to claim).
- Computing leave pay or encashment amounts (payroll owns money; we pass days).
- Service-year (anniversary) leave years. v1 leave year is the calendar year.
- Shift-roster-aware day counting (scheduling, M3); shift schedules count every non-holiday day and say so.
- Time off in lieu, leave bidding, blackout periods, and multi-entity policies.
- The NDR 2026 childcare changes until an effective date is published.

## Impact

- `packages/sg-rules/src/leave/` (new, pure, cited).
- `packages/core`: new `leave/` module, schema `leave.ts` and one migration; workflows plugin registered in `CORE_WORKFLOW_PLUGINS`; matrix rows; `V1_MODULES` line. Registry change: host/test plugins may replace a core subject type (so the workflows test double keeps working).
- `apps/web`: `_app/leave/*`, `_app/settings/leave*`.
- Payroll (WS4) wires `UnpaidLeaveSource` into its run inputs at merge.
