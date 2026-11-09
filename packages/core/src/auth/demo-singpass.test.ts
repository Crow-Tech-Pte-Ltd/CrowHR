import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createMockIdp,
  createTestDb,
  createTestDeps,
  type MockIdp,
  seedMember,
  seedOrg,
  ssoRoundTrip,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { sessions, ssoProviders, userIdentities } from "../db/schema/auth.ts";
import type { AppDeps } from "../deps.ts";

/**
 * Demo Singpass round trip (change add-demo-singpass-sign-in): a server acts as the Singpass relying
 * party for the in-browser demo. Singpass's answer is validated, then the person is forgotten and the
 * browser goes back to the demo, which offers HR admin or Employee.
 */
describe("Demo Singpass round trip", () => {
  let t: TestDb;
  let idp: MockIdp;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let providerId = "";
  let otherId = "";
  const ISSUER = "https://stg-id.singpass.mock.test/fapi";
  const RETURN_URL = "https://demo.example/sign-in/kopi-kaki";
  const SUBJECT = "8f1c6f9e-0000-4000-8000-0000000000aa";

  function appWith(demoSingpass: AppDeps["demoSingpass"]) {
    return createApp({ ...deps, demoSingpass });
  }

  beforeAll(async () => {
    t = await createTestDb();
    idp = await createMockIdp({
      issuer: ISSUER,
      clientId: "crowhr-demo-rp",
      par: true,
      dpop: true,
      privateKeyJwt: true,
      encryptIdToken: true,
      singpass: true,
      rpJwks: async () =>
        (await (await app.request(`/api/v1/auth/oidc/${providerId}/jwks.json`)).json()) as { keys: never[] },
    });
    deps = createTestDeps(t.db, { httpFetch: idp.fetch });
    app = createApp(deps);
    const org = await seedOrg(deps, { slug: "crow-demo-host" });
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const res = await owner.post("/api/v1/security/providers", {
      kind: "singpass",
      issuer: ISSUER,
      environment: "staging",
      clientId: "crowhr-demo-rp",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    providerId = ((await res.json()) as { id: string }).id;
    // Left switched off on purpose: the demo round trip must not need the hosting org's sign-in page.
    const [row] = await deps.db.select().from(ssoProviders).where(eq(ssoProviders.id, providerId));
    expect(row?.enabled).toBe(false);
    // A non-Singpass provider (generic OIDC against the same mock issuer).
    const g = await owner.post("/api/v1/security/providers", {
      kind: "oidc",
      displayName: "Other",
      issuer: ISSUER,
      clientId: "crowhr-demo-rp",
      clientSecret: "s",
    });
    expect(g.status, await g.clone().text()).toBe(201);
    otherId = ((await g.json()) as { id: string }).id;
    app = appWith({ providerId, returnUrl: RETURN_URL });
  });
  afterAll(() => t.close());

  it("is off unless the server names the provider and the return URL", async () => {
    const off = createApp(deps);
    expect((await off.request(`/api/v1/auth/oidc/${providerId}/start?purpose=demo`)).status).toBe(404);
    expect((await app.request(`/api/v1/auth/oidc/${otherId}/start?purpose=demo`)).status).toBe(404);
    const other = appWith({ providerId: otherId, returnUrl: RETURN_URL });
    // Configured, but for a provider that isn't Singpass.
    expect((await other.request(`/api/v1/auth/oidc/${otherId}/start?purpose=demo`)).status).toBe(404);
  });

  it("validates Singpass's answer, then forgets the person and goes back to the demo", async () => {
    idp.nextUser = { sub: SUBJECT };
    const before = { sessions: (await deps.db.select().from(sessions)).length, par: idp.seen.parRequests };
    const http = testClient(app, deps);
    const { start, callback, location } = await ssoRoundTrip(http, idp, providerId, "?purpose=demo");
    expect(start.status).toBe(302);
    expect(idp.seen.parRequests).toBe(before.par + 1);
    expect(idp.seen.authorizeParams.at(-1)).toMatchObject({
      authentication_context_type: "APP_AUTHENTICATION_DEFAULT",
    });
    expect(location).toBe(`${RETURN_URL}?singpass=ok`);
    expect(callback.headers.get("set-cookie") ?? "").not.toContain("crowhr_session=");
    expect((await deps.db.select().from(sessions)).length).toBe(before.sessions);
    expect(await deps.db.select().from(userIdentities)).toEqual([]);
    const audits = await deps.db.select().from(auditEvents);
    expect(audits.filter((a) => a.action === "sso.demo_sign_in")).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(SUBJECT);
  });

  it("goes back to the demo with singpass=failed when Singpass's answer doesn't validate", async () => {
    idp.nextUser = { sub: SUBJECT };
    idp.tamper = { badSignature: true };
    try {
      const { location } = await ssoRoundTrip(testClient(app, deps), idp, providerId, "?purpose=demo");
      expect(location).toBe(`${RETURN_URL}?singpass=failed&reason=token_validation_failed`);
    } finally {
      idp.tamper = {};
    }
  });

  it("goes back to the demo with singpass=failed when Singpass refuses the request", async () => {
    idp.tamper = { parError: { error: "invalid_client" } };
    try {
      const res = await testClient(app, deps).get(`/api/v1/auth/oidc/${providerId}/start?purpose=demo`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`${RETURN_URL}?singpass=failed&reason=request_rejected`);
    } finally {
      idp.tamper = {};
    }
  });

  it("limits starts per network per hour and overall per day", async () => {
    const limited = appWith({ providerId, returnUrl: RETURN_URL, hourlyLimitPerNetwork: 2, dailyLimit: 1000 });
    const from = (ip: string) => ({ headers: { "x-crowhr-client-ip": ip } });
    const start = (a: ReturnType<typeof createApp>, ip: string) =>
      a.request(`/api/v1/auth/oidc/${providerId}/start?purpose=demo`, from(ip));
    expect((await start(limited, "203.0.113.7")).headers.get("location")).toContain("request_uri=");
    expect((await start(limited, "203.0.113.7")).headers.get("location")).toContain("request_uri=");
    expect((await start(limited, "203.0.113.7")).headers.get("location")).toBe(
      `${RETURN_URL}?singpass=failed&reason=busy`,
    );
    expect((await start(limited, "203.0.113.8")).headers.get("location")).toContain("request_uri=");

    const daily = appWith({ providerId, returnUrl: RETURN_URL, hourlyLimitPerNetwork: 1000, dailyLimit: 1 });
    // The day's budget is already spent by the starts above.
    expect((await start(daily, "203.0.113.9")).headers.get("location")).toBe(
      `${RETURN_URL}?singpass=failed&reason=busy`,
    );
  });
});
