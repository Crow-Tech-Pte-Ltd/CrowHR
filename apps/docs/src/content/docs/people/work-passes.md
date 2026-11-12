---
title: Work passes
description: Record work passes for foreign employees in Crow HR and get expiry reminders.
---

Foreign employees (residency "foreigner") need a work pass record valid on their start date before they can be hired.

## Pass types

Employment Pass, S Pass, Work Permit, Dependant's Pass with Letter of Consent, Long-Term Visit Pass with Letter of Consent, Personalised Employment Pass, ONE Pass, Training Employment Pass, or other. In the import template the codes are `EP`, `S_PASS`, `WP`, `DP_LOC`, `LTVP_LOC`, `PEP`, `ONE`, `TEP` and `OTHER`.

Each record has the pass type, the pass number (encrypted at rest), issue and expiry dates, and notes.

## Reminders

HR admins get a reminder on Home and in notifications **90, 60, 30 and 7 days** before a pass expires, and on the expiry date. The 90-day lead is a Crow HR default, not a statutory period. Reminders stop when a newer pass with a later expiry is added.

:::note
Reminders read the **latest** pass of each employee. Record a renewal as a new pass with the new expiry date; editing the old record's dates is not the same.
:::

An expired pass with no later pass shows the employee as **Work pass expired** in the People list.

## Not covered

- Crow HR does not check work-pass eligibility, quotas or the qualifying salaries for passes.
- It does not talk to MOM's systems. Applications and renewals happen in MOM's portals.
- The foreign worker levy shown in payroll is an estimate; see [SHG, SDL and FWL](/docs/payroll/shg-sdl-fwl/#foreign-worker-levy-estimate).
