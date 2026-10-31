import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedMember, seedOrg, type TestDb, testClient } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { ssoProviders } from "../db/schema/auth.ts";
import type { ErrorEnvelope } from "../errors.ts";

describe("demo mode", () => {
  let t: TestDb;
  let providerId: string;
  let membershipId: string;
  const fetched: string[] = [];
  beforeAll(async () => {
    t = await createTestDb();
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps, { slug: "demo" });
    membershipId = (await seedMember(deps, org.id, { roles: ["owner"], displayName: "Demo Owner" })).membershipId;
    providerId = deps.ids.newId();
    const now = deps.clock.now();
    await deps.db.insert(ssoProviders).values({
      id: providerId,
      orgId: org.id,
      kind: "entra",
      displayName: "Microsoft",
      issuer: "https://login.microsoftonline.com/x/v2.0",
      clientId: "c",
      clientSecretEnc: await deps.secretBox.encrypt("sso-client-secret", "s"),
      tenantId: "x",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  afterAll(() => t.close());

  const app = (demoMode: boolean) => {
    const deps = createTestDeps(t.db, {
      demoMode,
      httpFetch: (async (url: string) => {
        fetched.push(String(url));
        throw new Error("no network in tests");
      }) as unknown as typeof fetch,
    });
    return { deps, app: createApp(deps) };
  };

  it("SSO start answers 403 disabled_in_demo without any outbound request", async () => {
    const { app: demo } = app(true);
    const res = await demo.request(`/api/v1/auth/oidc/${providerId}/start`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorEnvelope).error.message).toBe(
      "Not available in the demo. Self-hosted installs can enable this in Settings → Security.",
    );
    expect(fetched).toEqual([]);
  });

  it("offers persona sign-in only in demo mode", async () => {
    const { app: demo, deps } = app(true);
    const personas = (await (await demo.request("/api/v1/auth/demo/personas")).json()) as {
      items: { membershipId: string; roles: string[] }[];
    };
    expect(personas.items).toEqual([expect.objectContaining({ membershipId, roles: ["owner"] })]);
    const http = testClient(demo, deps);
    expect((await http.post("/api/v1/auth/demo/sign-in", { membershipId })).status).toBe(204);
    expect((await http.get("/api/v1/me")).status).toBe(200);
    const methods = (await (await demo.request("/api/v1/auth/methods")).json()) as { demoMode: boolean };
    expect(methods.demoMode).toBe(true);

    const { app: real, deps: realDeps } = app(false);
    expect((await real.request("/api/v1/auth/demo/personas")).status).toBe(404);
    expect((await testClient(real, realDeps).post("/api/v1/auth/demo/sign-in", { membershipId })).status).toBe(404);
  });
});
