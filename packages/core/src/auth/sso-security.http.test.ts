import { and, eq, sql } from "drizzle-orm";
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
  type TestClient,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { userIdentities } from "../db/schema/auth.ts";
import type { Mailer } from "../deps.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { totpAt } from "./totp.ts";

const PASSWORD = "roti prata with curry";
const TENANT = "11111111-2222-3333-4444-555555555555";

/**
 * Review finding 1 and the Entra email-trust finding: SSO linking needs a fresh sign-in, survives
 * nothing that is meant to kick an intruder out, and never becomes a way around TOTP.
 */
describe("SSO linking and MFA (security review)", () => {
  let t: TestDb;
  const clock = movableClock(new Date());
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  let idp: MockIdp;
  let entra: MockIdp;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  let owner: TestClient;
  let pid: string;
  let entraId: string;

  beforeAll(async () => {
    t = await createTestDb();
    idp = await createMockIdp({
      issuer: "https://idp.example.test/realms/acme",
      clientId: "crowhr",
      clientSecret: "s3cret",
    });
    entra = await createMockIdp({
      issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      clientId: "e-client",
      clientSecret: "e-secret",
    });
    const route = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      for (const p of [idp, entra]) {
        try {
          return await p.fetch(url, init);
        } catch {
          // next
        }
      }
      throw new TypeError(`no network in tests: ${url}`);
    }) as typeof fetch;
    deps = createTestDeps(t.db, { clock, mailer, httpFetch: route });
    app = createApp(deps);
    org = await seedOrg(deps, { slug: "kopi" });
    owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"], email: "admin@kopi.sg" }));
    const add = async (body: unknown) => {
      const res = await owner.post("/api/v1/security/providers", body);
      expect(res.status, await res.clone().text()).toBe(201);
      const id = ((await res.json()) as { id: string }).id;
      expect((await owner.patch(`/api/v1/security/providers/${id}`, { enabled: true })).status).toBe(200);
      return id;
    };
    pid = await add({
      kind: "oidc",
      displayName: "Okta",
      issuer: "https://idp.example.test/realms/acme",
      clientId: "crowhr",
      clientSecret: "s3cret",
    });
    entraId = await add({ kind: "entra", clientId: "e-client", clientSecret: "e-secret", tenantId: TENANT });
  });
  afterAll(() => t.close());

  const code = async (r: Response) => ((await r.json()) as ErrorEnvelope).error.code;
  const identitiesOf = (userId: string) =>
    deps.db.select().from(userIdentities).where(eq(userIdentities.userId, userId));

  /** Signs in with password and enrols TOTP for real; returns the browser and secret. */
  async function enrolledBrowser(email: string, roles: ("owner" | "hr_admin")[] = []) {
    const m = await seedMember(deps, org.id, { email, password: PASSWORD, roles });
    const browser = testClient(app, deps);
    expect((await browser.post("/api/v1/auth/sign-in", { org: "kopi", email, password: PASSWORD })).status).toBe(200);
    const setup = (await (await browser.post("/api/v1/me/mfa/totp/setup", {})).json()) as { secret: string };
    expect(
      (await browser.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(setup.secret, clock.now()) })).status,
    ).toBe(200);
    clock.advance(31_000);
    return { m, browser, secret: setup.secret };
  }

  it("linking an identity needs a recent sign-in (unattended session cannot plant an IdP account)", async () => {
    const { m, browser, secret } = await enrolledBrowser("boss@kopi.sg", ["owner"]);
    clock.advance(20 * 60_000);
    idp.nextUser = { sub: "attacker-123", email: "attacker@elsewhere.example", email_verified: false };
    const stale = await ssoRoundTrip(browser, idp, pid, "?purpose=link");
    expect(stale.start.status).toBe(403);
    expect(await code(stale.start)).toBe("reauth_required");
    expect(await identitiesOf(m.userId)).toHaveLength(0);

    // After re-authenticating (password + TOTP) the owner can link, and is told by email.
    const reauth = await browser.post("/api/v1/auth/reauth", {
      password: PASSWORD,
      code: await totpAt(secret, clock.now()),
    });
    expect(reauth.status).toBe(200);
    idp.nextUser = { sub: "boss-okta", email: "boss@kopi.sg", email_verified: true };
    expect((await ssoRoundTrip(browser, idp, pid, "?purpose=link")).location).toBe("/me/sessions?link=ok");
    expect(await identitiesOf(m.userId)).toHaveLength(1);
    expect(sent.some((x) => x.to === "boss@kopi.sg" && /sign-in method/i.test(x.subject))).toBe(true);
  });

  it("requires the same live, recently authenticated user at the link callback", async () => {
    const m = await seedMember(deps, org.id, { email: "callback@kopi.sg" });
    const browser = await clientAs(app, deps, m);
    idp.nextUser = { sub: "late-link", email: "callback@kopi.sg", email_verified: true };
    const start = await browser.get(`/api/v1/auth/oidc/${pid}/start?purpose=link`);
    expect(start.status).toBe(302);
    const callback = await idp.login(start.headers.get("location") as string);
    await browser.post("/api/v1/auth/sign-out");
    expect((await browser.get(`${callback.pathname}${callback.search}`)).status).toBe(403);
    expect(await identitiesOf(m.userId)).toHaveLength(0);
  });

  it("an owner's test sign-in needs a recent sign-in too", async () => {
    const stale = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }), {
      authenticatedAt: new Date(clock.now().getTime() - 20 * 60_000),
    });
    const res = await stale.get(`/api/v1/auth/oidc/${pid}/start?purpose=test`);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("reauth_required");
  });

  it("SSO sign-in of a TOTP-enrolled member asks for the TOTP unless the IdP asserts MFA", async () => {
    const { m, secret } = await enrolledBrowser("totp@kopi.sg");
    await deps.db.insert(userIdentities).values({
      id: deps.ids.newId(),
      orgId: org.id,
      userId: m.userId,
      providerId: pid,
      issuer: "https://idp.example.test/realms/acme",
      subject: "totp-okta",
      linkedAt: clock.now(),
    });
    idp.nextUser = { sub: "totp-okta", email: "totp@kopi.sg", email_verified: true };
    const http = testClient(app, deps);
    const { location } = await ssoRoundTrip(http, idp, pid);
    expect(location).toBe("/sign-in/kopi?mfa=1");
    expect(http.sessionToken()).toBeUndefined();
    expect((await http.get("/api/v1/me")).status).toBe(401);
    const wrong = await http.post("/api/v1/auth/mfa/verify", { code: "000000" });
    expect(wrong.status).toBe(401);
    const ok = await http.post("/api/v1/auth/mfa/verify", { code: await totpAt(secret, clock.now()) });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const me = (await (await http.get("/api/v1/me")).json()) as { authMethod: string; user: { email: string } };
    expect(me).toMatchObject({ authMethod: "oidc", user: { email: "totp@kopi.sg" } });

    // An IdP that asserts MFA (amr) is trusted for the second factor.
    idp.nextUser = { sub: "totp-okta", email: "totp@kopi.sg", email_verified: true, amr: ["pwd", "mfa"] };
    const viaIdp = testClient(app, deps);
    expect((await ssoRoundTrip(viaIdp, idp, pid)).location).toBe("/");
  });

  it("the MFA policy covers SSO sessions whose IdP does not assert MFA", async () => {
    const m = await seedMember(deps, org.id, {
      email: "hr-sso@kopi.sg",
      roles: ["hr_admin"],
      grantedAt: new Date(clock.now().getTime() - 30 * 86_400_000),
    });
    idp.nextUser = { sub: "hr-sso", email: "hr-sso@kopi.sg", email_verified: true };
    const plain = testClient(app, deps);
    expect((await ssoRoundTrip(plain, idp, pid)).location).toBe("/");
    const blocked = await plain.get("/api/v1/members");
    expect(blocked.status).toBe(403);
    expect(await code(blocked)).toBe("mfa_enrolment_required");

    idp.nextUser = { sub: "hr-sso", email: "hr-sso@kopi.sg", email_verified: true, amr: ["mfa"] };
    const strong = testClient(app, deps);
    expect((await ssoRoundTrip(strong, idp, pid)).location).toBe("/");
    expect((await strong.get("/api/v1/members")).status).toBe(200);
    void m;
  });

  it("a password reset removes every linked identity", async () => {
    const m = await seedMember(deps, org.id, { email: "reset-me@kopi.sg", password: PASSWORD });
    idp.nextUser = { sub: "reset-okta", email: "reset-me@kopi.sg", email_verified: true };
    expect((await ssoRoundTrip(testClient(app, deps), idp, pid)).location).toBe("/");
    expect(await identitiesOf(m.userId)).toHaveLength(1);
    const before = sent.length;
    await testClient(app, deps).post("/api/v1/auth/password-reset/request", { org: "kopi", email: "reset-me@kopi.sg" });
    const token = /\/reset\/([A-Za-z0-9_-]+)/.exec(sent.slice(before).at(-1)?.text ?? "")?.[1] as string;
    expect(
      (
        await testClient(app, deps).post("/api/v1/auth/password-reset/complete", {
          token,
          password: "a brand new passphrase 7",
        })
      ).status,
    ).toBe(200);
    expect(await identitiesOf(m.userId)).toHaveLength(0);
  });

  it("sign out everywhere removes all linked identities, including the current method", async () => {
    const m = await seedMember(deps, org.id, { email: "two@kopi.sg", password: PASSWORD });
    idp.nextUser = { sub: "two-okta", email: "two@kopi.sg", email_verified: true };
    const ssoBrowser = testClient(app, deps);
    expect((await ssoRoundTrip(ssoBrowser, idp, pid)).location).toBe("/");
    await deps.db.insert(userIdentities).values({
      id: deps.ids.newId(),
      orgId: org.id,
      userId: m.userId,
      providerId: pid,
      issuer: "https://idp.example.test/realms/acme",
      subject: "planted-by-attacker",
      linkedAt: clock.now(),
    });
    const res = await ssoBrowser.post("/api/v1/me/sessions/revoke-others", {});
    expect(res.status).toBe(200);
    expect((await res.json()) as { unlinked: number }).toMatchObject({ unlinked: 2 });
    expect((await identitiesOf(m.userId)).map((i) => i.subject)).toEqual([]);

    const out = await owner.post(`/api/v1/members/${m.membershipId}/sign-out-everywhere`, {});
    expect(out.status).toBe(200);
    expect(await identitiesOf(m.userId)).toHaveLength(0);
    // The attacker's IdP account no longer signs in.
    idp.nextUser = { sub: "planted-by-attacker", email: "x@elsewhere.example", email_verified: false };
    expect((await ssoRoundTrip(testClient(app, deps), idp, pid)).location).toContain("error=");
  });

  it("rolls back session revocation and SSO unlinking if the audit write fails", async () => {
    const m = await seedMember(deps, org.id, { email: "atomic@kopi.sg" });
    const browser = await clientAs(app, deps, m);
    const other = await clientAs(app, deps, m);
    await deps.db.insert(userIdentities).values({
      id: deps.ids.newId(),
      orgId: org.id,
      userId: m.userId,
      providerId: pid,
      issuer: "https://idp.example.test/realms/acme",
      subject: "atomic",
      linkedAt: clock.now(),
    });
    await deps.db.execute(sql`create function reject_security_audit() returns trigger language plpgsql as $$
      begin raise exception 'audit unavailable'; end; $$`);
    await deps.db.execute(sql`create trigger reject_security_audit before insert on audit_events
      for each row execute function reject_security_audit()`);
    try {
      expect((await browser.post("/api/v1/me/sessions/revoke-others", {})).status).toBe(500);
      expect(await identitiesOf(m.userId)).toHaveLength(1);
      expect((await other.get("/api/v1/me")).status).toBe(200);
    } finally {
      await deps.db.execute(sql`drop trigger reject_security_audit on audit_events`);
      await deps.db.execute(sql`drop function reject_security_audit()`);
    }
  });

  it("first-sign-in linking by verified email emails the member", async () => {
    await seedMember(deps, org.id, { email: "notify@kopi.sg" });
    const before = sent.length;
    idp.nextUser = { sub: "notify-okta", email: "notify@kopi.sg", email_verified: true };
    expect((await ssoRoundTrip(testClient(app, deps), idp, pid)).location).toBe("/");
    expect(sent.slice(before).some((x) => x.to === "notify@kopi.sg" && /sign-in method/i.test(x.subject))).toBe(true);
  });

  describe("Entra email trust (mock IdP)", () => {
    it("does not link by email just because tid matches", async () => {
      const m = await seedMember(deps, org.id, { email: "chen@kopi.sg" });
      entra.nextUser = { sub: "e-chen", email: "chen@kopi.sg", tid: TENANT };
      expect((await ssoRoundTrip(testClient(app, deps), entra, entraId)).location).toContain("error=");
      expect(await identitiesOf(m.userId)).toHaveLength(0);
    });

    it("links by email when Entra asserts a verified domain (xms_edov)", async () => {
      const m = await seedMember(deps, org.id, { email: "dewi@kopi.sg" });
      entra.nextUser = { sub: "e-dewi", email: "dewi@kopi.sg", tid: TENANT, xms_edov: true };
      expect((await ssoRoundTrip(testClient(app, deps), entra, entraId)).location).toBe("/");
      expect(await identitiesOf(m.userId)).toHaveLength(1);
      // Later sign-ins match the linked subject without xms_edov.
      entra.nextUser = { sub: "e-dewi", email: "dewi@kopi.sg", tid: TENANT };
      expect((await ssoRoundTrip(testClient(app, deps), entra, entraId)).location).toBe("/");
    });

    it("still links through an invitation without xms_edov", async () => {
      const res = await owner.post("/api/v1/members/invitations", { email: "farah@kopi.sg", displayName: "Farah" });
      expect(res.status).toBe(201);
      const mail = sent.filter((m) => m.to === "farah@kopi.sg").at(-1)?.text ?? "";
      const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(mail)?.[1] as string;
      entra.nextUser = { sub: "e-farah", email: "farah@kopi.sg", tid: TENANT };
      expect((await ssoRoundTrip(testClient(app, deps), entra, entraId, `?invitation=${token}`)).location).toBe("/");
      const [row] = await deps.db
        .select()
        .from(userIdentities)
        .where(and(eq(userIdentities.subject, "e-farah"), eq(userIdentities.orgId, org.id)));
      expect(row).toBeTruthy();
    });
  });
});
