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
import { authThrottle } from "../db/schema/auth.ts";
import type { Mailer } from "../deps.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { totpAt } from "./totp.ts";

const PASSWORD = "teh tarik kurang manis";

/**
 * Lockout design (auth spec "Sign-in throttling"): wrong passwords lock the (account, network)
 * pair after 10 tries; across all networks a per-account ceiling of 50 pauses sign-in from new
 * devices only, so nobody can lock a member (or an owner) out of a browser they used before.
 */
describe("sign-in throttling and lockout", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  let ipCounter = 0;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock, mailer });
    app = createApp(deps);
    org = await seedOrg(deps);
  });
  afterAll(() => t.close());

  const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  const attempt = (email: string, password: string, ip = freshIp()) =>
    testClient(app, deps, { ip }).post("/api/v1/auth/sign-in", { org: org.slug, email, password });

  it("10 wrong passwords from one network start progressive network delays", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "lock@example.sg", password: PASSWORD });
    for (let i = 0; i < 10; i++)
      expect((await attempt("lock@example.sg", "wrong password here", "198.51.100.7")).status).toBe(401);
    const right = await attempt("lock@example.sg", PASSWORD, "198.51.100.7");
    expect(right.status).toBe(401);
    expect(((await right.json()) as ErrorEnvelope).error.code).toBe("invalid_credentials");
    const actions = (await deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, m.membershipId))).map(
      (e) => e.action,
    );
    expect(actions.filter((a) => a === "auth.locked")).toHaveLength(1);
    // The real member on another network is not affected (the lockout-DoS fix).
    expect((await attempt("lock@example.sg", PASSWORD, "203.0.113.20")).status).toBe(200);

    clock.advance(15 * 60_000);
    expect((await attempt("lock@example.sg", PASSWORD, "198.51.100.7")).status).toBe(200);
  });

  it("doubles the network delay up to 30 seconds without extending the account ceiling", async () => {
    clock.set("2026-10-31T08:00:00Z");
    await seedMember(deps, org.id, { email: "progress@example.sg", password: PASSWORD });
    const { passwordLockState } = await import("./throttle.ts");
    const { userId } = await seedMember(deps, org.id, { email: "delay@example.sg", password: PASSWORD });
    for (let i = 0; i < 10; i++) await attempt("delay@example.sg", "wrong", "198.51.100.99");
    for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
      const state = await passwordLockState(deps.db, userId, "198.51.100.99", clock.now());
      expect(state.network?.getTime()).toBe(clock.now().getTime() + seconds * 1000);
      clock.advance(seconds * 1000);
      await attempt("delay@example.sg", "wrong", "198.51.100.99");
    }
    for (let i = 0; i < 50; i++) await attempt("progress@example.sg", "wrong", freshIp());
    expect((await attempt("progress@example.sg", PASSWORD)).status).toBe(401);
    // Wrong guesses while paused do not move the deadline; even a new browser can recover.
    clock.advance(30_000);
    for (let i = 0; i < 10; i++) await attempt("progress@example.sg", "wrong", freshIp());
    expect((await attempt("progress@example.sg", PASSWORD)).status).toBe(200);
  });

  it("resets the network's counter on success", async () => {
    clock.set("2026-10-31T01:30:00Z");
    await seedMember(deps, org.id, { email: "reset@example.sg", password: PASSWORD });
    for (let i = 0; i < 9; i++) await attempt("reset@example.sg", "wrong password here", "198.51.100.8");
    expect((await attempt("reset@example.sg", PASSWORD, "198.51.100.8")).status).toBe(200);
    for (let i = 0; i < 9; i++) await attempt("reset@example.sg", "wrong password here", "198.51.100.8");
    expect((await attempt("reset@example.sg", PASSWORD, "198.51.100.8")).status).toBe(200);
  });

  it("an attacker spraying from many networks cannot lock an owner out of a browser they used before", async () => {
    clock.set("2026-10-31T02:00:00Z");
    await seedMember(deps, org.id, { email: "boss@example.sg", password: PASSWORD, roles: ["owner"] });
    // The owner signed in from this browser earlier: it holds a known-device cookie.
    const ownerBrowser = testClient(app, deps, { ip: "192.0.2.10" });
    expect(
      (await ownerBrowser.post("/api/v1/auth/sign-in", { org: org.slug, email: "boss@example.sg", password: PASSWORD }))
        .status,
    ).toBe(200);
    await ownerBrowser.post("/api/v1/auth/sign-out");

    // 60 wrong passwords, 6 per network, so no single network is locked.
    for (let i = 0; i < 60; i++) {
      const ip = `172.16.${Math.floor(i / 6)}.9`;
      expect((await attempt("boss@example.sg", "wrong password here", ip)).status).toBe(401);
    }
    // A new device is paused (brute-force ceiling) ...
    expect((await attempt("boss@example.sg", PASSWORD, "192.0.2.99")).status).toBe(401);
    // ... but the owner's own browser still signs in, even from a new network.
    const again = await ownerBrowser.request("/api/v1/auth/sign-in", {
      method: "POST",
      json: { org: org.slug, email: "boss@example.sg", password: PASSWORD },
      headers: { "x-crowhr-client-ip": "192.0.2.77" },
    });
    expect(again.status).toBe(200);
    expect(sent.some((m) => m.to === "boss@example.sg" && /new devices/i.test(m.text))).toBe(true);
    clock.advance(15 * 60_000);
    expect((await attempt("boss@example.sg", PASSWORD, "192.0.2.99")).status).toBe(200);
  });

  it("a known-device cookie only helps the account that earned it", async () => {
    clock.set("2026-10-31T03:00:00Z");
    await seedMember(deps, org.id, { email: "alice@example.sg", password: PASSWORD });
    await seedMember(deps, org.id, { email: "victim@example.sg", password: PASSWORD });
    const browser = testClient(app, deps, { ip: "192.0.2.30" });
    await browser.post("/api/v1/auth/sign-in", { org: org.slug, email: "alice@example.sg", password: PASSWORD });
    await browser.post("/api/v1/auth/sign-out");
    for (let i = 0; i < 50; i++)
      await attempt("victim@example.sg", "wrong password here", `172.17.${Math.floor(i / 5)}.9`);
    const res = await browser.post("/api/v1/auth/sign-in", {
      org: org.slug,
      email: "victim@example.sg",
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
  });

  it("refuses the 31st attempt per IP per minute with 429 and Retry-After", async () => {
    clock.set("2026-10-31T02:00:05Z");
    for (let i = 0; i < 30; i++)
      expect((await attempt("nobody@example.sg", "whatever pw 123", "203.0.113.50")).status).toBe(401);
    const blocked = await attempt("nobody@example.sg", "whatever pw 123", "203.0.113.50");
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as ErrorEnvelope).error.code).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBe(55);
    clock.advance(60_000);
    expect((await attempt("nobody@example.sg", "whatever pw 123", "203.0.113.50")).status).toBe(401);
  });

  it("does not count successful sign-ins against the network: a busy office signs in freely", async () => {
    clock.set("2026-10-31T02:30:05Z");
    for (let i = 0; i < 40; i++)
      await seedMember(deps, org.id, { email: `staff${i}@office.example`, password: PASSWORD });
    for (let i = 0; i < 40; i++)
      expect((await attempt(`staff${i}@office.example`, PASSWORD, "203.0.113.80")).status).toBe(200);
    // Failures from that same network still hit the 30-per-minute budget.
    for (let i = 0; i < 30; i++)
      expect((await attempt("nobody@example.sg", "whatever pw 123", "203.0.113.80")).status).toBe(401);
    expect((await attempt("nobody@example.sg", "whatever pw 123", "203.0.113.80")).status).toBe(429);
  });

  it("lets an owner clear a member's lockout", async () => {
    clock.set("2026-10-31T04:00:00Z");
    const owner = await seedMember(deps, org.id, { roles: ["owner"] });
    const m = await seedMember(deps, org.id, { email: "locked2@example.sg", password: PASSWORD });
    for (let i = 0; i < 50; i++)
      await attempt("locked2@example.sg", "wrong password here", `172.18.${Math.floor(i / 5)}.9`);
    const http = await clientAs(app, deps, owner);
    const list = await http.get(`/api/v1/members/${m.membershipId}`);
    expect(((await list.json()) as { lockedUntil: string | null }).lockedUntil).toBe("2026-10-31T04:00:30.000Z");
    expect((await attempt("locked2@example.sg", PASSWORD)).status).toBe(401);
    expect((await http.post(`/api/v1/members/${m.membershipId}/unlock`)).status).toBe(204);
    expect((await attempt("locked2@example.sg", PASSWORD)).status).toBe(200);
  });

  it("does not let hr_admin clear lockouts", async () => {
    const hr = await seedMember(deps, org.id, { roles: ["hr_admin"] });
    const m = await seedMember(deps, org.id);
    const http = await clientAs(app, deps, hr);
    expect((await http.post(`/api/v1/members/${m.membershipId}/unlock`)).status).toBe(403);
  });
});

