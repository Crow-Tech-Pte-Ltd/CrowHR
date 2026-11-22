## 1. Tests first
- [x] 1.1 `packages/core` workflows: a manager who is an HR admin doesn't get the HR step, can't decide a planted one (single, bulk), and the other HR admins decide; no other HR admin → owners; second owner on a manager-then-owner chain; HR-then-manager chain; a delegate's approval counts; cover, escalation and reassignment skip the earlier approver; sole approver → repeat approval in the chain, the inbox and the audit log; the migration marks in-flight tasks only when nobody else holds the step (`workflows/step-segregation.test.ts`).

## 2. Implementation
- [x] 2.1 `packages/core`: `decideBlocker` position check, `resolveStep` (re-route, then repeat approval) on activation, manager change and member or role removal; escalation, delegation, reassignment and the inbox pass the step; `repeat_approval` column and migration 0022; `repeatApproval` on request detail (`workflows/step-segregation.test.ts`, OpenAPI snapshot).
- [x] 2.2 `apps/web`: the request chain marks a repeat approval (`apps/web` typecheck).

## 3. Documentation
- [x] 3.1 Approvals guide ("One person per step"), roles and permissions, limitations (docs build link check).
