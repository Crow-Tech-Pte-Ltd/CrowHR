## Context
Use the existing leave lock and workflows transaction, and payroll_feed_reservations rather than a second payout reservation system.

## Decisions
- Requests reserve days while pending; approval converts the reservation to a signed encashment ledger movement. Reject/withdraw releases the pending reservation. Existing year-end ledger entries can be submitted once without deducting twice; rejection/withdrawal reverses their movement.
- Snapshot the basic salary and effective schedule on request (last working day for leavers if earlier). Fixed schedules supply workdays/week; shift workers explicitly supply their contractual average workdays/week for the approver to verify. Monthly daily basic rate uses sg-rules dailyRate (12 × basic / 52 / workdays per week); hourly balances use the basic hourly rate. Multiply exact rational rates and round once half up to cents. This implements the explicitly requested basic-salary basis, not a claim to calculate statutory gross-rate termination entitlements.
- Accumulated unused leave is AW, including termination. CPF's unused-leave FAQ says CPF is payable; its termination-benefit exclusion is for compensation unrelated to services, not unused-leave wages. Use the run's pay date as the agreed payout date (clamped to period for existing payroll conventions). Apply existing final-year AW reconciliation in the payroll engine. From 1 Jan 2024, suppress CPF on post-cessation AW when recorded SPR status began after leaving; it remains an AW earning.
- Stable encashment source ids participate in shared feed reservations. Adjustments carry original input items so rate, amount and payable date remain immutable. Bonus-only runs exclude encashments. Approval must precede the run's pay date and period end; approvals after an early pay date wait for the next run.
- Employee requests default off in existing policies. HR/owners can request on behalf; HR/payroll/owner eligibility is enforced by the subject adapter even with a custom manager policy. Beneficiaries cannot approve their own payout.

## Risks
Basic rate is the product request; MOM normally prescribes gross rate for statutory leave encashment, so document this concrete limitation. No external deployment or publication.