describe("MFA guess budget (finding 12)", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  const sent: { to: string; subject: string; text: string }[] = [];
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

  async function enrolled(email: string) {
    const m = await seedMember(deps, org.id, { email, password: PASSWORD });
    const http = await clientAs(app, deps, m);
    const setup = (await (await http.post("/api/v1/me/mfa/totp/setup")).json()) as { secret: string };
    expect(
      (await http.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(setup.secret, clock.now()) })).status,
    ).toBe(200);
    clock.advance(31_000);
    return { m, secret: setup.secret, http };
  }
  const passwordStep = async (email: string, ip: string) => {
    const http = testClient(app, deps, { ip });
    const res = await http.post("/api/v1/auth/sign-in", { org: org.slug, email, password: PASSWORD });
    expect(res.status).toBe(200);
    return { http, token: ((await res.json()) as { mfaToken: string }).mfaToken };
  };

  it("wrong codes across fresh challenges lock MFA for the account (no unlimited budget)", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const { secret } = await enrolled("mfa@example.sg");
    for (let round = 0; round < 3; round++) {
      const { http, token } = await passwordStep("mfa@example.sg", `10.9.0.${round + 1}`);
      for (let i = 0; i < 2; i++) await http.post("/api/v1/auth/mfa/verify", { mfaToken: token, code: "000000" });
    }
    // 6 wrong codes: the account's MFA is now locked, even with the right code and a fresh challenge.
    const { http, token } = await passwordStep("mfa@example.sg", "10.9.1.1");
    const ok = await http.post("/api/v1/auth/mfa/verify", { mfaToken: token, code: await totpAt(secret, clock.now()) });
    expect(ok.status).toBe(401);
    expect(((await ok.json()) as ErrorEnvelope).error.code).toBe("invalid_mfa_code");
    expect(sent.some((m) => m.to === "mfa@example.sg" && /two-step/i.test(m.subject))).toBe(true);
    clock.advance(15 * 60_000 + 31_000);
    const later = await passwordStep("mfa@example.sg", "10.9.1.2");
    expect(
      (
        await later.http.post("/api/v1/auth/mfa/verify", {
          mfaToken: later.token,
          code: await totpAt(secret, clock.now()),
        })
      ).status,
    ).toBe(200);
  });

  it("/reauth wrong codes count toward the same counter", async () => {
    clock.set("2026-10-31T03:00:00Z");
    const { secret, http } = await enrolled("reauth@example.sg");
    for (let i = 0; i < 5; i++) {
      const r = await http.post("/api/v1/auth/reauth", { password: PASSWORD, code: "000000" });
      expect(r.status).toBe(401);
    }
    const right = await http.post("/api/v1/auth/reauth", {
      password: PASSWORD,
      code: await totpAt(secret, clock.now()),
    });
    expect(right.status).toBe(401);
    const { http: b, token } = await passwordStep("reauth@example.sg", "10.9.2.1");
    clock.advance(31_000);
    expect(
      (await b.post("/api/v1/auth/mfa/verify", { mfaToken: token, code: await totpAt(secret, clock.now()) })).status,
    ).toBe(401);
  });

  it("serializes concurrent wrong codes against the same per-user budget", async () => {
    clock.set("2026-10-31T09:00:00Z");
    const { m } = await enrolled("parallel@example.sg");
    const { http, token } = await passwordStep("parallel@example.sg", "10.9.5.1");
    const wrong = () => http.post("/api/v1/auth/mfa/verify", { mfaToken: token, code: "000000" });
    for (let i = 0; i < 4; i++) await wrong();
    const responses = await Promise.all([wrong(), wrong(), wrong()]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
    const [counter] = await deps.db
      .select()
      .from(authThrottle)
      .where(eq(authThrottle.key, `mfa:${m.userId}`));
    expect(counter?.count).toBe(5);
  });

  it("the password lockout clears only after the second factor succeeds", async () => {
    clock.set("2026-10-31T05:00:00Z");
    await enrolled("half@example.sg");
    const ip = "10.9.3.1";
    const wrong = () =>
      testClient(app, deps, { ip }).post("/api/v1/auth/sign-in", {
        org: org.slug,
        email: "half@example.sg",
        password: "wrong password here",
      });
    for (let i = 0; i < 9; i++) await wrong();
    await passwordStep("half@example.sg", ip); // right password, MFA never completed
    await wrong(); // 10th failure from this network
    const res = await testClient(app, deps, { ip }).post("/api/v1/auth/sign-in", {
      org: org.slug,
      email: "half@example.sg",
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
  });

  it("rate-limits /mfa/verify per IP", async () => {
    clock.set("2026-10-31T07:00:05Z");
    const http = testClient(app, deps, { ip: "10.9.4.1" });
    for (let i = 0; i < 30; i++)
      await http.post("/api/v1/auth/mfa/verify", { mfaToken: `forged-${i}`, code: "123456" });
    const res = await http.post("/api/v1/auth/mfa/verify", { mfaToken: "forged-x", code: "123456" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("rate_limited");
  });
});
