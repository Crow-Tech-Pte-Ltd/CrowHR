import { eq, isNotNull } from "drizzle-orm";
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
import { memberships } from "../db/schema/access.ts";
import { authThrottle } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { tick } from "../jobs/tick.ts";
import { isSetupRequired } from "../setup/service.ts";
import { DEMO_SLUG_PATTERN } from "./config.ts";

/**
 * `POST /api/v1/demo-companies` (demo-companies "Private copy per visitor", design decisions 3
 * and 4): off by default, a pool copy or an inline seed, the expiry clock from hand-out, caps per
 * network and in total.
 */
const HOUR = 3_600_000;
const START = "2026-11-10T02:15:00.000Z";

interface Started {
  slug: string;
  name: string;
  server: string;
  connectUrl: string;
  signInUrl: string;
  expiresAt: string;
}

describe("demo companies: starting one", () => {
  let t: TestDb;
  const clock = movableClock(START);
  let deps: ReturnType<typeof createTestDeps>;
  let demo: ReturnType<typeof testDemoCompanies>;
  let app: ReturnType<typeof createApp>;

  const build = (overrides: Parameters<typeof testDemoCompanies>[1] = {}) => {
    demo = testDemoCompanies(() => deps, overrides);
    deps = createTestDeps(t.db, { clock, demoCompanies: demo });
    app = createApp(deps);
  };

  beforeEach(async () => {
    clock.set(START);
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    build();
  });
  afterEach(() => t.close());

  const start = (ip = "203.0.113.7") => testClient(app, deps, { ip }).post("/api/v1/demo-companies", {});
  const errorOf = async (r: Response) => ((await r.json()) as ErrorEnvelope).error;

  it("answers 404 and creates nothing when the server doesn't offer demo companies", async () => {
    const off = createTestDeps(t.db, { clock });
    const offApp = createApp(off);
    const res = await testClient(offApp, off).post("/api/v1/demo-companies", {});
    expect(res.status).toBe(404);
    expect((await offApp.request("/api/v1/demo-companies/config")).status).toBe(404);
    expect(await t.db.select().from(organisations)).toEqual([]);
  });

  it("tells the try page how long a demo company lasts", async () => {
    const res = await app.request("/api/v1/demo-companies/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ttlHours: 72, server: "https://hr.test" });
  });

  it("seeds a copy while the visitor waits when the pool is empty, expiring 72 hours after hand-out", async () => {
    const res = await start();
    expect(res.status).toBe(201);
    const body = (await res.json()) as Started;
    expect(body.slug).toMatch(DEMO_SLUG_PATTERN);
    expect(body).toMatchObject({
      name: "Kopi Kaki Pte. Ltd.",
      server: "https://hr.test",
      signInUrl: `https://hr.test/sign-in/${body.slug}`,
      expiresAt: new Date(Date.parse(START) + 72 * HOUR).toISOString(),
    });
    expect(body.connectUrl).toBe(`crowhr://connect?server=https%3A%2F%2Fhr.test&org=${body.slug}`);
    expect(demo.calls).toHaveLength(1);
    expect(demo.calls[0]?.claimedAt?.toISOString()).toBe(START);
    const [org] = await t.db.select().from(organisations).where(eq(organisations.slug, body.slug));
    expect(org?.demoClaimedAt?.toISOString()).toBe(START);
    expect(org?.demoExpiresAt?.toISOString()).toBe(body.expiresAt);
  });

  it("hands out a pool copy and starts its expiry clock at the hand-out, then refills the pool", async () => {
    build({ poolSize: 2 });
    await tick(deps, clock.now());
    await tick(deps, clock.now());
    expect(demo.calls).toHaveLength(2);
    expect(demo.calls.every((c) => c.claimedAt === null)).toBe(true);
    // Three hours later a visitor arrives: their 72 hours start now, not at seeding.
    clock.advance(3 * HOUR);
    const res = await start();
    const body = (await res.json()) as Started;
    expect(res.status).toBe(201);
    expect(demo.calls).toHaveLength(2);
    expect(body.expiresAt).toBe(new Date(clock.now().getTime() + 72 * HOUR).toISOString());
    const [org] = await t.db.select().from(organisations).where(eq(organisations.slug, body.slug));
    expect(org?.demoClaimedAt?.toISOString()).toBe(clock.now().toISOString());
    expect(demo.calls.map((c) => c.slug)).toContain(body.slug);
    // The next tick tops the pool up again, one copy at a time.
    const report = await tick(deps, clock.now());
    expect(report.demoCompanies.seeded).toBe(1);
    expect(demo.calls).toHaveLength(3);
    expect((await tick(deps, clock.now())).demoCompanies.seeded).toBe(0);
  });

  it("gives every visitor a different short name and their own email addresses", async () => {
    const a = (await (await start("203.0.113.1")).json()) as Started;
    const b = (await (await start("203.0.113.2")).json()) as Started;
    expect(a.slug).not.toBe(b.slug);
    const emails = (await t.db.select({ email: users.email }).from(users)).map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.filter((e) => e.endsWith(`@${a.slug}.kopikaki.example`))).toHaveLength(4);
    expect(emails.filter((e) => e.endsWith(`@${b.slug}.kopikaki.example`))).toHaveLength(4);
  });

  it("limits a network to 5 starts an hour, answering 429 with when to try again", async () => {
    for (let i = 0; i < 5; i++) expect((await start()).status).toBe(201);
    const refused = await start();
    expect(refused.status).toBe(429);
    const error = await errorOf(refused);
    expect(error.code).toBe("rate_limited");
    expect(error.message).toContain("5 demo companies in the last hour");
    expect(error.details).toEqual({ retryAt: "2026-11-10T03:00:00.000Z" });
    expect(refused.headers.get("retry-after")).toBe(String(45 * 60));
    // Another network is not affected.
    expect((await start("203.0.113.99")).status).toBe(201);
    expect(demo.calls).toHaveLength(6);
  });

  it("keeps counts only: no IP address is stored, and each counter goes when its window ends", async () => {
    for (const ip of ["203.0.113.7", "2001:db8:1:2::a"]) expect((await start(ip)).status).toBe(201);
    const counters = async () =>
      (await t.db.select().from(authThrottle)).filter((r) => r.key.startsWith("demo-companies:"));
    const rows = await counters();
    // Two networks (hour and day each) and the server's own hourly count.
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.key).not.toContain("203.0.113");
      expect(r.key).not.toContain("2001:db8");
      expect(r.key).toMatch(/^demo-companies:((hour|day):[A-Za-z0-9_-]{43}|server-hour)$/);
    }
    expect(rows.find((r) => r.key === "demo-companies:server-hour")?.count).toBe(2);
    // 02:15 → the hourly windows end at 03:00, the daily ones at midnight UTC.
    clock.set("2026-11-10T03:01:00.000Z");
    await tick(deps, clock.now());
    expect((await counters()).map((r) => r.key.split(":")[1])).toEqual(["day", "day"]);
    clock.set("2026-11-11T00:01:00.000Z");
    await tick(deps, clock.now());
    expect(await counters()).toEqual([]);
  });

  it("counts an IPv6 /48 as one network, so one site's address block can't take every demo company", async () => {
    build({ hourlyLimitPerNetwork: 1 });
    expect((await start("2001:db8:1:2::a")).status).toBe(201);
    // Another address, another /64, the same /48: the same network.
    expect((await start("2001:db8:1:2:ffff::b")).status).toBe(429);
    expect((await start("2001:db8:1:3::a")).status).toBe(429);
    expect((await start("2001:db8:1:ffff:1:2:3:4")).status).toBe(429);
    // The next /48 is another network.
    expect((await start("2001:db8:2::a")).status).toBe(201);
    expect((await start("2001:0db8:0002:0000::b")).status).toBe(429);
    // IPv4-mapped addresses still count as their IPv4 address.
    expect((await start("::ffff:203.0.113.50")).status).toBe(201);
    expect((await start("203.0.113.50")).status).toBe(429);
  });

  it("limits the starts on the whole server per clock hour, across every network", async () => {
    build({ serverHourlyLimit: 3 });
    for (let i = 1; i <= 3; i++) expect((await start(`2001:db8:${i}::1`)).status).toBe(201);
    const refused = await start("2001:db8:4::1");
    expect(refused.status).toBe(429);
    const error = await errorOf(refused);
    expect(error.code).toBe("rate_limited");
    expect(error.message).toContain("3 demo companies in the last hour");
    expect(error.details).toEqual({ retryAt: "2026-11-10T03:00:00.000Z" });
    expect(refused.headers.get("retry-after")).toBe(String(45 * 60));
    expect(demo.calls).toHaveLength(3);
    // The next clock hour opens again.
    clock.set("2026-11-10T03:00:00.000Z");
    expect((await start("2001:db8:5::1")).status).toBe(201);
  });

  it("doesn't let one network's refused starts use up the server's hourly starts", async () => {
    build({ hourlyLimitPerNetwork: 1, serverHourlyLimit: 2 });
    expect((await start("203.0.113.1")).status).toBe(201);
    for (let i = 0; i < 10; i++) expect((await start("203.0.113.1")).status).toBe(429);
    expect((await start("203.0.113.2")).status).toBe(201);
    expect((await start("203.0.113.3")).status).toBe(429);
  });

  it("uses 30 starts an hour for the whole server by default", async () => {
    expect(demo.serverHourlyLimit).toBe(30);
    build({ hourlyLimitPerNetwork: 100, dailyLimitPerNetwork: 100 });
    for (let i = 0; i < 30; i++) expect((await start()).status).toBe(201);
    const refused = await start("203.0.113.200");
    expect(refused.status).toBe(429);
    expect((await errorOf(refused)).message).toContain("30 demo companies in the last hour");
  });

  it("limits a network to 20 starts a day", async () => {
    build({ hourlyLimitPerNetwork: 100 });
    for (let i = 0; i < 20; i++) expect((await start()).status).toBe(201);
    const refused = await start();
    expect(refused.status).toBe(429);
    expect((await errorOf(refused)).message).toContain("20 demo companies today");
  });

  it("stops at the maximum number of live demo companies, until one ends", async () => {
    build({ maxLive: 2 });
    expect((await start("203.0.113.1")).status).toBe(201);
    clock.advance(HOUR);
    expect((await start("203.0.113.2")).status).toBe(201);
    const refused = await start("203.0.113.3");
    expect(refused.status).toBe(429);
    const error = await errorOf(refused);
    expect(error.message).toContain("in use right now");
    expect(error.details).toEqual({ retryAt: new Date(Date.parse(START) + 72 * HOUR).toISOString() });
    // The pool never grows past the cap either.
    build({ maxLive: 2, poolSize: 3 });
    expect((await tick(deps, clock.now())).demoCompanies.seeded).toBe(0);
  });

  it("keeps two visitors' companies apart", async () => {
    const a = (await (await start("203.0.113.1")).json()) as Started;
    const b = (await (await start("203.0.113.2")).json()) as Started;
    const [orgA] = await t.db.select().from(organisations).where(eq(organisations.slug, a.slug));
    const [orgB] = await t.db.select().from(organisations).where(eq(organisations.slug, b.slug));
    const personas = async (slug: string) =>
      (
        (await (await app.request(`/api/v1/auth/demo/personas?org=${slug}`)).json()) as {
          items: { membershipId: string; email: string; persona?: { key: string } }[];
        }
      ).items;
    const peopleA = await personas(a.slug);
    const peopleB = await personas(b.slug);
    expect(peopleA.every((p) => p.email.endsWith(`@${a.slug}.kopikaki.example`))).toBe(true);
    expect(peopleB.every((p) => p.email.endsWith(`@${b.slug}.kopikaki.example`))).toBe(true);
    // A's employee applies for... anything A's people do is A's: sign in and look at the members.
    const visitorA = testClient(app, deps);
    const ownerA = peopleA.find((p) => p.persona?.key === "owner");
    expect(
      (await visitorA.post("/api/v1/auth/demo/sign-in", { membershipId: ownerA?.membershipId, org: a.slug })).status,
    ).toBe(204);
    const members = (await (await visitorA.get("/api/v1/members")).json()) as { items: { email: string }[] };
    expect(members.items.length).toBe(4);
    expect(members.items.every((m) => m.email.endsWith(`@${a.slug}.kopikaki.example`))).toBe(true);
    // B's people can't be signed in through A's short name.
    const ownerB = peopleB.find((p) => p.persona?.key === "owner");
    expect(
      (
        await testClient(app, deps).post("/api/v1/auth/demo/sign-in", {
          membershipId: ownerB?.membershipId,
          org: a.slug,
        })
      ).status,
    ).toBe(404);
    const inB = await t.db
      .select()
      .from(memberships)
      .where(eq(memberships.orgId, orgB?.id as string));
    expect(inB.map((m) => m.orgId)).toEqual(inB.map(() => orgB?.id));
    expect(orgA?.id).not.toBe(orgB?.id);
  });

  it("leaves first-run setup to do on a fresh server whose pool is already seeded", async () => {
    build({ poolSize: 1 });
    await tick(deps, clock.now());
    expect(demo.calls).toHaveLength(1);
    expect(await isSetupRequired(t.db)).toBe(true);
    const setup = (await (await app.request("/api/v1/setup")).json()) as { required: boolean };
    expect(setup.required).toBe(true);
  });

  it("never sets a demo expiry on an organisation it didn't create", async () => {
    const real = await seedOrg(deps, { slug: "real-co" });
    await seedMember(deps, real.id, { roles: ["owner"] });
    await start();
    await tick(deps, clock.now());
    const flagged = await t.db.select().from(organisations).where(isNotNull(organisations.demoExpiresAt));
    expect(flagged.map((o) => o.id)).not.toContain(real.id);
  });
});
