import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { assertNotSelfChange, selfApproval } from "./self-change.ts";

const SELF = "00000000-0000-7000-8000-0000000000c1";
const OTHER = "00000000-0000-7000-8000-0000000000c2";

const stub = defineModule({
  name: "comp-stub",
  basePath: "/comp-stub",
  routes: [
    defineRoute({
      method: "patch",
      path: "/:employeeId/compensation",
      summary: "Update compensation (stub)",
      access: { permission: "compensation:update" },
      crossOrgExempt: "test stub",
      request: { params: z.object({ employeeId: z.uuid() }), body: z.object({ basicPayCents: z.number().int() }) },
      responses: { 204: null },
      handler: ({ c, params }) => {
        assertNotSelfChange(c, params.employeeId, "compensation");
        return undefined;
      },
    }),
  ],
});

describe("self-change guard", () => {
  let t: TestDb;
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createTestDeps>;
  let orgId: string;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps, { modules: [stub] });
    orgId = (await seedOrg(deps)).id;
  });
  afterAll(() => t.close());

  it("payroll_admin changing their own salary → 403 self_change_requires_approval", async () => {
    const http = await clientAs(
      app,
      deps,
      await seedMember(deps, orgId, { roles: ["payroll_admin"], employeeId: SELF }),
    );
    const res = await http.patch(`/api/v1/comp-stub/${SELF}/compensation`, { basicPayCents: 999_999 });
    expect(res.status).toBe(403);
    const { error } = (await res.json()) as ErrorEnvelope;
    expect(error.code).toBe("self_change_requires_approval");
    expect(error.details).toMatchObject({ changeRequestRequired: true });
    expect((await http.patch(`/api/v1/comp-stub/${OTHER}/compensation`, { basicPayCents: 1 })).status).toBe(204);
  });

  it("applies to owners too", async () => {
    const http = await clientAs(
      app,
      deps,
      await seedMember(deps, orgId, { roles: ["owner"], employeeId: "00000000-0000-7000-8000-0000000000c3" }),
    );
    expect(
      (await http.patch("/api/v1/comp-stub/00000000-0000-7000-8000-0000000000c3/compensation", { basicPayCents: 1 }))
        .status,
    ).toBe(403);
  });

  it("lets a sole owner self-approve, flagged; nobody else", () => {
    expect(selfApproval({ roles: ["owner"] }, 0)).toEqual({ allowed: true, flag: "self_approved" });
    expect(selfApproval({ roles: ["owner"] }, 1)).toEqual({ allowed: false });
    expect(selfApproval({ roles: ["payroll_admin"] }, 0)).toEqual({ allowed: false });
  });
});
