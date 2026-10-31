import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { markMembershipFormer } from "./members-routes.ts";

const EMP = "00000000-0000-7000-8000-0000000000d1";

const stub = defineModule({
  name: "former-stub",
  basePath: "/former-stub",
  routes: [
    defineRoute({
      method: "get",
      path: "/payslips/:employeeId",
      summary: "Payslips (stub)",
      access: { permission: "payslips:read" },
      crossOrgExempt: "stub",
      request: { params: z.object({ employeeId: z.uuid() }) },
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: async ({ grant, params }) => {
        await grant.assertEmployee(params.employeeId);
        return { ok: true };
      },
    }),
    defineRoute({
      method: "post",
      path: "/leave/:employeeId",
      summary: "Apply for leave (stub)",
      access: { permission: "leave:create" },
      crossOrgExempt: "stub",
      request: { params: z.object({ employeeId: z.uuid() }) },
      responses: { 201: z.object({ ok: z.boolean() }) },
      handler: async ({ grant, params }) => {
        await grant.assertEmployee(params.employeeId);
        return { ok: true };
      },
    }),
  ],
});

describe("former members (termination hook)", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps, { modules: [stub] });
  });
  afterAll(() => t.close());

  it("drops roles, becomes former, revokes sessions; the leaver can read own payslips but not apply for leave", async () => {
    const org = await seedOrg(deps);
    await seedMember(deps, org.id, { roles: ["owner"] });
    const leaver = await seedMember(deps, org.id, {
      roles: ["payroll_admin"],
      employeeId: EMP,
      password: "a long goodbye phrase",
    });
    const before = await clientAs(app, deps, leaver);
    await markMembershipFormer(deps, deps.db, systemAuditContext(org.id, "system", "lifecycle"), {
      orgId: org.id,
      employeeId: EMP,
    });
    expect((await before.get("/api/v1/me")).status).toBe(401);
    const [m] = await deps.db.select().from(memberships).where(eq(memberships.id, leaver.membershipId));
    expect(m?.status).toBe("former");
    expect(
      await deps.db.select().from(membershipRoles).where(eq(membershipRoles.membershipId, leaver.membershipId)),
    ).toEqual([]);

    const after = await clientAs(app, deps, leaver);
    expect((await after.get(`/api/v1/former-stub/payslips/${EMP}`)).status).toBe(200);
    expect((await after.post(`/api/v1/former-stub/leave/${EMP}`)).status).toBe(403);
    expect((await after.get("/api/v1/members")).status).toBe(403);
    const me = (await (await after.get("/api/v1/me")).json()) as { membershipStatus: string; roles: string[] };
    expect(me).toMatchObject({ membershipStatus: "former", roles: [] });
  });

  it("refuses to remove the last owner (409 last_owner)", async () => {
    const org = await seedOrg(deps);
    const owner = await seedMember(deps, org.id, {
      roles: ["owner"],
      employeeId: "00000000-0000-7000-8000-0000000000d2",
    });
    await expect(
      markMembershipFormer(deps, deps.db, systemAuditContext(org.id, "system", "lifecycle"), {
        orgId: org.id,
        employeeId: owner.employeeId as string,
      }),
    ).rejects.toMatchObject({ code: "last_owner" });
    const [m] = await deps.db.select().from(memberships).where(eq(memberships.id, owner.membershipId));
    expect(m?.status).toBe("active");
  });
});
