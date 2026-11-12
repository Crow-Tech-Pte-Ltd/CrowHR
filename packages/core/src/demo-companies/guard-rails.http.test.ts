import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestDeps,
  movableClock,
  seedMember,
  seedOrg,
  type TestClient,
  type TestDb,
  testClient,
  testDemoCompanies,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { requireRecentAuth } from "../auth/guards.ts";
import type { AppContext } from "../context.ts";
import { orgSecuritySettings, ssoProviders } from "../db/schema/auth.ts";
import { emailOutbox } from "../db/schema/notifications.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { Mailer } from "../deps.ts";
import { inviteHiredEmployee } from "../employees/ports.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { tick } from "../jobs/tick.ts";
import { NOT_IN_DEMO_COMPANY } from "./config.ts";

/**
 * Guard rails in a demo company (demo-companies "Guard rails", design decision 7): the server
 * refuses sign-in and security changes, SSO, invitations, passwords and MFA with 403, sends no
 * email, limits uploads, and records the platform instead of a device's own name (sign-in test).
 */
const START = "2026-11-10T02:15:00.000Z";

describe("demo companies: guard rails", () => {
  let t: TestDb;
  const clock = movableClock(START);
  const sent: { to: string; subject: string }[] = [];
  const mailer: Mailer = {
    send: async (m) => {
      sent.push({ to: m.to, subject: m.subject });
    },
  };
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let slug: string;
  let orgId: string;
  let people: { membershipId: string; email: string; persona?: { key: string } }[];

  const build = (quota?: number) => {
    deps = createTestDeps(t.db, {
      clock,
      mailer,
      demoCompanies: testDemoCompanies(() => deps, quota ? { uploadQuotaBytes: quota } : {}),
    });
    app = createApp(deps);
  };

  beforeEach(async () => {
    clock.set(START);
    sent.length = 0;
    t = await createTestDb();
    build();
    slug = ((await (await testClient(app, deps).post("/api/v1/demo-companies", {})).json()) as { slug: string }).slug;
    const [org] = await t.db.select().from(organisations).where(eq(organisations.slug, slug));
    orgId = org?.id as string;
    people = ((await (await app.request(`/api/v1/auth/demo/personas?org=${slug}`)).json()) as { items: typeof people })
      .items;
  });
  afterEach(() => t.close());

  const as = async (key: string): Promise<TestClient> => {
    const p = people.find((x) => x.persona?.key === key);
    const client = testClient(app, deps);
    const res = await client.post("/api/v1/auth/demo/sign-in", { membershipId: p?.membershipId, org: slug });
    expect(res.status).toBe(204);
    return client;
  };
  const membershipOf = (key: string) => people.find((x) => x.persona?.key === key)?.membershipId as string;
  const refused = async (res: Response) => {
    expect(res.status).toBe(403);
    const error = ((await res.json()) as ErrorEnvelope).error;
    expect(error.code).toBe("disabled_in_demo");
    expect(error.message).toBe(NOT_IN_DEMO_COMPANY);
    expect(error.message.startsWith("Not available in a demo company")).toBe(true);
  };

  it("refuses changes to the sign-in methods and security settings, and nothing changes", async () => {
    const owner = await as("owner");
    const [before] = await t.db.select().from(orgSecuritySettings).where(eq(orgSecuritySettings.orgId, orgId));
    await refused(await owner.patch("/api/v1/security/settings", { passwordEnabled: false }));
    await refused(await owner.patch("/api/v1/security/settings", { mfaRequiredRoles: ["owner"] }));
    const [after] = await t.db.select().from(orgSecuritySettings).where(eq(orgSecuritySettings.orgId, orgId));
    expect(after).toEqual(before);
    // Reading them is fine.
    expect((await owner.get("/api/v1/security/settings")).status).toBe(200);
  });

  it("refuses adding, changing and removing single sign-on providers", async () => {
    const owner = await as("owner");
    await refused(
      await owner.post("/api/v1/security/providers", {
        kind: "google",
        displayName: "Google",
        clientId: "x",
        clientSecret: "y",
        allowedDomains: ["example.com"],
      }),
    );
    const id = deps.ids.newId();
    await refused(await owner.patch(`/api/v1/security/providers/${id}`, { enabled: false }));
    await refused(await owner.delete(`/api/v1/security/providers/${id}`));
    expect(await t.db.select().from(ssoProviders).where(eq(ssoProviders.orgId, orgId))).toEqual([]);
  });

  it("refuses invitations, and a hire is never turned into an invitation", async () => {
    const owner = await as("owner");
    const count = (await t.db.select().from(users)).length;
    await refused(
      await owner.post("/api/v1/members/invitations", { email: "someone@real.example", displayName: "Someone" }),
    );
    await refused(await owner.post(`/api/v1/members/${membershipOf("employee")}/invitation/resend`, {}));
    const hire = await inviteHiredEmployee(
      deps,
      { orgId, employeeId: deps.ids.newId(), email: "real.person@real.example", displayName: "Real Person" },
      systemAuditContext(orgId, "system", "test"),
    );
    expect(hire.status).toBe("skipped");
    expect(hire.message).toContain("Demo companies don't send invitations");
    expect((await t.db.select().from(users)).length).toBe(count);
  });

  it("refuses password, reset and two-step verification changes, for oneself and for others", async () => {
    const employee = await as("employee");
    await refused(
      await employee.post("/api/v1/me/password", { currentPassword: "x", newPassword: "a long new password" }),
    );
    await refused(await employee.post("/api/v1/me/mfa/totp/setup", {}));
    await refused(await employee.post("/api/v1/me/mfa/totp/confirm", { code: "123456" }));
    await refused(await employee.post("/api/v1/me/mfa/recovery-codes", {}));
    await refused(await employee.delete("/api/v1/me/mfa"));
    const owner = await as("owner");
    const target = membershipOf("employee");
    await refused(await owner.post(`/api/v1/members/${target}/password-reset-link`, {}));
    await refused(await owner.post(`/api/v1/members/${target}/mfa/reset`, {}));
    await refused(await owner.post(`/api/v1/members/${target}/sign-out-everywhere`, {}));
    // The public reset request too (no account here has a password, and no email goes out).
    const reset = await testClient(app, deps).post("/api/v1/auth/password-reset/request", {
      org: slug,
      email: people[0]?.email,
    });
    await refused(reset);
    expect(sent).toEqual([]);
    const [u] = await t.db
      .select()
      .from(users)
      .where(eq(users.email, people[0]?.email as string));
    expect(u?.passwordHash).toBeNull();
  });

  it("refuses switching organisation from a demo company", async () => {
    const owner = await as("owner");
    await refused(await owner.post("/api/v1/auth/switch-organisation", { org: "anything" }));
  });

  it("sends no email: requests run without the mailer and anything queued is suppressed", async () => {
    const owner = await as("owner");
    const me = (await (await owner.get("/api/v1/me")).json()) as { mailerConfigured: boolean };
    expect(me.mailerConfigured).toBe(false);
    // Something queued for the demo company (e.g. by a scheduled reminder) never goes out, while a
    // real organisation's email on the same server still does.
    const real = await seedOrg(deps, { slug: "real-co" });
    const now = clock.now();
    for (const [org, to] of [
      [orgId, people[0]?.email as string],
      [real.id, "owner@real.example"],
    ] as const) {
      await t.db.insert(emailOutbox).values({
        id: deps.ids.newId(),
        orgId: org,
        toAddress: to,
        kind: "task_assigned",
        payload: { headline: "Hello", linkPath: "/" },
        status: "queued",
        nextAttemptAt: now,
        createdAt: now,
      });
    }
    await tick(deps, now);
    expect(sent.map((m) => m.to)).toEqual(["owner@real.example"]);
    const rows = await t.db.select().from(emailOutbox).where(eq(emailOutbox.orgId, orgId));
    expect(rows.map((r) => r.status)).toEqual(["suppressed"]);
  });

  it("refuses uploads past the demo company's quota with a message naming the limit", async () => {
    build(1024 * 1024);
    const employee = await as("employee");
    const png = new Uint8Array(1024 * 1024 + 1);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const res = await employee.request("/api/v1/claims/receipts?fileName=big.png", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: png,
    });
    expect(res.status).toBe(413);
    const error = ((await res.json()) as ErrorEnvelope).error;
    expect(error.code).toBe("file_too_large");
    expect(error.message).toContain("A demo company can hold 1 MB of uploads");
  });

  it("doesn't ask a demo company's people to re-enter a password they don't have", () => {
    const at = (auth: unknown) =>
      ({
        get: () => auth,
        var: { deps: { clock: { now: () => new Date("2026-11-10T03:00:00Z") } } },
      }) as unknown as AppContext;
    const session = { authenticatedAt: new Date("2026-11-10T02:00:00Z") };
    expect(() => requireRecentAuth(at({ session, demoCompany: { expiresAt: new Date() } }))).not.toThrow();
    expect(() => requireRecentAuth(at({ session, demoCompany: null }))).toThrow(/confirm it's you/);
  });

  it("never writes a demo company's UEN to the organisation (it is unique on the server)", async () => {
    const owner = await as("owner");
    const res = await owner.put("/api/v1/organisation/profile", {
      legalName: "Kopi Kaki Pte. Ltd.",
      uen: "201912345K",
      csn: "201912345KPTE01",
      addressBlock: "1",
      addressStreet: "Tanjong Pagar Plaza",
      postalCode: "082001",
    });
    expect(res.status).toBe(200);
    const [org] = await t.db.select().from(organisations).where(eq(organisations.id, orgId));
    expect(org?.uen).toBeNull();
    // A real organisation can still take that UEN.
    const real = await seedOrg(deps, { slug: "real-co" });
    const realOwner = await seedMember(deps, real.id, { roles: ["owner"], password: "correct horse battery" });
    const http = testClient(app, deps);
    await http.post("/api/v1/auth/sign-in", {
      org: real.slug,
      email: realOwner.email,
      password: "correct horse battery",
    });
    const saved = await http.put("/api/v1/organisation/profile", {
      legalName: "Real Co Pte. Ltd.",
      uen: "201912345K",
      csn: "201912345KPTE01",
      addressBlock: "1",
      addressStreet: "Tanjong Pagar Plaza",
      postalCode: "082001",
    });
    expect(saved.status).toBe(200);
  });
});
