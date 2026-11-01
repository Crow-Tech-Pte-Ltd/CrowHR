import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  movableClock,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import type { Mailer } from "../deps.ts";
import type { ErrorEnvelope } from "../errors.ts";

const OLD = "old passphrase here ok";
const NEW = "fresh new passphrase 26";

describe("password reset", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  const sent: { to: string; text: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock, mailer });
    app = createApp(deps);
    org = await seedOrg(deps);
  });
  afterAll(() => t.close());

  const request = (email: string) =>
    testClient(app, deps).post("/api/v1/auth/password-reset/request", { org: org.slug, email });
  const lastToken = () => (/\/reset\/([A-Za-z0-9_-]+)/.exec(sent.at(-1)?.text ?? "")?.[1] ?? "") as string;

  it("answers the same 202 for an unknown email and sends nothing", async () => {
    const before = sent.length;
    const unknown = await request("nobody@example.sg");
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toEqual({ accepted: true, emailConfigured: true });
    expect(sent.length).toBe(before);
  });

  it("emails a single-use link; completing it revokes every session and is audited", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "forgot@example.sg", password: OLD });
    const existing = await clientAs(app, deps, m);
    expect((await request("forgot@example.sg")).status).toBe(202);
    const token = lastToken();
    expect(token).toHaveLength(43);
    const anon = testClient(app, deps);
    expect(
      ((await (await anon.post("/api/v1/auth/password-reset/inspect", { token })).json()) as { status: string }).status,
    ).toBe("valid");
    expect((await anon.post("/api/v1/auth/password-reset/complete", { token, password: NEW })).status).toBe(200);
    expect(((await (await existing.get("/api/v1/me")).json()) as ErrorEnvelope).error.code).toBe("session_revoked");
    const reused = await anon.post("/api/v1/auth/password-reset/complete", { token, password: NEW });
    expect(reused.status).toBe(409);
    expect(((await reused.json()) as ErrorEnvelope).error.message).toContain("expired or was already used");
    const events = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.password_reset"));
    expect(events).toHaveLength(1);
    const signIn = await testClient(app, deps).post("/api/v1/auth/sign-in", {
      org: org.slug,
      email: "forgot@example.sg",
      password: NEW,
    });
    expect(signIn.status).toBe(200);
  });

  it("expires after 60 minutes", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "slow@example.sg", password: OLD });
    await request("slow@example.sg");
    const token = lastToken();
    clock.advance(60 * 60_000);
    const anon = testClient(app, deps);
    expect(
      ((await (await anon.post("/api/v1/auth/password-reset/inspect", { token })).json()) as { status: string }).status,
    ).toBe("expired_or_used");
    expect((await anon.post("/api/v1/auth/password-reset/complete", { token, password: NEW })).status).toBe(409);
  });

  it("without SMTP an owner generates a one-time link, audited with admin and employee", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const noMail = createTestDeps(t.db, { clock });
    const noMailApp = createApp(noMail);
    const hr = await seedMember(noMail, org.id, { roles: ["owner"], email: "hr-admin@example.sg" });
    const emp = await seedMember(noMail, org.id, { email: "employee-r@example.sg", password: OLD });
    const http = await clientAs(noMailApp, noMail, hr);
    const res = await http.post(`/api/v1/members/${emp.membershipId}/password-reset-link`);
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^https:\/\/hr\.test\/reset\//);
    const [event] = await noMail.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "auth.reset_link_generated"));
    expect(event).toMatchObject({ actorMembershipId: hr.membershipId, targetId: emp.membershipId });
    const token = url.split("/reset/")[1] as string;
    expect(
      (await testClient(noMailApp, noMail).post("/api/v1/auth/password-reset/complete", { token, password: NEW }))
        .status,
    ).toBe(200);
  });
});
