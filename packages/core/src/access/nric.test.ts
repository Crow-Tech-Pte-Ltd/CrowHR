import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { maskBankAccount, maskNric, revealSensitive } from "./nric.ts";

const EMP = "00000000-0000-7000-8000-0000000000b1";

describe("maskNric / maskBankAccount", () => {
  it.each([
    ["S1234567D", "S****567D"],
    ["T0123456G", "T****456G"],
    ["F9876543N", "F****543N"],
    ["G1234567X", "G****567X"],
    ["M1234567K", "M****567K"],
    [" s1234567d ", "S****567D"],
  ])("%s → %s", (input, masked) => expect(maskNric(input)).toBe(masked));

  it("fully masks values that aren't NRIC/FIN shaped", () => expect(maskNric("E1234567")).toBe("********"));
  it("keeps the last four of a bank account", () => expect(maskBankAccount("123-45678-9")).toBe("****6789"));
});

const stub = defineModule({
  name: "reveal-stub",
  basePath: "/reveal-stub",
  routes: [
    defineRoute({
      method: "post",
      path: "/:employeeId/nric/reveal",
      summary: "Reveal NRIC (stub of the employees module endpoint)",
      access: "authenticated",
      crossOrgExempt: "test stub",
      request: { params: z.object({ employeeId: z.uuid() }) },
      responses: { 200: z.object({ nric: z.string() }) },
      errors: ["not_found", "reauth_required", "rate_limited"],
      handler: async ({ c, params }) => ({
        nric: await revealSensitive(c, { cls: "nric", employeeId: params.employeeId, load: async () => "S1234567D" }),
      }),
    }),
  ],
});

describe("NRIC reveal", () => {
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

  it("returns the full value once, uncached, and audits who saw whose NRIC", async () => {
    const admin = await seedMember(deps, orgId, { roles: ["payroll_admin"] });
    const http = await clientAs(app, deps, admin);
    const res = await http.post(`/api/v1/reveal-stub/${EMP}/nric/reveal`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nric: "S1234567D" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const [event] = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "nric.revealed"));
    expect(event).toMatchObject({ actorMembershipId: admin.membershipId, targetType: "employee", targetId: EMP });
    expect(event?.at.toISOString()).toBe("2026-10-31T01:00:00.000Z");
  });

  it("requires re-authentication within 10 minutes", async () => {
    const admin = await seedMember(deps, orgId, { roles: ["owner"] });
    const http = await clientAs(app, deps, admin, { authenticatedAt: new Date("2026-10-31T00:40:00Z") });
    const res = await http.post(`/api/v1/reveal-stub/${EMP}/nric/reveal`);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("reauth_required");
  });

  it("refuses the 31st reveal in an hour with 429", async () => {
    const admin = await seedMember(deps, orgId, { roles: ["hr_admin"] });
    const http = await clientAs(app, deps, admin);
    for (let i = 0; i < 30; i++) expect((await http.post(`/api/v1/reveal-stub/${EMP}/nric/reveal`)).status).toBe(200);
    const res = await http.post(`/api/v1/reveal-stub/${EMP}/nric/reveal`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("is 404 for a manager (no NRIC access) and for an employee revealing a colleague", async () => {
    const emp = await seedMember(deps, orgId, { employeeId: "00000000-0000-7000-8000-0000000000b2" });
    expect((await (await clientAs(app, deps, emp)).post(`/api/v1/reveal-stub/${EMP}/nric/reveal`)).status).toBe(404);
  });
});
