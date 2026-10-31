---
title: Module guide
description: How to add a module to Crow HR's core - routes with defineRoute, org-scoped data access, permissions, audit, approvals and the tests every module adds.
---

A module is a directory under `packages/core/src/<module>/` that exports one `ApiModule`. The full guide with more examples is `docs/architecture.md` ("How to add a module") in the repository.

## Routes

```ts
// packages/core/src/teams/routes.ts
import { z } from "zod";
import { defineModule, defineRoute } from "../http/route.ts";
import { listQuery, pageOf } from "../http/list.ts";
import { AppError } from "../errors.ts";

const team = z.object({ id: z.uuid(), name: z.string(), status: z.enum(["active", "archived"]) });

export const teamsModule = defineModule({
  name: "teams",
  basePath: "/teams", // → /api/v1/teams
  tag: "Teams",
  routes: [
    defineRoute({
      method: "get",
      path: "/:id",
      summary: "Get a team",
      access: { permission: "org_structure:read" }, // a key of MATRIX in access/matrix.ts
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 200: team },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => {
        const found = await getTeam(deps, auth, params.id); // org-scoped query in ./service.ts
        if (!found) throw new AppError("not_found", "That team doesn't exist.");
        return found;
      },
    }),
  ],
});
```

Then add the module to `V1_MODULES` in `packages/core/src/app.ts`, run `bun run openapi:generate` and commit the updated snapshot. Never register raw Hono routes under `/api/v1`: they would be undocumented and invisible to the cross-organisation test.

Rules of the road:

- **`access`** is required: `"public"`, `"authenticated"` (the handler limits itself to the caller's own data) or `{ permission }`. Narrow per record with the grant: `await grant.assertEmployee(row.employeeId)` (404 outside scope) or `grant.employeeFilter(...)` for lists.
- **Sensitive actions** set `recentAuth: true`.
- **Responses** declare every status the handler can produce.
- **Errors** say how to fix the problem; list extra codes in `errors`.
- **Lists** follow the [API conventions](/docs/developers/api-conventions/#lists) via `listQuery` and `pageOf`.
- **Services, not routes,** hold logic and queries, so HTTP, jobs and the CLI share the same rules.

## Data access and audit

```ts
const org = orgScope(deps.db, auth);
const row = await org.getById(employees, params.id, "employee"); // 404 for other organisations
await grant.assertEmployee(row.id);                               // 404 outside team/own scope

await deps.db.transaction(async (tx) => {
  await tx.update(compensation).set(next).where(org.whereId(compensation, id));
  await recordAudit(tx, deps, auditContext(c), {
    action: "compensation.updated", targetType: "employee", targetId: params.id,
    diff: diffFields(before, next, { sensitive: ["amountCents"] }),
  });
});
```

## Schema

One file per area in `packages/core/src/db/schema/`, snake_case columns, UUID primary keys from `deps.ids`, `timestamp with time zone`, money as `bigint` cents in mode `number`. Run `bun run db:generate` and commit `packages/core/drizzle/`. CI fails if the schema and migrations disagree.

## Approvals

A module whose records need approval implements a `SubjectAdapter` (`workflows/types.ts`) and adds a `WorkflowPlugin` to `CORE_WORKFLOW_PLUGINS` in `workflows/registry.ts`. Submit inside the transaction that creates the record; the engine calls `onApproved` / `onRejected` / `onWithdrawn` inside the decision's transaction, so a throwing callback rolls the decision back. Home items come from `InboxSource`s and reminders from `ReminderSource`s on the same plugin.

## Web screens

Routes live in `apps/web/src/routes/_app/<module>.tsx` inside the shell, built from `@crowhr/ui` components. Use `formatMoney(cents)`, `formatDate("YYYY-MM-DD")` and `maskNric`; numbers use the `num` class (Azeret Mono, tabular). Every screen has loading, empty, error and success states.

## Tests every module adds

- **Cross-organisation**: automatic. `access/cross-org.test.ts` calls every non-public route with a path parameter using another organisation's IDs and expects 404. Seed one row of each of your tables for organisation B there.
- **Permission matrix**: adding a key to `MATRIX` adds it to `access/matrix.http.test.ts` automatically, for every role, in and out of scope. Changing a cell is a spec change. The [docs table](/docs/roles-and-permissions/) updates on the next docs build.
- Use `seedOrg`, `seedMember`, `clientAs` and `movableClock` from `@crowhr/core/testing`.
