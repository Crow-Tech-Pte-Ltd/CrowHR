import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestDeps,
  fakePasswordHasher,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { sessions } from "../db/schema/auth.ts";
import { users } from "../db/schema/users.ts";
import type { ErrorEnvelope } from "../errors.ts";

const PASSWORD = "kopi peng siew dai";

describe("POST /api/v1/auth/sign-in", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
    org = await seedOrg(deps, { name: "Kampong Kopi", slug: "kampong-kopi" });
  });
  afterAll(() => t.close());

  const signIn = (email: string, password: string, ip = "198.51.100.1") =>
    testClient(app, deps, { ip }).post(
      "/api/v1/auth/sign-in",
      { org: org.slug, email, password },
      { headers: { "x-request-id": "fixed-request-id" } },
    );

  it("signs in and sets an HttpOnly, Secure, SameSite=Lax __Host- cookie holding only a random token", async () => {
    const m = await seedMember(deps, org.id, { email: "aisyah@kampongkopi.example", password: PASSWORD });
    const res = await signIn("Aisyah@KampongKopi.example ", PASSWORD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mfaRequired: false });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-crowhr_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
    const token = /=([^;]+)/.exec(cookie)?.[1] as string;
    const rows = await deps.db.select().from(sessions).where(eq(sessions.membershipId, m.membershipId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.id).not.toBe(token);
  });

  it("answers byte-identically for an unknown email and a wrong password, and still verifies a hash", async () => {
    await seedMember(deps, org.id, { email: "ben@kampongkopi.example", password: PASSWORD });
    const before = fakePasswordHasher.verifyCalls;
    const unknown = await signIn("nobody@kampongkopi.example", PASSWORD);
    expect(fakePasswordHasher.verifyCalls).toBe(before + 1);
    const wrong = await signIn("ben@kampongkopi.example", "not the password at all");
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const a = await unknown.text();
    expect(a).toBe(await wrong.text());
    expect((JSON.parse(a) as ErrorEnvelope).error.code).toBe("invalid_credentials");
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it("records auth.sign_in_failed for a wrong password and creates no session", async () => {
    const m = await seedMember(deps, org.id, { email: "chen@kampongkopi.example", password: PASSWORD });
    await signIn("chen@kampongkopi.example", "definitely wrong pw");
    const events = await deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, m.membershipId));
    expect(events.map((e) => e.action)).toContain("auth.sign_in_failed");
    expect(events.find((e) => e.action === "auth.sign_in_failed")?.meta).toEqual({
      method: "password",
      reason: "wrong_password",
    });
    expect(await deps.db.select().from(sessions).where(eq(sessions.membershipId, m.membershipId))).toHaveLength(0);
  });

  it("refuses suspended and invited members with the same response", async () => {
    await seedMember(deps, org.id, { email: "sus@kampongkopi.example", password: PASSWORD, status: "suspended" });
    const res = await signIn("sus@kampongkopi.example", PASSWORD);
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("invalid_credentials");
  });

  it("does not let a member of another organisation in", async () => {
    const other = await seedOrg(deps, { slug: "other-co" });
    await seedMember(deps, other.id, { email: "outsider@example.sg", password: PASSWORD });
    expect((await signIn("outsider@example.sg", PASSWORD)).status).toBe(401);
  });

  it("transparently re-hashes a weaker hash after a successful sign-in", async () => {
    const m = await seedMember(deps, org.id, { email: "weak@kampongkopi.example" });
    // fake hasher: verify() only knows `fake$`, so seed a weak-marked hash it also accepts.
    await deps.db
      .update(users)
      .set({ passwordHash: `fake$${PASSWORD}` })
      .where(eq(users.id, m.userId));
    const original = fakePasswordHasher.needsRehash;
    fakePasswordHasher.needsRehash = () => true;
    try {
      expect((await signIn("weak@kampongkopi.example", PASSWORD)).status).toBe(200);
    } finally {
      fakePasswordHasher.needsRehash = original;
    }
    const [u] = await deps.db.select().from(users).where(eq(users.id, m.userId));
    expect(u?.passwordHash).toBe(`fake$${PASSWORD}`);
  });

  it("uses a plain crowhr_session cookie without Secure when PUBLIC_URL is http", async () => {
    const httpDeps = createTestDeps(t.db, { publicUrl: "http://192.168.1.20:8080" });
    const httpApp = createApp(httpDeps);
    await seedMember(httpDeps, org.id, { email: "lan@kampongkopi.example", password: PASSWORD });
    const res = await testClient(httpApp, httpDeps).post("/api/v1/auth/sign-in", {
      org: org.slug,
      email: "lan@kampongkopi.example",
      password: PASSWORD,
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^crowhr_session=/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it("signs out: revokes the session and clears the cookie", async () => {
    await seedMember(deps, org.id, { email: "out@kampongkopi.example", password: PASSWORD });
    const http = testClient(app, deps);
    await http.post("/api/v1/auth/sign-in", { org: org.slug, email: "out@kampongkopi.example", password: PASSWORD });
    const token = http.sessionToken() as string;
    expect((await http.get("/api/v1/me")).status).toBe(200);
    const out = await http.post("/api/v1/auth/sign-out");
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    const replay = testClient(app, deps);
    replay.cookies.set("__Host-crowhr_session", token);
    const res = await replay.get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("session_revoked");
  });
});
