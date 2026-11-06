import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createMockIdp,
  createTestDb,
  createTestDeps,
  type MockIdp,
  movableClock,
  seedMember,
  seedOrg,
  ssoRoundTrip,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { userIdentities } from "../db/schema/auth.ts";
import { notifications } from "../db/schema/notifications.ts";

const TENANT = "11111111-2222-3333-4444-555555555555";

describe("OIDC sign-in flow (Google, Entra, generic) against the mock IdP", () => {
  let t: TestDb;
  const clock = movableClock(new Date());
  let generic: MockIdp;
  let google: MockIdp;
  let entra: MockIdp;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  let owner: Awaited<ReturnType<typeof clientAs>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestDb();
    generic = await createMockIdp({
      issuer: "https://idp.example.test/realms/acme",
      clientId: "crowhr",
      clientSecret: "s3cret",
    });
    google = await createMockIdp({
      issuer: "https://accounts.google.com",
      clientId: "g-client",
      clientSecret: "g-secret",
    });
    entra = await createMockIdp({
      issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      clientId: "e-client",
      clientSecret: "e-secret",
    });
    const route = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      for (const idp of [generic, google, entra]) {
        try {
          return await idp.fetch(url, init);
        } catch {
          // next
        }
      }
      throw new TypeError(`no network in tests: ${url}`);
    }) as typeof fetch;
    deps = createTestDeps(t.db, { clock, httpFetch: route });
    app = createApp(deps);
    org = await seedOrg(deps, { name: "Kampong Kopi", slug: "kopi" });
    owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const add = async (body: unknown) => {
      const res = await owner.post("/api/v1/security/providers", body);
      expect(res.status, await res.clone().text()).toBe(201);
      const p = (await res.json()) as { id: string };
      expect((await owner.patch(`/api/v1/security/providers/${p.id}`, { enabled: true })).status).toBe(200);
      return p.id;
    };
    ids.generic = await add({
      kind: "oidc",
      displayName: "Okta",
      issuer: "https://idp.example.test/realms/acme",
      clientId: "crowhr",
      clientSecret: "s3cret",
    });
    ids.google = await add({
      kind: "google",
      clientId: "g-client",
      clientSecret: "g-secret",
      allowedDomains: ["kampongkopi.sg"],
    });
    ids.entra = await add({ kind: "entra", clientId: "e-client", clientSecret: "e-secret", tenantId: TENANT });
  });
  afterAll(() => t.close());

  const reasons = async () =>
    (await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.sso_failed"))).map(
      (e) => (e.meta as { reason: string }).reason,
    );

  it("signs a pre-provisioned member in with PKCE S256, state and nonce", async () => {
    await seedMember(deps, org.id, { email: "aisyah@kampongkopi.sg" });
    generic.nextUser = { sub: "okta-aisyah", email: "aisyah@kampongkopi.sg", email_verified: true };
    const http = testClient(app, deps);
    const { start, location } = await ssoRoundTrip(http, generic, ids.generic as string);
    const authz = new URL(start.headers.get("location") as string);
    expect(authz.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authz.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authz.searchParams.get("response_mode")).toBe("query");
    expect(authz.searchParams.get("state")).toBeTruthy();
    expect(authz.searchParams.get("nonce")).toBeTruthy();
    expect(location).toBe("/");
    const me = (await (await http.get("/api/v1/me")).json()) as { user: { email: string }; authMethod: string };
    expect(me).toMatchObject({ user: { email: "aisyah@kampongkopi.sg" }, authMethod: "oidc" });
  });

  it("later sign-ins match by (issuer, sub) even if the email changed", async () => {
    generic.nextUser = { sub: "okta-aisyah", email: "renamed@elsewhere.sg", email_verified: true };
    const http = testClient(app, deps);
    expect((await ssoRoundTrip(http, generic, ids.generic as string)).location).toBe("/");
    expect(((await (await http.get("/api/v1/me")).json()) as { user: { email: string } }).user.email).toBe(
      "aisyah@kampongkopi.sg",
    );
  });

  it("fails on a state mismatch with reason state_mismatch and no session", async () => {
    const http = testClient(app, deps);
    const res = await http.get(`/api/v1/auth/oidc/${ids.generic}/callback?code=x&state=forged-state-value`);
    expect(res.headers.get("location")).toBe("/sign-in/kopi?error=sso_failed&provider=Okta");
    expect(http.sessionToken()).toBeUndefined();
    expect(await reasons()).toContain("state_mismatch");
  });

  it("refuses a callback completed in a different browser than the one that started it (login CSRF)", async () => {
    await seedMember(deps, org.id, { email: "attacker@kampongkopi.sg" });
    generic.nextUser = { sub: "okta-attacker", email: "attacker@kampongkopi.sg", email_verified: true };
    const attacker = testClient(app, deps);
    const start = await attacker.get(`/api/v1/auth/oidc/${ids.generic}/start`);
    const cb = await generic.login(start.headers.get("location") as string);
    const victim = testClient(app, deps);
    const res = await victim.get(cb.pathname + cb.search);
    expect(res.headers.get("location")).toContain("error=sso_failed");
    expect(victim.sessionToken()).toBeUndefined();
  });

  it("fails when the transaction is older than 10 minutes", async () => {
    await seedMember(deps, org.id, { email: "slow@kampongkopi.sg" });
    generic.nextUser = { sub: "okta-slow", email: "slow@kampongkopi.sg", email_verified: true };
    const http = testClient(app, deps);
    const start = await http.get(`/api/v1/auth/oidc/${ids.generic}/start`);
    const cb = await generic.login(start.headers.get("location") as string);
    clock.advance(10 * 60_000 + 1);
    const res = await http.get(cb.pathname + cb.search);
    clock.set(new Date());
    expect(res.headers.get("location")).toContain("error=sso_failed");
    expect(await reasons()).toContain("expired");
  });

  it.each([
    ["badSignature", "a bad signature"],
    ["wrongAudience", "the wrong audience"],
    ["wrongNonce", "the wrong nonce"],
    ["expired", "an expired ID token"],
  ] as const)("rejects %s (%s) with token_validation_failed", async (switchName, _what) => {
    await seedMember(deps, org.id, { email: `${switchName}@kampongkopi.sg` });
    generic.nextUser = { sub: `okta-${switchName}`, email: `${switchName}@kampongkopi.sg`, email_verified: true };
    generic.tamper = { [switchName]: true };
    try {
      const http = testClient(app, deps);
      const { location } = await ssoRoundTrip(http, generic, ids.generic as string);
      expect(location).toContain("error=sso_failed");
      expect(http.sessionToken()).toBeUndefined();
    } finally {
      generic.tamper = {};
    }
    const last = (await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.sso_failed"))).at(-1);
    expect((last?.meta as { reason?: string } | undefined)?.reason).toBe("token_validation_failed");
  });

  it("Google: sends hd and rejects a token from another hosted domain", async () => {
    await seedMember(deps, org.id, { email: "ben@kampongkopi.sg" });
    google.nextUser = { sub: "g-ben", email: "ben@kampongkopi.sg", email_verified: true, hd: "kampongkopi.sg" };
    const ok = await ssoRoundTrip(testClient(app, deps), google, ids.google as string);
    expect(new URL(ok.start.headers.get("location") as string).searchParams.get("hd")).toBe("kampongkopi.sg");
    expect(ok.location).toBe("/");
    google.nextUser = { sub: "g-mallory", email: "ben@kampongkopi.sg", email_verified: true, hd: "gmail.com" };
    const bad = await ssoRoundTrip(testClient(app, deps), google, ids.google as string);
    expect(bad.location).toContain("error=sso_failed");
    expect(await reasons()).toContain("hd_mismatch");
  });

  it("Entra: rejects a token whose tid is another tenant", async () => {
    await seedMember(deps, org.id, { email: "chen@kampongkopi.sg" });
    entra.nextUser = { sub: "e-chen", email: "chen@kampongkopi.sg", tid: "99999999-0000-0000-0000-000000000000" };
    expect((await ssoRoundTrip(testClient(app, deps), entra, ids.entra as string)).location).toContain(
      "error=sso_failed",
    );
    expect(await reasons()).toContain("tid_mismatch");
    // From the configured tenant, the email links only when Entra marks its domain verified
    // (xms_edov); see sso-security.http.test.ts for the unverified case.
    entra.nextUser = { sub: "e-chen", email: "chen@kampongkopi.sg", tid: TENANT, xms_edov: true };
    expect((await ssoRoundTrip(testClient(app, deps), entra, ids.entra as string)).location).toBe("/");
  });

  it("refuses an identity with no pre-provisioned member (JIT off) with not_provisioned", async () => {
    generic.nextUser = { sub: "okta-stranger", email: "stranger@kampongkopi.sg", email_verified: true };
    const { location } = await ssoRoundTrip(testClient(app, deps), generic, ids.generic as string);
    expect(location).toBe("/sign-in/kopi?error=not_provisioned&provider=Okta");
    expect(await reasons()).toContain("not_provisioned");
  });

  it("refuses an unverified email for first linking", async () => {
    await seedMember(deps, org.id, { email: "unverified@kampongkopi.sg" });
    generic.nextUser = { sub: "okta-unv", email: "unverified@kampongkopi.sg", email_verified: false };
    expect((await ssoRoundTrip(testClient(app, deps), generic, ids.generic as string)).location).toContain(
      "error=sso_failed",
    );
    expect(await reasons()).toContain("email_not_verified");
  });

  it("links an invited member through the invitation link, activating the membership", async () => {
    const res = await owner.post("/api/v1/members/invitations", {
      email: "invitee@kampongkopi.sg",
      displayName: "Invitee",
    });
    const token = ((await res.json()) as { inviteUrl: string }).inviteUrl.split("/invite/")[1] as string;
    generic.nextUser = { sub: "okta-invitee", email: "private@gmail.com", email_verified: true };
    const http = testClient(app, deps);
    const { location } = await ssoRoundTrip(http, generic, ids.generic as string, `?invitation=${token}`);
    expect(location).toBe("/");
    expect(((await (await http.get("/api/v1/me")).json()) as { user: { email: string } }).user.email).toBe(
      "invitee@kampongkopi.sg",
    );
  });

  it("JIT: off by default; on, creates an employee member only for allowed domains", async () => {
    generic.nextUser = { sub: "okta-jit", email: "jit@kampongkopi.sg", email_verified: true };
    expect((await ssoRoundTrip(testClient(app, deps), generic, ids.generic as string)).location).toContain(
      "not_provisioned",
    );
    expect(
      (
        await owner.patch(`/api/v1/security/providers/${ids.generic}`, {
          jitEnabled: true,
          allowedDomains: ["kampongkopi.sg"],
        })
      ).status,
    ).toBe(200);
    const http = testClient(app, deps);
    expect((await ssoRoundTrip(http, generic, ids.generic as string)).location).toBe("/");
    const me = (await (await http.get("/api/v1/me")).json()) as { roles: string[]; employeeId: string | null };
    expect(me).toMatchObject({ roles: [], employeeId: null });
    // HR (here the owner: the org has no hr_admin) is told to link or remove the new member.
    const told = await deps.db.select().from(notifications).where(eq(notifications.kind, "security_notice"));
    expect(told.find((n) => n.title === "A new member joined through single sign-on")).toMatchObject({
      link: "/settings/members",
      body: expect.stringContaining("jit@kampongkopi.sg"),
    });
    generic.nextUser = { sub: "okta-gmail", email: "x@gmail.com", email_verified: true };
    expect((await ssoRoundTrip(testClient(app, deps), generic, ids.generic as string)).location).toContain(
      "not_provisioned",
    );
    await owner.patch(`/api/v1/security/providers/${ids.generic}`, { jitEnabled: false });
  });

  it("links from the profile and refuses unlinking the only sign-in method", async () => {
    const m = await seedMember(deps, org.id, { email: "linker@kampongkopi.sg" }); // no password
    const http = await clientAs(app, deps, m);
    generic.nextUser = { sub: "okta-linker", email: "whatever@x.sg", email_verified: false };
    expect((await ssoRoundTrip(http, generic, ids.generic as string, "?purpose=link")).location).toBe(
      "/me/sessions?link=ok",
    );
    const list = (await (await http.get("/api/v1/me/identities")).json()) as { items: { id: string }[] };
    expect(list.items).toHaveLength(1);
    const res = await http.delete(`/api/v1/me/identities/${list.items[0]?.id}`);
    expect(res.status).toBe(409);
    const [row] = await deps.db.select().from(userIdentities).where(eq(userIdentities.userId, m.userId));
    expect(row?.subject).toBe("okta-linker");
  });

  it("owner test sign-in records last_test_ok_at and is required before passwords can be disabled", async () => {
    const before = await owner.patch("/api/v1/security/settings", { passwordEnabled: false });
    expect(before.status).toBe(409);
    generic.nextUser = { sub: "okta-owner-test", email: "irrelevant@x.sg" };
    const { location } = await ssoRoundTrip(owner, generic, ids.generic as string, "?purpose=test");
    expect(location).toBe(`/settings/security?test=ok&provider=${ids.generic}`);
    expect((await owner.patch("/api/v1/security/settings", { passwordEnabled: false })).status).toBe(200);
    expect((await owner.patch("/api/v1/security/settings", { passwordEnabled: true })).status).toBe(200);
  });
});
