import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
import { emailChanges } from "../db/schema/auth.ts";
import type { Mailer } from "../deps.ts";
import type { ErrorEnvelope } from "../errors.ts";

const PASSWORD = "chicken rice with chilli";

/** Changing your own sign-in email: verified by a link to the new address; refused without SMTP. */
describe("email change", () => {
  let t: TestDb;
  const clock = movableClock("2026-11-13T01:00:00Z");
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  let app: ReturnType<typeof createApp>;
  let noMailApp: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createTestDeps>;
  let org: { id: string; slug: string };
  let sister: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock, mailer });
    app = createApp(deps);
    noMailApp = createApp(createTestDeps(t.db, { clock }));
    org = await seedOrg(deps, { slug: "kopi-kaki" });
    sister = await seedOrg(deps, { slug: "kopi-catering" });
  });
  afterAll(() => t.close());

  async function signIn(email: string, slug = org.slug, a = app) {
    const http = testClient(a, deps);
    const res = await http.post("/api/v1/auth/sign-in", { org: slug, email, password: PASSWORD });
    return { http, status: res.status };
  }
  const code = async (res: Response) => ((await res.json()) as ErrorEnvelope).error;
  const lastToken = () =>
    /\/email\/([A-Za-z0-9_-]+)/.exec(sent.findLast((m) => m.text.includes("/email/"))?.text ?? "")?.[1] ?? "";

  it("without email the change is refused, saying why, and nothing is stored", async () => {
    clock.set("2026-11-13T01:00:00Z");
    await seedMember(deps, org.id, { email: "nomail@example.sg", password: PASSWORD });
    const { http } = await signIn("nomail@example.sg", org.slug, noMailApp);
    const status = (await (await http.get("/api/v1/me/email-change")).json()) as { canChange: boolean };
    expect(status.canChange).toBe(false);
    const res = await http.post("/api/v1/me/email-change", { newEmail: "new-nomail@example.sg" });
    expect(res.status).toBe(409);
    const err = await code(res);
    expect(err.details).toMatchObject({ reason: "email_unavailable" });
    expect(err.message).toContain("can't send email");
    expect(await t.db.select().from(emailChanges)).toEqual([]);
  });

  it("needs a recent sign-in", async () => {
    clock.set("2026-11-13T01:00:00Z");
    await seedMember(deps, org.id, { email: "stale@example.sg", password: PASSWORD });
    const { http } = await signIn("stale@example.sg");
    clock.advance(11 * 60_000);
    const res = await http.post("/api/v1/me/email-change", { newEmail: "fresh@example.sg" });
    expect(res.status).toBe(403);
    expect((await code(res)).code).toBe("reauth_required");
  });

  it("changes the sign-in email in every organisation once the new address confirms", async () => {
    clock.set("2026-11-13T01:00:00Z");
    await seedMember(deps, org.id, { email: "aisyah@example.sg", password: PASSWORD });
    await seedMember(deps, sister.id, { email: "aisyah@example.sg" });
    const { http } = await signIn("aisyah@example.sg");
    const before = sent.length;
    const res = await http.post("/api/v1/me/email-change", { newEmail: "Aisyah.Rahman@Example.sg " });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ newEmail: "aisyah.rahman@example.sg", expiresAt: "2026-11-14T01:00:00.000Z" });
    const mails = sent.slice(before);
    expect(mails.map((m) => m.to)).toEqual(["aisyah.rahman@example.sg", "aisyah@example.sg"]);
    expect(mails[1]?.text).toContain("a************@example.sg");
    expect(mails[1]?.text).not.toContain("aisyah.rahman@example.sg");
    const pending = (await (await http.get("/api/v1/me/email-change")).json()) as { pending: { newEmail: string } };
    expect(pending.pending.newEmail).toBe("aisyah.rahman@example.sg");
    // Nothing changes until the link is used.
    expect((await signIn("aisyah.rahman@example.sg")).status).toBe(401);

    // The link works without a session (it may be opened on another device).
    const confirm = await testClient(app, deps).post("/api/v1/auth/email-change/confirm", { token: lastToken() });
    expect(confirm.status).toBe(200);
    expect(await confirm.json()).toEqual({ email: "aisyah.rahman@example.sg", orgSlug: "kopi-kaki" });
    expect((await signIn("aisyah.rahman@example.sg")).status).toBe(200);
    expect((await signIn("aisyah.rahman@example.sg", sister.slug)).status).toBe(200);
    expect((await signIn("aisyah@example.sg")).status).toBe(401);
    expect(sent.at(-1)).toMatchObject({ to: "aisyah@example.sg", subject: "Your Crow HR sign-in email was changed" });
    const events = await t.db.select().from(auditEvents).where(eq(auditEvents.orgId, org.id));
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(["auth.email_change_requested", "auth.email_changed"]),
    );
    // Used once.
    const again = await testClient(app, deps).post("/api/v1/auth/email-change/confirm", { token: lastToken() });
    expect(again.status).toBe(404);
  });

  it("a newer request replaces the older link; cancelling or expiry ends it", async () => {
    clock.set("2026-11-13T01:00:00Z");
    await seedMember(deps, org.id, { email: "ravi@example.sg", password: PASSWORD });
    const { http } = await signIn("ravi@example.sg");
    const confirm = (token: string) => testClient(app, deps).post("/api/v1/auth/email-change/confirm", { token });
    expect((await http.post("/api/v1/me/email-change", { newEmail: "ravi.one@example.sg" })).status).toBe(202);
    const first = lastToken();
    expect((await http.post("/api/v1/me/email-change", { newEmail: "ravi.two@example.sg" })).status).toBe(202);
    const second = lastToken();
    expect((await confirm(first)).status).toBe(404);

    expect((await http.delete("/api/v1/me/email-change")).status).toBe(204);
    expect(((await (await http.get("/api/v1/me/email-change")).json()) as { pending: unknown }).pending).toBeNull();
    expect((await confirm(second)).status).toBe(404);

    expect((await http.post("/api/v1/me/email-change", { newEmail: "ravi.three@example.sg" })).status).toBe(202);
    const third = lastToken();
    clock.advance(24 * 3600_000 + 1);
    expect((await confirm(third)).status).toBe(404);
  });

  it("refuses your current address, and an address someone else took meanwhile", async () => {
    clock.set("2026-11-13T01:00:00Z");
    await seedMember(deps, org.id, { email: "mei@example.sg", password: PASSWORD });
    const { http } = await signIn("mei@example.sg");
    const same = await http.post("/api/v1/me/email-change", { newEmail: "MEI@example.sg" });
    expect(same.status).toBe(400);
    // Whether another account uses the address isn't revealed when asking...
    expect((await http.post("/api/v1/me/email-change", { newEmail: "taken@example.sg" })).status).toBe(202);
    const token = lastToken();
    await seedMember(deps, sister.id, { email: "taken@example.sg" });
    // ...and the change can't take it over.
    const res = await testClient(app, deps).post("/api/v1/auth/email-change/confirm", { token });
    expect(res.status).toBe(409);
    expect((await code(res)).details).toMatchObject({ reason: "email_taken" });
    expect((await signIn("mei@example.sg")).status).toBe(200);
  });
});
