## Context
Issues are produced by the payroll engine (pure, hashed results) and by snapshot steps such as off-day holiday pay. The web app showed their messages but could not act on them.

## Decisions
- **Defaults checked with tests** (`issue-refs.http.test.ts`): a new organisation's allowance types are CPF-liable and pro-rated (CPF treats allowances as ordinary wages; MOM pro-rates salary in an incomplete month), which stays. The gross rate of pay stays unset: MOM includes fixed salary allowances but excludes travelling, food and housing allowances, so any default would be wrong for some allowance and would silently under- or over-pay holiday pay and encashment. What was wrong is when the question was asked: only as a blocker in the first month with a public holiday on an off day, possibly months after go-live. Each run now carries the run-level warning `ALLOWANCE_GROSS_RATE_UNSET` (with the allowance codes) for allowances paid in it, linked to the screen that answers it.
- **Off-day holiday rule stays "pay an extra day"**: the Employment Act lets the employer choose between an extra day's pay and a day off in lieu; switching the default would change pay for existing configurations. Hourly and rostered staff keep a blocking issue, now fixed in the drawer in one step.
- **References, not actions, in the API**: issues gain an optional `ref` (the item, the holiday, the allowance codes). The web app maps code plus `ref` to a fix (`apps/web/.../payroll/-lib/fixes.ts`). Fed overtime keeps its `attendance:<claim ID>` item ID, so a client prices it with `overtimeSourceId`. Results computed before this change have no `ref` and fall back to opening the employee's drawer.
- **Return to draft is not made a re-authenticated route**: the frozen v1.0 contract has no `recentAuth` on it, and adding one would break clients. The web app wraps the call in the re-authentication prompt so it works unchanged if the server ever asks.

## Risks
Adding `ref` and rewording messages changes the stored result of runs with these issues (hashes differ on recompute); such runs are blocked drafts, so no approved figure changes.
