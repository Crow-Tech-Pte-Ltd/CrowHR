## Why
A default setup could block payroll with no fix in the web app. Allowances start with no answer for the Employment Act gross rate of pay, and the default off-day holiday rule pays an extra day, so the first month with a public holiday on a Saturday blocked the run (`PH_GROSS_RATE_REQUIRED`) for anyone with an allowance, and for every hourly or rostered employee. Leave encashment was refused the same way, and overtime fed from attendance for staff outside Part 4 or paid by the hour blocked until priced through the API. Returning an approved, unpaid run to draft was API-only too.

## What Changes
- **Allowance treatment screen** (`/payroll/allowances`): CPF liability, pro-ration and gross-rate classification of each allowance type, with guidance and MOM/CPF sources.
- **Ask up front**: every run warns `ALLOWANCE_GROSS_RATE_UNSET` while an allowance paid in it is unclassified, so the answer is given before a holiday or an encashment needs it.
- **Issue references** (additive API field `issue.ref`: `itemId`, `holidayDate`, `holidayName`, `allowanceCodes`) and a link on every blocking issue to the place that fixes it: Allowance treatment, the employee's drawer with the item ready to fill in, the company profile, or the employee's record. Messages name the screen, not the API.
- **Pay-item drawer**: holiday pay for an off-day holiday (`holidayDate`), contractual amounts for fed overtime (`overtimeSourceId`), fed items listed under "From other modules", and editing of manual items.
- **Return to draft** on an approved, unpaid run, with a required reason (and re-authentication if the server asks for it).
- Payroll settings gain the cutoff day.

## Capabilities
### Modified Capabilities
- `payroll-run`: review links each issue to its fix; return to draft in the web app; allowances are classified before they block.

## Non-goals
- Creating allowance types or assigning allowances in the web app (still API).
- Computing holiday pay for hourly or rostered staff (needs contractual daily hours or average workdays; entered by HR).
- Changing the default off-day holiday rule.

## Impact
`packages/core` payroll engine (issue refs), holiday pay, run-level issues, API schema (additive); `apps/web` payroll routes; docs and limitations.
