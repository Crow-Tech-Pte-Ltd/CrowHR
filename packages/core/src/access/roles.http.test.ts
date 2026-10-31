import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import type { ErrorEnvelope } from "../errors.ts";

describe("members and role grants", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
  });
  afterAll(() => t.close());
  const code = async (r: Response) => ((await r.json()) as ErrorEnvelope).error.code;

  it("an owner grants combinable roles (hr_admin + payroll_admin), audited, effective next request", async () => {
    const org = await seedOrg(deps);
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const target = await seedMember(deps, org.id);
    const targetHttp = await clientAs(app, deps, target);
    expect((await targetHttp.get("/api/v1/members")).status).toBe(403);
    const res = await owner.put(`/api/v1/members/${target.membershipId}/roles`, {
      roles: ["hr_admin", "payroll_admin"],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { roles: string[] }).roles.sort()).toEqual(["hr_admin", "payroll_admin"]);
    expect((await targetHttp.get("/api/v1/members")).status).toBe(200);
    const me = (await (await targetHttp.get("/api/v1/me")).json()) as {
      roles: string[];
      permissions: Record<string, string[]>;
    };
    expect(me.roles.sort()).toEqual(["hr_admin", "payroll_admin"]);
    expect(me.permissions["compensation:read"]).toEqual(["all"]);
    const events = await deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, target.membershipId));
    expect(events.filter((e) => e.action === "member.role_granted")).toHaveLength(2);
  });

  it("hr_admin trying to grant payroll_admin → 403 and nothing changes", async () => {
    const org = await seedOrg(deps);
    const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
    const target = await seedMember(deps, org.id);
    const res = await hr.put(`/api/v1/members/${target.membershipId}/roles`, { roles: ["payroll_admin"] });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("forbidden");
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    expect(
      ((await (await owner.get(`/api/v1/members/${target.membershipId}`)).json()) as { roles: string[] }).roles,
    ).toEqual([]);
  });

  it("hr_admin cannot escalate themselves or invite with roles", async () => {
    const org = await seedOrg(deps);
    const hrMember = await seedMember(deps, org.id, { roles: ["hr_admin"] });
    const hr = await clientAs(app, deps, hrMember);
    expect(
      (await hr.put(`/api/v1/members/${hrMember.membershipId}/roles`, { roles: ["hr_admin", "owner"] })).status,
    ).toBe(403);
    expect(
      (await hr.post("/api/v1/members/invitations", { email: "new@x.sg", displayName: "New", roles: ["owner"] }))
        .status,
    ).toBe(403);
    expect((await hr.post("/api/v1/members/invitations", { email: "new@x.sg", displayName: "New" })).status).toBe(201);
  });

  it("hr_admin cannot suspend, reset or touch an owner (privilege escalation via member management)", async () => {
    const org = await seedOrg(deps);
    const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
    const owner = await seedMember(deps, org.id, { roles: ["owner"] });
    await seedMember(deps, org.id, { roles: ["owner"] });
    expect((await hr.post(`/api/v1/members/${owner.membershipId}/suspend`)).status).toBe(403);
    expect((await hr.post(`/api/v1/members/${owner.membershipId}/password-reset-link`)).status).toBe(403);
    expect((await hr.post(`/api/v1/members/${owner.membershipId}/mfa/reset`)).status).toBe(403);
    expect((await hr.post(`/api/v1/members/${owner.membershipId}/sign-out-everywhere`)).status).toBe(403);
  });

  it("the last owner cannot drop the owner role or be suspended (409 last_owner)", async () => {
    const org = await seedOrg(deps);
    const soleOwner = await seedMember(deps, org.id, { roles: ["owner"] });
    const http = await clientAs(app, deps, soleOwner);
    const res = await http.put(`/api/v1/members/${soleOwner.membershipId}/roles`, { roles: ["hr_admin"] });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("last_owner");
    const second = await seedMember(deps, org.id, { roles: ["owner"] });
    const secondHttp = await clientAs(app, deps, second);
    // With a second owner, the first can be demoted...
    expect((await secondHttp.put(`/api/v1/members/${soleOwner.membershipId}/roles`, { roles: [] })).status).toBe(200);
    // ...and then the remaining owner is the last one again.
    expect(await code(await http.put(`/api/v1/members/${second.membershipId}/roles`, { roles: [] }))).toBe("forbidden");
  });

  it("suspending revokes sessions and refuses sign-in; the last owner can't be suspended", async () => {
    const org = await seedOrg(deps);
    const owner = await seedMember(deps, org.id, { roles: ["owner"] });
    const ownerHttp = await clientAs(app, deps, owner);
    const staff = await seedMember(deps, org.id, { password: "satay with peanut sauce", email: "staff-s@example.sg" });
    const staffHttp = await clientAs(app, deps, staff);
    expect((await ownerHttp.post(`/api/v1/members/${staff.membershipId}/suspend`)).status).toBe(200);
    expect(await code(await staffHttp.get("/api/v1/me"))).toBe("session_revoked");
    const signIn = await app.request("https://hr.test/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: org.slug, email: staff.email, password: "satay with peanut sauce" }),
    });
    expect(signIn.status).toBe(401);
    const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
    expect((await hr.post(`/api/v1/members/${owner.membershipId}/suspend`)).status).toBe(403);
    expect(await code(await ownerHttp.post(`/api/v1/members/${owner.membershipId}/suspend`))).toBe("conflict");
  });

  it("lists members with filters and pagination; employees cannot", async () => {
    const org = await seedOrg(deps);
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"], displayName: "Aaron" }));
    for (const n of ["Bala", "Cheryl", "Dinesh"]) await seedMember(deps, org.id, { displayName: n });
    await seedMember(deps, org.id, { displayName: "Esther", status: "suspended" });
    const page = (await (await owner.get("/api/v1/members?pageSize=2&sort=displayName&status=active")).json()) as {
      items: { displayName: string }[];
      total: number;
    };
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.displayName)).toEqual(["Aaron", "Bala"]);
    const search = (await (await owner.get("/api/v1/members?q=cher")).json()) as { items: { displayName: string }[] };
    expect(search.items.map((i) => i.displayName)).toEqual(["Cheryl"]);
    const emp = await clientAs(app, deps, await seedMember(deps, org.id, { employeeId: deps.ids.newId() }));
    expect((await emp.get("/api/v1/members")).status).toBe(403);
  });
});
