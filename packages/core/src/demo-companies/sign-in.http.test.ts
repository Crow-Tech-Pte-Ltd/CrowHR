import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestDeps,
  movableClock,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
  testDemoCompanies,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { sha256Base64Url } from "../crypto/tokens.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { deviceSessions, sessions } from "../db/schema/auth.ts";
import type { ErrorEnvelope } from "../errors.ts";

/**
 * Persona sign-in for demo companies (demo-companies "Persona sign-in for a demo company", "Demo
 * companies are not discoverable"; auth: persona sign-in also serves a live demo company, in the
 * browser and for the apps' native sign-in). Everything else stays 404.
 */
const HOUR = 3_600_000;
const START = "2026-11-10T02:15:00.000Z";
const REDIRECT = "crowtech.crowhr:/oauth2redirect";
const VERIFIER = `${"v".repeat(20)}erifier-0123456789-abcdefghijklmnop`;

interface Persona {
  membershipId: string;
  displayName: string;
  email: string;
  roles: string[];
  persona?: { key: string; label: string; blurb: string; order: number };
}

describe("demo companies: persona sign-in", () => {
  let t: TestDb;
  const clock = movableClock(START);
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let slug: string;
  let real: { id: string; slug: string };
  let realOwner: { membershipId: string };

  beforeEach(async () => {
    clock.set(START);
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    deps = createTestDeps(t.db, { clock, demoCompanies: testDemoCompanies(() => deps) });
    app = createApp(deps);
    real = await seedOrg(deps, { slug: "real-co", name: "Real Co" });
    realOwner = await seedMember(deps, real.id, { roles: ["owner"], password: "correct horse battery" });
    const res = await testClient(app, deps).post("/api/v1/demo-companies", {});
    slug = ((await res.json()) as { slug: string }).slug;
  });
  afterEach(() => t.close());

  const personas = async (org = slug) => {
    const res = await app.request(`/api/v1/auth/demo/personas?org=${org}`);
    return { status: res.status, items: res.status === 200 ? ((await res.json()) as { items: Persona[] }).items : [] };
  };
  const personaFor = async (key: string) => (await personas()).items.find((p) => p.persona?.key === key) as Persona;
  const code = async (r: Response) => ((await r.json()) as ErrorEnvelope).error.code;

  it("lists the demo company's people with their picker labels", async () => {
    const { status, items } = await personas();
    expect(status).toBe(200);
    expect(items.map((p) => p.persona?.key)).toEqual(["owner", "hr", "manager", "employee"]);
    expect(items.find((p) => p.persona?.key === "owner")?.roles).toEqual(["owner"]);
  });

  it("signs in as a person in the browser with one tap, audited as demo_persona", async () => {
    const employee = await personaFor("employee");
    const browser = testClient(app, deps);
    const res = await browser.post("/api/v1/auth/demo/sign-in", { membershipId: employee.membershipId, org: slug });
    expect(res.status).toBe(204);
    const me = (await (await browser.get("/api/v1/me")).json()) as {
      membershipId: string;
      demoCompany: { expiresAt: string } | null;
      hasPassword: boolean;
    };
    expect(me.membershipId).toBe(employee.membershipId);
    expect(me.demoCompany).toEqual({ expiresAt: new Date(Date.parse(START) + 72 * HOUR).toISOString() });
    expect(me.hasPassword).toBe(false);
    const events = await t.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.signed_in"));
    expect(events.map((e) => e.meta)).toEqual([{ method: "demo_persona" }]);
  });

  it("signs the Crow HR app in as a person: native code, then a device session named by platform", async () => {
    const challenge = await sha256Base64Url(VERIFIER);
    const authorize = await app.request(
      `/api/v1/native/authorize?org=${slug}&client=android&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=state-12345678`,
    );
    expect(authorize.status).toBe(302);
    const location = authorize.headers.get("location") as string;
    expect(location.startsWith(`/sign-in/${slug}?native=`)).toBe(true);
    const native = location.split("native=")[1] as string;

    const employee = await personaFor("employee");
    const browser = testClient(app, deps);
    const res = await browser.post("/api/v1/auth/demo/sign-in", {
      membershipId: employee.membershipId,
      org: slug,
      native,
    });
    expect(res.status).toBe(200);
    expect(browser.sessionToken()).toBeUndefined();
    const url = new URL(((await res.json()) as { redirectTo: string }).redirectTo);
    expect(`${url.protocol}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("state-12345678");

    const token = await app.request("/api/v1/native/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "authorization_code",
        code: url.searchParams.get("code"),
        codeVerifier: VERIFIER,
        deviceName: "Daniel's Pixel 9",
        appVersion: "1.0.0",
      }),
    });
    expect(token.status).toBe(200);
    const { accessToken } = (await token.json()) as { accessToken: string };
    const me = (await (
      await app.request("/api/v1/me", { headers: { authorization: `Bearer ${accessToken}` } })
    ).json()) as { membershipId: string; demoCompany: unknown };
    expect(me.membershipId).toBe(employee.membershipId);
    expect(me.demoCompany).not.toBeNull();
    const [device] = await t.db.select().from(deviceSessions);
    expect(device?.deviceName).toBe("Android phone");
    const notices = JSON.stringify(await t.db.select().from(auditEvents));
    expect(notices).not.toContain("Daniel's Pixel 9");
  });

  it("answers 404 for a real organisation's member on the same server, issuing nothing", async () => {
    const before = (await t.db.select().from(sessions)).length;
    const res = await testClient(app, deps).post("/api/v1/auth/demo/sign-in", {
      membershipId: realOwner.membershipId,
      org: real.slug,
    });
    expect(res.status).toBe(404);
    const wrongOrg = await testClient(app, deps).post("/api/v1/auth/demo/sign-in", {
      membershipId: realOwner.membershipId,
      org: slug,
    });
    expect(wrongOrg.status).toBe(404);
    expect((await personas(real.slug)).status).toBe(404);
    expect((await t.db.select().from(sessions)).length).toBe(before);
  });

  it("answers 404 without the organisation's short name", async () => {
    const employee = await personaFor("employee");
    expect(
      (await testClient(app, deps).post("/api/v1/auth/demo/sign-in", { membershipId: employee.membershipId })).status,
    ).toBe(404);
    expect((await app.request("/api/v1/auth/demo/personas")).status).toBe(404);
  });

  it("answers 404 once the copy has expired, ends its sessions, and says it has ended", async () => {
    const employee = await personaFor("employee");
    const browser = testClient(app, deps);
    await browser.post("/api/v1/auth/demo/sign-in", { membershipId: employee.membershipId, org: slug });
    clock.advance(72 * HOUR + 1000);
    expect((await browser.get("/api/v1/me")).status).toBe(401);
    expect((await personas()).status).toBe(404);
    const again = await testClient(app, deps).post("/api/v1/auth/demo/sign-in", {
      membershipId: employee.membershipId,
      org: slug,
    });
    expect(again.status).toBe(404);
    const methods = await app.request(`/api/v1/auth/methods?org=${slug}`);
    expect(methods.status).toBe(404);
    const error = ((await methods.json()) as ErrorEnvelope).error;
    expect(error.details).toEqual({ demoCompanyEnded: true, tryPath: "/try" });
    expect(error.message).toContain("This demo company has ended");
  });

  it("answers 404 everywhere when the mode is off, even for an existing demo company", async () => {
    const employee = await personaFor("employee");
    const browser = testClient(app, deps);
    await browser.post("/api/v1/auth/demo/sign-in", { membershipId: employee.membershipId, org: slug });
    const off = createTestDeps(t.db, { clock });
    const offApp = createApp(off);
    expect((await offApp.request(`/api/v1/auth/demo/personas?org=${slug}`)).status).toBe(404);
    const signIn = await testClient(offApp, off).post("/api/v1/auth/demo/sign-in", {
      membershipId: employee.membershipId,
      org: slug,
    });
    expect(signIn.status).toBe(404);
    expect((await offApp.request(`/api/v1/auth/methods?org=${slug}`)).status).toBe(404);
    // A session made while the mode was on stops working.
    const cookie = [...browser.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    expect((await offApp.request("/api/v1/me", { headers: { cookie } })).status).toBe(401);
  });

  it("refuses a pool copy that nobody was handed", async () => {
    const pooled = createTestDeps(t.db, { clock, demoCompanies: testDemoCompanies(() => pooled, { poolSize: 1 }) });
    await createApp(pooled).jobs.tick();
    const [call] = (pooled.demoCompanies as ReturnType<typeof testDemoCompanies>).calls;
    expect(call?.claimedAt).toBeNull();
    expect((await personas(call?.slug)).status).toBe(404);
    expect((await app.request(`/api/v1/auth/methods?org=${call?.slug}`)).status).toBe(404);
  });

  it("offers persona sign-in only, with the expiry, on the sign-in methods", async () => {
    const methods = (await (await app.request(`/api/v1/auth/methods?org=${slug}`)).json()) as Record<string, unknown>;
    expect(methods).toMatchObject({
      orgSlugRequired: false,
      organisation: { name: "Kopi Kaki Pte. Ltd.", slug },
      password: { enabled: false },
      providers: [],
      demoMode: false,
      demoCompany: { expiresAt: new Date(Date.parse(START) + 72 * HOUR).toISOString() },
    });
    const realMethods = (await (await app.request(`/api/v1/auth/methods?org=${real.slug}`)).json()) as Record<
      string,
      unknown
    >;
    expect(realMethods.demoCompany).toBeNull();
    expect(realMethods.password).toEqual({ enabled: true });
    // No organisation named: a server with demo companies always asks.
    expect(await (await app.request("/api/v1/auth/methods")).json()).toMatchObject({ orgSlugRequired: true });
  });

  it("refuses password sign-in for a demo company's people (they have no password)", async () => {
    const employee = await personaFor("employee");
    const res = await testClient(app, deps).post("/api/v1/auth/sign-in", {
      org: slug,
      email: employee.email,
      password: "anything at all",
    });
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("invalid_credentials");
  });

  it("never lists demo companies in meta, and answers demo: true with a sign-in method for one", async () => {
    const meta = (await (await app.request("/api/v1/meta")).json()) as {
      demo: boolean;
      orgSlugRequired: boolean;
      organisations: { slug: string; displayName: string }[];
    };
    expect(meta.demo).toBe(false);
    expect(meta.orgSlugRequired).toBe(true);
    expect(meta.organisations).toEqual([]);
    expect(JSON.stringify(meta)).not.toContain(slug);
    expect(JSON.stringify(meta)).not.toContain("Kopi Kaki");

    const one = (await (await app.request(`/api/v1/meta?org=${slug}`)).json()) as {
      demo: boolean;
      organisations: { slug: string; signInMethods: { kind: string; displayName: string }[] }[];
    };
    expect(one.demo).toBe(true);
    expect(one.organisations).toHaveLength(1);
    expect(one.organisations[0]?.slug).toBe(slug);
    // The 1.0.0 apps need at least one method to carry on to the server's sign-in page.
    expect(one.organisations[0]?.signInMethods).toHaveLength(1);

    const realMeta = (await (await app.request(`/api/v1/meta?org=${real.slug}`)).json()) as { demo: boolean };
    expect(realMeta.demo).toBe(false);
  });

  it("keeps meta's single-organisation listing on a server without demo companies", async () => {
    const plain = createTestDeps(t.db, { clock });
    // Demo companies are rows here too, but they never count toward "the only organisation".
    const meta = (await (await createApp(plain).request("/api/v1/meta")).json()) as {
      orgSlugRequired: boolean;
      organisations: { slug: string }[];
    };
    expect(meta.orgSlugRequired).toBe(false);
    expect(meta.organisations.map((o) => o.slug)).toEqual([real.slug]);
  });

  it("keeps the browser demo's persona sign-in as it was", async () => {
    const demoDb = await createTestDb();
    try {
      const browserDemo = createTestDeps(demoDb.db, { demoMode: true });
      const org = await seedOrg(browserDemo, { slug: "kopi-kaki" });
      const owner = await seedMember(browserDemo, org.id, { roles: ["owner"] });
      const demoApp = createApp(browserDemo);
      const list = (await (await demoApp.request("/api/v1/auth/demo/personas")).json()) as { items: Persona[] };
      expect(list.items).toEqual([
        { membershipId: owner.membershipId, displayName: expect.any(String), email: owner.email, roles: ["owner"] },
      ]);
      const http = testClient(demoApp, browserDemo);
      expect((await http.post("/api/v1/auth/demo/sign-in", { membershipId: owner.membershipId })).status).toBe(204);
      expect((await http.get("/api/v1/me")).status).toBe(200);
    } finally {
      await demoDb.close();
    }
  });
});
