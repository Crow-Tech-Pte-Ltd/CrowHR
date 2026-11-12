## Why
Four gaps listed under Claims in `docs/limitations.md` make the module harder to trust than it needs to be:

- Owners and HR admins can file a claim for an employee through the API, but the web form only files for yourself, so HR keys in paper claims through curl or not at all.
- The add-claims design promised approvers a warning when a manually typed exchange rate is far from the last rate used in the organisation. It was never built, so a misplaced decimal reaches payroll unnoticed.
- Claim numbers sort as text, so after C-9999 the list and the exports put C-10000 before C-9999.
- A receipt uploaded but never attached to a claim line stays in the file store for good unless the uploader deletes it, which no screen offers.

## What Changes
- **On-behalf filing in the web form** (`apps/web` claims routes): members whose `claims:create` scope is `all` (owners, HR admins) get an employee picker in the claim form, also reachable from All claims and from the "not linked to an employee" state. Eligible types, caps and receipt ownership follow the chosen employee. Editing an on-behalf draft keeps its employee. The server rule (`inScope(claims:create)`) is unchanged and stays the authority.
- **Exchange-rate check** (`packages/core` claims): each non-SGD line of a submitted claim carries `fxWarning` when its rate is more than 20% above or below the last rate used in the organisation for that currency. The last rate used is the rate on the most recently submitted other claim in the same organisation that is still submitted, approved or paid, submitted before this claim, with a line in that currency (its last such line by position). Exactly 20% does not warn. The claim detail page and the approval summary show it. It never blocks.
- **Numeric claim-number order** (`packages/core` claims): every ordering by claim number uses length, then text, so C-10000 follows C-9999 in the list API, the line and payout registers, and the report sources. The web tables sort the same way.
- **Unattached receipt cleanup** (`packages/core` claims, run by `tick`): a `claim_receipt_cleanup` transition deletes claim receipts with no claim-line attachment that were uploaded more than 7 days ago: the row, the bytes and an audit event in the file's organisation. Rows are claimed with `FOR UPDATE SKIP LOCKED` and re-checked in the delete, so concurrent ticks and a receipt being attached at the same moment are safe.

All API changes are additive (`fxWarning` on claim lines). The `/api/v1` 1.0 contract is unchanged.

## Non-goals
- Fetching exchange rates from a feed, or blocking submission on an unusual rate.
- Comparing a line with other lines on the same claim, or with drafts, rejected or withdrawn claims.
- Filing on behalf for managers or payroll admins (the permission matrix is unchanged), and filing overtime on behalf.
- Changing the claim number format or renumbering existing claims.
- A screen listing your own unattached uploads, or a configurable retention period.
- Cleanup of other upload purposes (documents, leave attachments).

## Capabilities
### New Capabilities
### Modified Capabilities
- `claims`: filing on behalf in the web form, exchange-rate warning, claim-number order, unattached receipt cleanup.

## Impact
`packages/core/src/claims` (service, approval summary, reports, report sources, new `fx-check.ts` and `receipt-cleanup.ts`), the claims workflow plugin's tick transitions, the claims web routes and form, the e2e claims specs, the OpenAPI snapshot, `docs/limitations.md` and the user docs for claims and status. No migration.
