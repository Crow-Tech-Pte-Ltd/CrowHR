---
title: Employee lifecycle
description: Transfers, promotions, salary changes, probation, resignations, terminations and rehires in Crow HR, with effective dates and checklists.
---

Every change to someone's job or pay is recorded as a **lifecycle event** with the person who made it, an effective date and the records it produced. Use **Record a change** or **Record leaving** on the profile.

| Event | What it does |
| --- | --- |
| Hire | Creates the employment period, job and pay records, the onboarding checklist and the sign-in invitation. |
| Transfer, promotion | New job record (department, team, location, manager, title, schedule…) from the effective date. |
| Salary change | New pay record from the effective date (payroll roles only). |
| Probation confirmed | Records the confirmation. |
| Resignation | Notice date and notice period; computes the last working day. |
| Termination | Reason (dismissal, retrenchment, contract end, retirement, death, mutual agreement) and last working day. |
| Rehire | A new employment period on the same employee, keeping their number and history. |

## Effective dates

Events dated in the future show as **Scheduled** and take effect on the day, computed from the date (Singapore time), not by a background job. A scheduled change can be cancelled, which restores the records before it. Cancelling a scheduled hire or rehire is not supported; record a termination instead.

The People list shows states derived from the dates: "Starts 16 Nov 2026", "Leaving 17 Nov 2026", "Work pass expired".

## Resignations and notice

The notice date counts as day 1. A 30-day notice given on 3 Nov 2026 gives a last working day of 2 Dec 2026. You can agree a shorter last day.

When the contract states no notice period, Crow HR uses the statutory minimum from MOM's rules by length of service: 1 day under 26 weeks, 1 week under 2 years, 2 weeks under 5 years, and 4 weeks from 5 years. Check the employment contract: it usually states the notice period.

## Leaving

Resignations and terminations create the offboarding checklist from the default template. The day after the last working day the person's membership becomes **former**: they can still sign in to read their own released payslips, and nothing else. For the final month's pay, use an off-cycle **final pay** run or include them in the regular run (see [running payroll](/docs/payroll/running-payroll/)).

## Pay changes and finalised payroll

A pay change dated in a month whose payroll is already approved or paid is refused unless you mark it **retroactive**. Crow HR then shows a back-pay warning (`BACKPAY_OWED`) on the next run. The back-pay amount is not computed: enter it as a "Back pay" item on that run.

## Checklists

Owners and HR admins keep onboarding and offboarding checklist templates. Each item has an assignee role (HR admin, payroll admin, manager or the employee) and a due date relative to the start date or the last working day, for example "Issue KETs, HR admin, +14 days". Open items appear on each assignee's Home and can be completed, or skipped with a reason. Cancelling the event that created a checklist cancels the checklist.
