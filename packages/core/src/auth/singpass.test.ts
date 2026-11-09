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
import { ssoProviders, userIdentities } from "../db/schema/auth.ts";
import type { ErrorEnvelope } from "../errors.ts";

/**
 * Singpass preset (FAPI 2.0) against the mock IdP with PAR required, private_key_jwt, DPoP and
 * encrypted ID tokens. NOT a verification against real Singpass (see docs/limitations.md).
 */
describe("Singpass preset (mock IdP, FAPI 2.0 features on)", () => {
  let t: TestDb;
  let idp: MockIdp;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  let owner: Awaited<ReturnType<typeof clientAs>>;
  let providerId = "";
  const ISSUER = "https://stg-id.singpass.mock.test";

  beforeAll(async () => {
    t = await createTestDb();
    idp = await createMockIdp({
      issuer: ISSUER,
      clientId: "crowhr-rp",
      par: true,
      dpop: true,
      privateKeyJwt: true,
      encryptIdToken: true,
      rpJwks: async () =>
        (await (await app.request(`/api/v1/auth/oidc/${providerId}/jwks.json`)).json()) as { keys: never[] },
    });
    deps = createTestDeps(t.db, { httpFetch: idp.fetch });
    app = createApp(deps);
    org = await seedOrg(deps, { slug: "kopi" });
    owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const res = await owner.post("/api/v1/security/providers", {
      kind: "singpass",
      issuer: ISSUER,
      environment: "staging",
      clientId: "crowhr-rp",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { id: string; privateKeysSet: boolean; jwksUrl: string; configured: boolean };
    expect(body).toMatchObject({
      privateKeysSet: true,
      configured: true,
      jwksUrl: `https://hr.test/api/v1/auth/oidc/${body.id}/jwks.json`,
    });
    providerId = body.id;
    expect((await owner.patch(`/api/v1/security/providers/${providerId}`, { enabled: true })).status).toBe(200);
  });
  afterAll(() => t.close());

  it("publishes only public keys (signing ES256 + encryption) at the JWKS URL", async () => {
    const res = await app.request(`/api/v1/auth/oidc/${providerId}/jwks.json`);
    const jwks = (await res.json()) as { keys: Record<string, unknown>[] };
    expect(jwks.keys.map((k) => [k.use, k.alg, k.crv])).toEqual([
      ["sig", "ES256", "P-256"],
      ["enc", "ECDH-ES+A256KW", "P-256"],
    ]);
    for (const k of jwks.keys)
      for (const priv of ["d", "p", "q", "dp", "dq", "qi", "k"]) expect(k).not.toHaveProperty(priv);
    expect((await app.request(`/api/v1/auth/oidc/${deps.ids.newId()}/jwks.json`)).status).toBe(404);
  });

  it("never links by email, even a verified one", async () => {
    await seedMember(deps, org.id, { email: "tan@kopi.sg" });
    idp.nextUser = {
      sub: "s=S1234567D,u=8f1c6f9e-0000-4000-8000-000000000001",
      email: "tan@kopi.sg",
      email_verified: true,
    };
    const { location } = await ssoRoundTrip(testClient(app, deps), idp, providerId);
    expect(location).toBe("/sign-in/kopi?error=not_provisioned&provider=Singpass");
  });

  it("uses PAR, private_key_jwt and DPoP, decrypts the ID token, and links via invitation storing only the UUID", async () => {
    const res = await owner.post("/api/v1/members/invitations", { email: "lim@kopi.sg", displayName: "Lim" });
    const token = ((await res.json()) as { inviteUrl: string }).inviteUrl.split("/invite/")[1] as string;
    idp.nextUser = { sub: "s=S7654321A,u=8f1c6f9e-0000-4000-8000-000000000002" };
    const before = { par: idp.seen.parRequests, token: idp.seen.tokenRequests.length };
    const http = testClient(app, deps);
    const { start, location } = await ssoRoundTrip(http, idp, providerId, `?invitation=${token}`);
    expect(new URL(start.headers.get("location") as string).searchParams.get("request_uri")).toMatch(/^urn:mock:/);
    expect(idp.seen.parRequests).toBe(before.par + 1);
    expect(idp.seen.tokenRequests.slice(before.token)).toEqual([{ dpop: true, clientAuth: "private_key_jwt" }]);
    expect(location).toBe("/");
    expect(
      (await (await http.get("/api/v1/me")).json()) as { authMethod: string; user: { email: string } },
    ).toMatchObject({ authMethod: "singpass", user: { email: "lim@kopi.sg" } });
    const rows = await deps.db.select().from(userIdentities).where(eq(userIdentities.providerId, providerId));
    expect(rows.map((r) => r.subject)).toEqual(["8f1c6f9e-0000-4000-8000-000000000002"]);
    expect(JSON.stringify(rows)).not.toContain("S7654321A");

    // Later sign-ins match by the stored UUID.
    const again = testClient(app, deps);
    expect((await ssoRoundTrip(again, idp, providerId)).location).toBe("/");
  });

  it("links from the profile ('Link Singpass')", async () => {
    const m = await seedMember(deps, org.id, { email: "ng@kopi.sg", password: "a long enough passphrase" });
    const http = await clientAs(app, deps, m);
    idp.nextUser = { sub: "u=8f1c6f9e-0000-4000-8000-000000000003" };
    expect((await ssoRoundTrip(http, idp, providerId, "?purpose=link")).location).toBe("/me/sessions?link=ok");
    const [linked] = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "sso.identity_linked"));
    expect(linked).toBeDefined();
  });

  it("refuses a tampered (badly signed) inner ID token", async () => {
    idp.nextUser = { sub: "u=8f1c6f9e-0000-4000-8000-000000000002" };
    idp.tamper = { badSignature: true };
    try {
      expect((await ssoRoundTrip(testClient(app, deps), idp, providerId)).location).toContain("error=sso_failed");
    } finally {
      idp.tamper = {};
    }
  });

  it("JIT cannot be enabled for Singpass", async () => {
    const res = await owner.patch(`/api/v1/security/providers/${providerId}`, {
      jitEnabled: true,
      allowedDomains: ["kopi.sg"],
    });
    expect(res.status).toBe(400);
  });

  it("can be saved before Singpass issues a client ID, so the redirect URI and keys come first", async () => {
    // The Singpass Developer Portal asks for the redirect URL and JWKS before it issues a client ID.
    const other = await seedOrg(deps, { slug: "teh" });
    const ownerB = await clientAs(app, deps, await seedMember(deps, other.id, { roles: ["owner"] }));
    const premature = await ownerB.post("/api/v1/security/providers", {
      kind: "singpass",
      issuer: ISSUER,
      environment: "staging",
      enabled: true,
    });
    expect(premature.status).toBe(409);
    expect(((await premature.json()) as ErrorEnvelope).error.message).toContain("Singpass is not configured yet");
    expect((await deps.db.select().from(ssoProviders).where(eq(ssoProviders.orgId, other.id))).length).toBe(0);

    const res = await ownerB.post("/api/v1/security/providers", { kind: "singpass", environment: "staging" });
    expect(res.status, await res.clone().text()).toBe(201);
    const saved = (await res.json()) as {
      id: string;
      clientId: string;
      configured: boolean;
      privateKeysSet: boolean;
      callbackUrl: string;
      jwksUrl: string;
    };
    expect(saved).toMatchObject({
      clientId: "",
      configured: false,
      privateKeysSet: true,
      callbackUrl: `https://hr.test/api/v1/auth/oidc/${saved.id}/callback`,
      jwksUrl: `https://hr.test/api/v1/auth/oidc/${saved.id}/jwks.json`,
    });
    const jwks = (await (await app.request(`/api/v1/auth/oidc/${saved.id}/jwks.json`)).json()) as { keys: unknown[] };
    expect(jwks.keys).toHaveLength(2);
    const methods = (await (await app.request("/api/v1/auth/methods?org=teh")).json()) as { providers: unknown[] };
    expect(methods.providers).toEqual([]);
    expect((await ownerB.patch(`/api/v1/security/providers/${saved.id}`, { enabled: true })).status).toBe(409);

    const withClient = await ownerB.patch(`/api/v1/security/providers/${saved.id}`, {
      issuer: ISSUER,
      clientId: "crowhr-rp",
    });
    expect(withClient.status, await withClient.clone().text()).toBe(200);
    expect(await withClient.json()).toMatchObject({ clientId: "crowhr-rp", configured: true, enabled: false });
  });
});
