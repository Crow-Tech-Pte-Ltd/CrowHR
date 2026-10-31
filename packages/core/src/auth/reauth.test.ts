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
import type { ErrorEnvelope } from "../errors.ts";

const PASSWORD = "laksa with extra cockles";
const STALE = new Date("2026-10-31T00:35:00Z"); // 25 minutes before TEST_NOW

describe("recent re-authentication", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
    org = await seedOrg(deps);
  });
  afterAll(() => t.close());

  const sensitive: [string, string, unknown][] = [
    ["PATCH", "/api/v1/security/settings", { idleTimeoutMin: 60 }],
    ["POST", "/api/v1/security/providers", { kind: "google", clientId: "x", clientSecret: "y" }],
    ["PUT", "/api/v1/members/{member}/roles", { roles: ["hr_admin"] }],
    ["POST", "/api/v1/me/password", { currentPassword: PASSWORD, newPassword: "another long passphrase" }],
    ["POST", "/api/v1/me/mfa/recovery-codes", undefined],
    ["DELETE", "/api/v1/me/mfa", undefined],
    ["POST", "/api/v1/members/{member}/mfa/reset", undefined],
  ];

  it.each(sensitive)("%s %s needs authentication within 10 minutes", async (method, path, body) => {
    const owner = await seedMember(deps, org.id, { roles: ["owner"], password: PASSWORD });
    const target = await seedMember(deps, org.id);
    const http = await clientAs(app, deps, owner, { authenticatedAt: STALE });
    const res = await http.request(path.replace("{member}", target.membershipId), { method, json: body });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("reauth_required");
  });

  it("saves nothing when stale (SSO provider)", async () => {
    const owner = await seedMember(deps, org.id, { roles: ["owner"] });
    const http = await clientAs(app, deps, owner, { authenticatedAt: STALE });
    await http.post("/api/v1/security/providers", { kind: "google", clientId: "x", clientSecret: "y" });
    const fresh = await clientAs(app, deps, owner);
    const settings = (await (await fresh.get("/api/v1/security/settings")).json()) as { providers: unknown[] };
    expect(settings.providers).toEqual([]);
  });

  it("re-authenticating with the password refreshes the window", async () => {
    const owner = await seedMember(deps, org.id, { roles: ["owner"], password: PASSWORD });
    const http = await clientAs(app, deps, owner, { authenticatedAt: STALE });
    expect((await http.patch("/api/v1/security/settings", { idleTimeoutMin: 45 })).status).toBe(403);
    expect((await http.post("/api/v1/auth/reauth", { password: "wrong password!!" })).status).toBe(401);
    expect((await http.post("/api/v1/auth/reauth", { password: PASSWORD })).status).toBe(200);
    expect((await http.patch("/api/v1/security/settings", { idleTimeoutMin: 45 })).status).toBe(200);
  });

  it("is fresh straight after sign-in", async () => {
    const owner = await seedMember(deps, org.id, { roles: ["owner"], password: PASSWORD, email: "fresh@example.sg" });
    const http = testClient(app, deps);
    await http.post("/api/v1/auth/sign-in", { org: org.slug, email: owner.email, password: PASSWORD });
    expect((await http.patch("/api/v1/security/settings", { idleTimeoutMin: 30 })).status).toBe(200);
  });
});
