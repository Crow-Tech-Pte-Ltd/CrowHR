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
import { memberships } from "../db/schema/access.ts";
import { orgSecuritySettings, sessions } from "../db/schema/auth.ts";
import type { ErrorEnvelope } from "../errors.ts";

const PASSWORD = "chicken rice with chilli";

describe("sessions", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    app = createApp(deps);
    org = await seedOrg(deps);
  });
  afterAll(() => t.close());

  async function signedIn(email: string, userAgent?: string) {
    const http = testClient(app, deps, userAgent ? { userAgent } : {});
    const res = await http.post("/api/v1/auth/sign-in", { org: org.slug, email, password: PASSWORD });
    expect(res.status).toBe(200);
    return http;
  }
  const code = async (res: Response) => ((await res.json()) as ErrorEnvelope).error.code;

  it("expires after the idle timeout with session_expired", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "idle@example.sg", password: PASSWORD });
    const http = await signedIn("idle@example.sg");
    clock.advance(29 * 60_000);
    expect((await http.get("/api/v1/me")).status).toBe(200);
    clock.advance(30 * 60_000);
    const res = await http.get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("session_expired");
  });

  it("expires at the absolute timeout despite activity", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "busy@example.sg", password: PASSWORD });
    const http = await signedIn("busy@example.sg");
    for (let i = 0; i < 12 * 4; i++) {
      clock.advance(15 * 60_000);
      const res = await http.get("/api/v1/me");
      if (i < 12 * 4 - 1) expect(res.status, `request ${i}`).toBe(200);
      else {
        expect(res.status).toBe(401);
        expect(await code(res)).toBe("session_expired");
      }
    }
  });

  it("writes last_seen_at at most once per 60 seconds", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "seen@example.sg", password: PASSWORD });
    const http = await signedIn("seen@example.sg");
    clock.advance(30_000);
    await http.get("/api/v1/me");
    let [row] = await deps.db.select().from(sessions).where(eq(sessions.membershipId, m.membershipId));
    expect(row?.lastSeenAt.toISOString()).toBe("2026-10-31T01:00:00.000Z");
    clock.advance(31_000);
    await http.get("/api/v1/me");
    [row] = await deps.db.select().from(sessions).where(eq(sessions.membershipId, m.membershipId));
    expect(row?.lastSeenAt.toISOString()).toBe("2026-10-31T01:01:01.000Z");
  });

  it("rotates the token on sign-in so a planted session id is useless (fixation)", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "fix@example.sg", password: PASSWORD });
    const attacker = await signedIn("fix@example.sg");
    const planted = attacker.sessionToken() as string;
    const victim = testClient(app, deps);
    victim.cookies.set("__Host-crowhr_session", planted);
    await victim.post("/api/v1/auth/sign-in", { org: org.slug, email: "fix@example.sg", password: PASSWORD });
    expect(victim.sessionToken()).not.toBe(planted);
    // The planted session was revoked by the rotation.
    expect(await code(await attacker.get("/api/v1/me"))).toBe("session_revoked");
    expect((await victim.get("/api/v1/me")).status).toBe(200);
  });

  it("lists sessions with device, IP and current flag; revokes one and all others", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "multi@example.sg", password: PASSWORD });
    const laptop = await signedIn("multi@example.sg");
    const phone = await signedIn(
      "multi@example.sg",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
    );
    const tablet = await signedIn("multi@example.sg", "Mozilla/5.0 (Linux; Android 15) Firefox/131.0");
    const list = (await (await laptop.get("/api/v1/me/sessions")).json()) as {
      items: { id: string; device: string; current: boolean }[];
    };
    expect(list.items).toHaveLength(3);
    expect(list.items.filter((s) => s.current)).toHaveLength(1);
    expect(list.items.map((s) => s.device).sort()).toEqual(["Chrome on macOS", "Firefox on Android", "Safari on iOS"]);
    const phoneId = list.items.find((s) => s.device === "Safari on iOS")?.id as string;
    expect((await laptop.delete(`/api/v1/me/sessions/${phoneId}`)).status).toBe(204);
    expect(await code(await phone.get("/api/v1/me"))).toBe("session_revoked");
    expect((await laptop.post("/api/v1/me/sessions/revoke-others")).status).toBe(200);
    expect(await code(await tablet.get("/api/v1/me"))).toBe("session_revoked");
    expect((await laptop.get("/api/v1/me")).status).toBe(200);
  });

  it("cannot revoke someone else's session (IDOR)", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "victim@example.sg", password: PASSWORD });
    await seedMember(deps, org.id, { email: "mallory@example.sg", password: PASSWORD });
    const victim = await signedIn("victim@example.sg");
    const mallory = await signedIn("mallory@example.sg");
    const victimId = ((await (await victim.get("/api/v1/me/sessions")).json()) as { items: { id: string }[] }).items[0]
      ?.id as string;
    expect((await mallory.delete(`/api/v1/me/sessions/${victimId}`)).status).toBe(404);
    expect((await victim.get("/api/v1/me")).status).toBe(200);
  });

  it("revokes sessions on password change (except the current one) and on suspension", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "pw@example.sg", password: PASSWORD });
    const a = await signedIn("pw@example.sg");
    const b = await signedIn("pw@example.sg");
    const changed = await a.post("/api/v1/me/password", {
      currentPassword: PASSWORD,
      newPassword: "a brand new long passphrase",
    });
    expect(changed.status).toBe(204);
    expect(await code(await b.get("/api/v1/me"))).toBe("session_revoked");
    expect((await a.get("/api/v1/me")).status).toBe(200);
    await deps.db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, m.membershipId));
    expect(await code(await a.get("/api/v1/me"))).toBe("session_revoked");
  });

  it("rotates the token when switching organisation, and only into an org you belong to", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const second = await seedOrg(deps, { slug: "second-org" });
    const stranger = await seedOrg(deps, { slug: "stranger-org" });
    await seedMember(deps, org.id, { email: "switch@example.sg", password: PASSWORD });
    await seedMember(deps, second.id, { email: "switch@example.sg" });
    const http = await signedIn("switch@example.sg");
    const before = http.sessionToken();
    expect((await http.post("/api/v1/auth/switch-organisation", { org: stranger.slug })).status).toBe(404);
    const res = await http.post("/api/v1/auth/switch-organisation", { org: second.slug });
    expect(res.status).toBe(200);
    expect(http.sessionToken()).not.toBe(before);
    const me = (await (await http.get("/api/v1/me")).json()) as { organisation: { slug: string } };
    expect(me.organisation.slug).toBe("second-org");
    const old = testClient(app, deps);
    old.cookies.set("__Host-crowhr_session", before as string);
    expect(await code(await old.get("/api/v1/me"))).toBe("session_revoked");
  });

  it("rotates the token when MFA enrolment completes", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "rot-mfa@example.sg", password: PASSWORD });
    const http = await signedIn("rot-mfa@example.sg");
    const before = http.sessionToken();
    const { secret } = (await (await http.post("/api/v1/me/mfa/totp/setup")).json()) as { secret: string };
    const { totpAt } = await import("./totp.ts");
    expect((await http.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(secret, clock.now()) })).status).toBe(
      200,
    );
    expect(http.sessionToken()).not.toBe(before);
    expect((await http.get("/api/v1/me")).status).toBe(200);
  });

  it("uses the organisation's idle timeout setting", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const other = await seedOrg(deps);
    await deps.db
      .update(orgSecuritySettings)
      .set({ idleTimeoutMin: 120 })
      .where(eq(orgSecuritySettings.orgId, other.id));
    await seedMember(deps, other.id, { email: "long@example.sg", password: PASSWORD });
    const http = testClient(app, deps);
    await http.post("/api/v1/auth/sign-in", { org: other.slug, email: "long@example.sg", password: PASSWORD });
    clock.advance(119 * 60_000);
    expect((await http.get("/api/v1/me")).status).toBe(200);
  });
});
