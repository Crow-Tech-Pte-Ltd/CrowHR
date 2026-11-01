import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  movableClock,
  seedEmployee,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { totpAt } from "../auth/totp.ts";
import { memberships } from "../db/schema/access.ts";
import type { Mailer } from "../deps.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { createStaticReportingScope } from "./scope.ts";

const PASSWORD = "kaya toast and soft eggs";
const NEW = "attacker chosen passphrase 99";

/** Review findings 2 (admin reset links), 3 (one login per employee) and invitation MFA. */
describe("member access (security review)", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  beforeEach(async () => {
    t = await createTestDb();
    clock.set("2026-10-31T01:00:00Z");
  });
  afterEach(() => t.close());
  const code = async (r: Response) => ((await r.json()) as ErrorEnvelope).error.code;

  describe("admin password-reset links (finding 2)", () => {
    it("hr_admin can no longer take over a member through a reset link", async () => {
      const deps = createTestDeps(t.db, { clock });
      const app = createApp(deps);
      const org = await seedOrg(deps);
      const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
      const target = await seedMember(deps, org.id, { password: PASSWORD });
      const res = await hr.post(`/api/v1/members/${target.membershipId}/password-reset-link`);
      expect(res.status).toBe(403);
    });

    it("needs a recent sign-in", async () => {
      const deps = createTestDeps(t.db, { clock });
      const app = createApp(deps);
      const org = await seedOrg(deps);
      const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }), {
        authenticatedAt: new Date("2026-10-31T00:30:00Z"),
      });
      const target = await seedMember(deps, org.id, { password: PASSWORD });
      const res = await owner.post(`/api/v1/members/${target.membershipId}/password-reset-link`);
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("reauth_required");
    });

    it("refuses targets that hold roles or belong to another organisation (no cross-org takeover)", async () => {
      const deps = createTestDeps(t.db, { clock });
      const app = createApp(deps);
      const a = await seedOrg(deps, { name: "Org A" });
      const b = await seedOrg(deps, { name: "Org B" });
      await seedMember(deps, b.id, { roles: ["owner"], email: "boss@b.example", password: PASSWORD });
      const plainInA = await seedMember(deps, a.id, { email: "boss@b.example" });
      const admin = await seedMember(deps, a.id, { roles: ["payroll_admin"], password: PASSWORD });
      const owner = await clientAs(app, deps, await seedMember(deps, a.id, { roles: ["owner"] }));
      const cross = await owner.post(`/api/v1/members/${plainInA.membershipId}/password-reset-link`);
      expect(cross.status).toBe(409);
      const role = await owner.post(`/api/v1/members/${admin.membershipId}/password-reset-link`);
      expect(role.status).toBe(409);
      // The org-B owner's password still works.
      expect(
        (
          await testClient(app, deps).post("/api/v1/auth/sign-in", {
            org: b.slug,
            email: "boss@b.example",
            password: PASSWORD,
          })
        ).status,
      ).toBe(200);
    });

    it("with SMTP the link goes to the member, never to the owner", async () => {
      const sent: { to: string; text: string }[] = [];
      const mailer: Mailer = { send: async (m) => void sent.push(m) };
      const deps = createTestDeps(t.db, { clock, mailer });
      const app = createApp(deps);
      const org = await seedOrg(deps);
      const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
      const target = await seedMember(deps, org.id, { email: "staff@example.sg", password: PASSWORD });
      const res = await owner.post(`/api/v1/members/${target.membershipId}/password-reset-link`);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { url: string | null; delivery: string };
      expect(body).toMatchObject({ url: null, delivery: "email" });
      expect(sent.at(-1)?.to).toBe("staff@example.sg");
      expect(sent.at(-1)?.text).toMatch(/\/reset\//);
    });

    it("without SMTP the owner gets a one-time link", async () => {
      const deps = createTestDeps(t.db, { clock });
      const app = createApp(deps);
      const org = await seedOrg(deps);
      const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
      const target = await seedMember(deps, org.id, { password: PASSWORD });
      const res = await owner.post(`/api/v1/members/${target.membershipId}/password-reset-link`);
      expect(res.status).toBe(201);
      const { url, delivery } = (await res.json()) as { url: string; delivery: string };
      expect(delivery).toBe("link");
      const token = url.split("/reset/")[1] as string;
      expect(
        (await testClient(app, deps).post("/api/v1/auth/password-reset/complete", { token, password: NEW })).status,
      ).toBe(200);
    });
  });

  describe("one login per employee record (finding 3)", () => {
    it("refuses to invite a second account for an already-linked employee", async () => {
      const deps = createTestDeps(t.db, { clock });
      const app = createApp(deps);
      const org = await seedOrg(deps);
      const victimEmployee = deps.ids.newId();
      await seedMember(deps, org.id, { employeeId: victimEmployee, email: "victim@example.sg" });
      const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
      const res = await hr.post("/api/v1/members/invitations", {
        email: "sock@evil.example",
        displayName: "Sock",
        employeeId: victimEmployee,
      });
      expect(res.status).toBe(409);
    });

    it("the database refuses two non-former memberships for one employee", async () => {
      const deps = createTestDeps(t.db, { clock });
      const org = await seedOrg(deps);
      const employeeId = deps.ids.newId();
      await seedMember(deps, org.id, { employeeId });
      const other = await seedMember(deps, org.id);
      await expect(
        deps.db.update(memberships).set({ employeeId }).where(eq(memberships.id, other.membershipId)),
      ).rejects.toThrow();
      // A former membership does not block a new one (rehire).
      const formerEmployee = deps.ids.newId();
      await seedMember(deps, org.id, { employeeId: formerEmployee, status: "former" });
      await expect(seedMember(deps, org.id, { employeeId: formerEmployee })).resolves.toBeTruthy();
    });

    it("requires an owner to relink a former employee who still holds roles", async () => {
      const deps = createTestDeps(t.db, { clock });
      const app = createApp(deps);
      const org = await seedOrg(deps);
      const employeeId = deps.ids.newId();
      await seedMember(deps, org.id, { employeeId, status: "former", roles: ["payroll_admin"] });
      const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
      const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
      const body = { employeeId, email: "rehired@example.sg", displayName: "Rehired" };
      expect((await hr.post("/api/v1/members/invitations", body)).status).toBe(403);
      expect((await owner.post("/api/v1/members/invitations", body)).status).toBe(201);
    });

    it("only an owner may link an invitation to a manager's employee record", async () => {
      const managerEmployee = "0192f000-0000-7000-8000-00000000aaaa";
      const report = "0192f000-0000-7000-8000-00000000bbbb";
      const deps = createTestDeps(t.db, {
        clock,
        reportingScope: createStaticReportingScope({ [managerEmployee]: [report] }),
      });
      const app = createApp(deps);
      const org = await seedOrg(deps);
      await seedEmployee(deps, org.id, { id: managerEmployee });
      await seedEmployee(deps, org.id, { id: report });
      const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
      const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
      const body = { email: "mgr@example.sg", displayName: "Manager", employeeId: managerEmployee };
      const byHr = await hr.post("/api/v1/members/invitations", body);
      expect(byHr.status).toBe(403);
      expect(
        (await hr.post("/api/v1/members/invitations", { ...body, email: "r@example.sg", employeeId: report })).status,
      ).toBe(201);
      expect((await owner.post("/api/v1/members/invitations", body)).status).toBe(201);
    });
  });

  it("accepting an invitation with an existing TOTP-protected account needs the code", async () => {
    const deps = createTestDeps(t.db, { clock });
    const app = createApp(deps);
    const home = await seedOrg(deps);
    const org = await seedOrg(deps);
    const m = await seedMember(deps, home.id, { email: "accountant@example.sg", password: PASSWORD });
    const web = await clientAs(app, deps, m);
    const { secret } = (await (await web.post("/api/v1/me/mfa/totp/setup")).json()) as { secret: string };
    await web.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(secret, clock.now()) });
    clock.advance(31_000);
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const inv = await owner.post("/api/v1/members/invitations", { email: "accountant@example.sg", displayName: "A" });
    const token = ((await inv.json()) as { inviteUrl: string }).inviteUrl.split("/invite/")[1] as string;
    const anon = testClient(app, deps);
    const inspect = (await (await anon.post("/api/v1/auth/invitations/inspect", { token })).json()) as {
      mfaRequired: boolean;
    };
    expect(inspect.mfaRequired).toBe(true);
    const withoutCode = await anon.post("/api/v1/auth/invitations/accept", { token, password: PASSWORD });
    expect(withoutCode.status).toBe(401);
    expect(await code(withoutCode)).toBe("invalid_mfa_code");
    expect(anon.sessionToken()).toBeUndefined();
    const wrong = await anon.post("/api/v1/auth/invitations/accept", { token, password: PASSWORD, code: "000000" });
    expect(wrong.status).toBe(401);
    const ok = await anon.post("/api/v1/auth/invitations/accept", {
      token,
      password: PASSWORD,
      code: await totpAt(secret, clock.now()),
    });
    expect(ok.status).toBe(200);
  });
});
