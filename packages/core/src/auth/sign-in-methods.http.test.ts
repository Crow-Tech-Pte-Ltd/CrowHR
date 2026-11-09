import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { orgSecuritySettings, ssoProviders } from "../db/schema/auth.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { totpAt } from "./totp.ts";

const PASSWORD = "bak kut teh at midnight";

describe("sign-in method configuration", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
    org = await seedOrg(deps, { name: "Kampong Kopi", slug: "kopi" });
    const now = deps.clock.now();
    const enc = await deps.secretBox.encrypt("sso-client-secret", "x");
    await deps.db.insert(ssoProviders).values([
      {
        id: deps.ids.newId(),
        orgId: org.id,
        kind: "google",
        displayName: "Google",
        issuer: "https://accounts.google.com",
        clientId: "g",
        clientSecretEnc: enc,
        allowedDomains: ["kampongkopi.sg"],
        enabled: true,
        lastTestOkAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: deps.ids.newId(),
        orgId: org.id,
        kind: "entra",
        displayName: "Microsoft",
        issuer: "https://login.microsoftonline.com/t/v2.0",
        clientId: "e",
        clientSecretEnc: enc,
        tenantId: "t",
        enabled: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: deps.ids.newId(),
        orgId: org.id,
        kind: "singpass",
        displayName: "Singpass",
        issuer: "https://stg-id.singpass.gov.sg/fapi",
        clientId: "s",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });
  afterAll(() => t.close());

  it("the public methods endpoint lists only enabled and configured methods", async () => {
    const body = (await (await app.request("/api/v1/auth/methods?org=kopi")).json()) as {
      password: { enabled: boolean };
      providers: { kind: string; allowedDomains: string[] }[];
    };
    expect(body.password.enabled).toBe(true);
    expect(body.providers).toEqual([expect.objectContaining({ kind: "google", allowedDomains: ["kampongkopi.sg"] })]);
    const single = (await (await app.request("/api/v1/auth/methods")).json()) as { organisation: { slug: string } };
    expect(single.organisation.slug).toBe("kopi");
    expect((await app.request("/api/v1/auth/methods?org=nope")).status).toBe(404);
  });

  it("once passwords are off: staff are refused with the SSO names; the owner's break-glass sign-in works with MFA and is audited", async () => {
    const owner = await seedMember(deps, org.id, { roles: ["owner"], email: "owner@kopi.sg", password: PASSWORD });
    const ownerWeb = await clientAs(app, deps, owner);
    const { secret } = (await (await ownerWeb.post("/api/v1/me/mfa/totp/setup")).json()) as { secret: string };
    await ownerWeb.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(secret, deps.clock.now()) });
    expect((await ownerWeb.patch("/api/v1/security/settings", { passwordEnabled: false })).status).toBe(200);
    await seedMember(deps, org.id, { email: "staff@kopi.sg", password: PASSWORD });

    const staff = await testClient(app, deps).post("/api/v1/auth/sign-in", {
      org: "kopi",
      email: "staff@kopi.sg",
      password: PASSWORD,
    });
    expect(staff.status).toBe(403);
    const err = ((await staff.json()) as ErrorEnvelope).error;
    expect(err.code).toBe("password_sign_in_disabled");
    expect(err.message).toBe("Kampong Kopi doesn't use passwords for sign-in. Use Google instead.");
    // Wrong password for staff is still the generic failure (no oracle).
    expect(
      (
        await testClient(app, deps).post("/api/v1/auth/sign-in", {
          org: "kopi",
          email: "staff@kopi.sg",
          password: "wrong wrong wrong",
        })
      ).status,
    ).toBe(401);

    const http = testClient(app, deps);
    const step = (await (
      await http.post("/api/v1/auth/sign-in", { org: "kopi", email: "owner@kopi.sg", password: PASSWORD })
    ).json()) as { mfaRequired: boolean; mfaToken: string };
    expect(step.mfaRequired).toBe(true);
    const later = new Date(deps.clock.now().getTime() + 31_000);
    const ok = await createApp(createTestDeps(t.db, { clock: { now: () => later } })).request(
      "https://hr.test/api/v1/auth/mfa/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mfaToken: step.mfaToken, code: await totpAt(secret, later) }),
      },
    );
    expect(ok.status).toBe(200);
    const events = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.break_glass_sign_in"));
    expect(events.map((e) => e.targetId)).toContain(owner.membershipId);
    await deps.db
      .update(orgSecuritySettings)
      .set({ passwordEnabled: true })
      .where(eq(orgSecuritySettings.orgId, org.id));
  });

  it("Settings → Security warns about plain http", async () => {
    const httpDeps = createTestDeps(t.db, { publicUrl: "http://192.168.1.20:8080" });
    const httpApp = createApp(httpDeps);
    const owner = await clientAs(httpApp, httpDeps, await seedMember(httpDeps, org.id, { roles: ["owner"] }));
    const s = (await (await owner.get("/api/v1/security/settings")).json()) as { insecureTransport: boolean };
    expect(s.insecureTransport).toBe(true);
  });
});
