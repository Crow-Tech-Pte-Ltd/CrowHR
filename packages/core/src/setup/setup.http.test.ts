import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb, testClient } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { orgSecuritySettings } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import { systemSettings } from "../db/schema/system.ts";
import { users } from "../db/schema/users.ts";
import type { Clock } from "../deps.ts";
import { generateSetupCode, hashSetupCode, normaliseSetupCode, SETUP_CODE_ALPHABET } from "./code.ts";
import { SETUP_CODE_HEADER } from "./routes.ts";
import { isSetupRequired, slugForOrganisation, storeSetupCode } from "./service.ts";

const CODE = "ACDE-FGHJ-KMNP-QRTU";
const body = {
  organisationName: "Kampong Kopi Pte. Ltd.",
  ownerName: "Aisyah Rahman",
  ownerEmail: " Aisyah@KampongKopi.example ",
  ownerPassword: "kopi-o kosong peng, siew dai",
};

describe("first-run setup", () => {
  let testDb: TestDb;
  let now: Date;
  const clock: Clock = { now: () => new Date(now.getTime()) };

  beforeEach(async () => {
    testDb = await createTestDb();
    now = new Date("2026-10-31T01:00:00Z");
  });
  afterEach(() => testDb.close());

  const setup = (ip = "203.0.113.9") => {
    const deps = createTestDeps(testDb.db, { clock });
    const app = createApp(deps);
    const http = testClient(app, deps, { ip });
    const post = (path: string, code: string | null, json?: unknown) =>
      http.request(`/api/v1/setup${path}`, {
        method: "POST",
        ...(json === undefined ? {} : { json }),
        headers: code ? { [SETUP_CODE_HEADER]: code } : {},
      });
    return { deps, app, http, post };
  };

  it("codes are 16 unambiguous characters, grouped in fours", () => {
    const code = generateSetupCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    for (const ch of normaliseSetupCode(code)) expect(SETUP_CODE_ALPHABET).toContain(ch);
    for (const ambiguous of ["0", "O", "1", "I", "L", "5", "S", "8", "B", "2", "Z"]) {
      expect(SETUP_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("stores only the hash of the code", async () => {
    await storeSetupCode(testDb.db, CODE, now);
    const rows = await testDb.db.select().from(systemSettings);
    expect(JSON.stringify(rows)).not.toContain("ACDE");
    expect(rows[0]?.value).toMatchObject({ hash: await hashSetupCode(CODE) });
  });

  it("reports setup as required on a fresh install", async () => {
    const res = await setup().http.get("/api/v1/setup");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: true });
  });

  it("verifies the code, tolerating case, spaces and missing dashes", async () => {
    await storeSetupCode(testDb.db, CODE, now);
    const { post } = setup();
    expect((await post("/verify", "acde fghj kmnp qrtu")).status).toBe(204);
    const wrong = await post("/verify", "ACDE-FGHJ-KMNP-QRTV");
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toMatchObject({ code: "invalid_setup_code", details: { attemptsLeft: 4 } });
    expect((await post("/verify", null)).status).toBe(401);
  });

  it("blocks an IP for 15 minutes after five wrong codes, without affecting other IPs", async () => {
    await storeSetupCode(testDb.db, CODE, now);
    const a = setup("203.0.113.9");
    for (let i = 0; i < 5; i++) expect((await a.post("/verify", "WRONG")).status).toBe(401);
    const blocked = await a.post("/verify", CODE);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    // Same app (same limiter), different client IP.
    const other = testClient(a.app, a.deps, { ip: "198.51.100.1" });
    const otherVerify = await other.request("/api/v1/setup/verify", {
      method: "POST",
      headers: { [SETUP_CODE_HEADER]: CODE },
    });
    expect(otherVerify.status).toBe(204);
    now = new Date(now.getTime() + 14 * 60_000);
    expect((await a.post("/verify", CODE)).status).toBe(429);
    now = new Date(now.getTime() + 61_000);
    expect((await a.post("/verify", CODE)).status).toBe(204);
  });

  it("creates the organisation and owner through the identity model in one transaction, signs in, then 404s", async () => {
    await storeSetupCode(testDb.db, CODE, now);
    const { post, http } = setup();
    const res = await post("", CODE, body);
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out).toMatchObject({ organisationSlug: "kampong-kopi" });

    const [org] = await testDb.db.select().from(organisations);
    expect(org).toMatchObject({ id: out.organisationId, name: "Kampong Kopi Pte. Ltd.", slug: "kampong-kopi" });
    expect(await testDb.db.select().from(orgSecuritySettings)).toHaveLength(1);
    const [user] = await testDb.db.select().from(users).where(eq(users.id, out.ownerUserId));
    expect(user).toMatchObject({ email: "aisyah@kampongkopi.example", displayName: "Aisyah Rahman" });
    expect(user?.passwordHash).toBe(`fake$${body.ownerPassword}`);
    const [membership] = await testDb.db.select().from(memberships);
    expect(membership).toMatchObject({ orgId: out.organisationId, userId: out.ownerUserId, status: "active" });
    expect((await testDb.db.select().from(membershipRoles)).map((r) => r.role)).toEqual(["owner"]);
    const events = await testDb.db.select().from(auditEvents).where(eq(auditEvents.action, "setup.completed"));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(body.ownerPassword);
    expect(await testDb.db.select().from(systemSettings)).toEqual([]);
    expect(await isSetupRequired(testDb.db)).toBe(false);

    // Signed in as the owner straight away (MFA enrolment is offered next).
    expect(http.sessionToken()).toBeTruthy();
    const me = await http.get("/api/v1/me");
    expect([200, 403]).toContain(me.status);
    const meBody = await me.json();
    if (me.status === 403) expect(meBody.error.code).toBe("mfa_enrolment_required");

    // A fresh browser can sign in with the new credentials.
    const fresh = setup("198.51.100.7").http;
    const signIn = await fresh.post("/api/v1/auth/sign-in", {
      org: "kampong-kopi",
      email: "aisyah@kampongkopi.example",
      password: body.ownerPassword,
    });
    expect(signIn.status).toBe(200);

    const after = setup();
    expect((await after.http.get("/api/v1/setup")).status).toBe(404);
    expect((await after.post("/verify", CODE)).status).toBe(404);
    expect((await after.post("", CODE, body)).status).toBe(404);
  });

  it("applies the identity password policy and validates fields with fix-it messages", async () => {
    await storeSetupCode(testDb.db, CODE, now);
    const { post } = setup();
    const weak = await post("", CODE, { ...body, ownerPassword: "Password!2026" });
    expect(weak.status).toBe(400);
    const [issue] = (await weak.json()).error.details.issues;
    expect(issue.path).toBe("ownerPassword");
    expect(issue.message.length).toBeGreaterThan(10);
    const bad = await post("", CODE, { ...body, ownerEmail: "nope", organisationName: "" });
    const paths = (await bad.json()).error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(["organisationName", "ownerEmail"]);
    expect(await isSetupRequired(testDb.db)).toBe(true);
    expect(await testDb.db.select().from(users)).toEqual([]);
  });

  it("refuses to complete setup with a wrong code", async () => {
    await storeSetupCode(testDb.db, CODE, now);
    const { post } = setup();
    expect((await post("", "WRONG-CODE", body)).status).toBe(401);
    expect(await isSetupRequired(testDb.db)).toBe(true);
  });

  it("derives a sign-in slug from the registered name", () => {
    expect(slugForOrganisation("Kampong Kopi Pte. Ltd.")).toBe("kampong-kopi");
    expect(slugForOrganisation("Tan & Sons Private Limited")).toBe("tan-sons");
    expect(slugForOrganisation("Café Ümlaut LLP")).toBe("cafe-umlaut");
    expect(slugForOrganisation("Pte. Ltd.")).toBe("org");
  });
});
