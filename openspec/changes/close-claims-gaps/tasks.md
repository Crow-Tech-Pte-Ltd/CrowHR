## 1. Claim numbers sort numerically
- [x] 1.1 `packages/core` claims: order by length then text in `listClaims` (`sort=claimNumber`), the line and payout registers (`reports.ts`) and the report sources (`report-source.ts`). Proved by `packages/core/src/claims/claim-number-order.test.ts` (list asc/desc and both registers across C-9999 → C-10000).
- [x] 1.2 `apps/web` claims: the Claim column of My claims and All claims sorts with `compareClaimNumbers`. Proved by `apps/web/src/routes/_app/claims/-lib/claim-number.test.ts`.

## 2. Exchange-rate warning
- [x] 2.1 `packages/core` claims: `fx-check.ts` (threshold, deviation in basis points) and the "last rate used" query. Proved by `packages/core/src/claims/fx-check.test.ts` (exactly 20% up and down, just over, no previous rate, drafts/rejected/withdrawn and same-claim lines ignored, other organisation's rates ignored, most recent by submission time).
- [x] 2.2 `packages/core` claims: additive `fxWarning` on claim lines in `GET /claims/{id}` and a "Exchange rate" row in the approval summary. Proved by `packages/core/src/claims/fx-check.test.ts` (HTTP detail and approval request) and the regenerated OpenAPI snapshot (`bun run openapi:check`).
- [x] 2.3 `apps/web` claims: the claim detail page shows the warning on the line and above the lines. Proved by `e2e/claims-on-behalf.spec.ts`.

## 3. Filing a claim for an employee
- [x] 3.1 `packages/core` claims: regression tests for the existing server rule (types, caps and receipts follow the chosen employee; employees and managers get 404). Proved by `packages/core/src/claims/on-behalf.http.test.ts`.
- [x] 3.2 `apps/web` claims: employee picker in the claim form for `claims:create` scope `all`, eligible types, caps and receipt uploads for the chosen employee, the employee kept when editing an on-behalf draft, "New claim" on All claims and on the unlinked state. Proved by `e2e/claims-on-behalf.spec.ts` (HR without an employee record files for Nadia; Kai Wen defaults to Me; employees see no picker; the form fits 360 px).

## 4. Unattached receipt cleanup
- [x] 4.1 `packages/core` claims: `receipt-cleanup.ts` sweep registered as the `claim_receipt_cleanup` transition of the claims workflow plugin, run by `tick`. Proved by `packages/core/src/claims/receipt-cleanup.test.ts` (older than 7 days deleted with bytes and audit, exactly 7 days kept, draft-attached kept, other purposes kept, other organisation's attached receipts kept, idempotent, two concurrent ticks delete once).

## 5. Documentation and verification
- [x] 5.1 Update `docs/limitations.md` (Claims), `apps/docs/src/content/docs/claims/claims.md` and the "Features without a screen" row of `apps/docs/src/content/docs/status.md`. Proved by `bun run docs:build` (inside `bun run check`).
- [x] 5.2 Run `bun run check`, the web build and `e2e/claims.spec.ts`, `e2e/claim-types.spec.ts` and `e2e/claims-on-behalf.spec.ts` (270 test files, 2,473 tests passed, 2 skipped; OpenAPI current; 83-page docs build and link checks passed; 4 e2e tests passed).
