import { and, eq, ne } from "drizzle-orm";
import type { AssignedRole } from "../src/access/matrix.ts";
import { createApp } from "../src/app.ts";
import { memberships } from "../src/db/schema/access.ts";
import type { AppDeps } from "../src/deps.ts";
import { createReportingScopeResolver } from "../src/employees/reports/reporting-scope.ts";
import { seedMember } from "./fixtures.ts";
import { clientAs, type TestClient } from "./http.ts";

/**
 * HTTP harness for people tests: the real app (session middleware, CSRF,
 * authorize(), audit guards) with the real reporting-scope resolver. `as()`
 * seeds a member with the given roles and employee link and signs them in
 * with a real session cookie (lazily, on the first request).
 */
export function createPeopleTestApp(deps: AppDeps) {
  const withScope: AppDeps = { ...deps, reportingScope: createReportingScopeResolver(deps.db) };
  const app = createApp(withScope);

  const wrap = async (res: Response) => {
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    // biome-ignore lint/suspicious/noExplicitAny: test convenience.
    return { status: res.status, body: json as any, headers: res.headers, text };
  };

  return {
    app,
    /** A signed-in member of `orgId` with these assigned roles, linked to `employeeId`. */
    as(orgId: string, roles: AssignedRole[], employeeId: string | null = null, status: "active" | "former" = "active") {
      let client: Promise<TestClient> | null = null;
      const get = () => {
        client ??= (async () => {
          // One live sign-in per employee record (memberships_org_employee_live_unique): signing
          // in "as" an employee retires any earlier test sign-in (or hire invitation) linked to them.
          if (employeeId && status !== "former") {
            await withScope.db
              .update(memberships)
              .set({ status: "former" })
              .where(
                and(
                  eq(memberships.orgId, orgId),
                  eq(memberships.employeeId, employeeId),
                  ne(memberships.status, "former"),
                ),
              );
          }
          const m = await seedMember(withScope, orgId, { roles, employeeId, status });
          return clientAs(app, withScope, m);
        })();
        return client;
      };
      const v1 = (p: string) => `/api/v1${p}`;
      return {
        get: async (p: string) => wrap(await (await get()).get(v1(p))),
        post: async (p: string, b?: unknown) => wrap(await (await get()).post(v1(p), b ?? {})),
        put: async (p: string, b?: unknown) => wrap(await (await get()).put(v1(p), b ?? {})),
        patch: async (p: string, b?: unknown) => wrap(await (await get()).patch(v1(p), b ?? {})),
        del: async (p: string) => wrap(await (await get()).delete(v1(p))),
      };
    },
    anonymous: (path: string) => app.request(`${new URL(deps.publicUrl).origin}/api/v1${path}`),
  };
}

export type PeopleClient = ReturnType<ReturnType<typeof createPeopleTestApp>["as"]>;
