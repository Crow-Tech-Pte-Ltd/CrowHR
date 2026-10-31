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
import type { ErrorEnvelope } from "../errors.ts";

const PASSWORD = "teh tarik kurang manis";

describe("sign-in throttling and lockout", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  let ipCounter = 0;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    app = createApp(deps);
    org = await seedOrg(deps);
  });
  afterAll(() => t.close());

  // A fresh IP per account so the IP limit doesn't interfere with the account tests.
  const attempt = (email: string, password: string, ip = `10.0.0.${++ipCounter}`) =>
    testClient(app, deps, { ip }).post("/api/v1/auth/sign-in", { org: org.slug, email, password });

  it("locks an account for 15 minutes after 10 failures, even for the right password", async () => {
    const m = await seedMember(deps, org.id, { email: "lock@example.sg", password: PASSWORD });
    for (let i = 0; i < 10; i++) expect((await attempt("lock@example.sg", "wrong password here")).status).toBe(401);
    const right = await attempt("lock@example.sg", PASSWORD);
    expect(right.status).toBe(401);
    expect(((await right.json()) as ErrorEnvelope).error.code).toBe("invalid_credentials");
    const actions = (await deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, m.membershipId))).map(
      (e) => e.action,
    );
    expect(actions.filter((a) => a === "auth.locked")).toHaveLength(1);

    clock.advance(15 * 60_000);
    expect((await attempt("lock@example.sg", PASSWORD)).status).toBe(200);
  });

  it("resets the counter on success", async () => {
    await seedMember(deps, org.id, { email: "reset@example.sg", password: PASSWORD });
    for (let i = 0; i < 9; i++) await attempt("reset@example.sg", "wrong password here");
    expect((await attempt("reset@example.sg", PASSWORD)).status).toBe(200);
    for (let i = 0; i < 9; i++) await attempt("reset@example.sg", "wrong password here");
    expect((await attempt("reset@example.sg", PASSWORD)).status).toBe(200);
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

  it("lets an owner clear a member's lockout", async () => {
    clock.set("2026-10-31T03:00:00Z");
    const owner = await seedMember(deps, org.id, { roles: ["owner"] });
    const m = await seedMember(deps, org.id, { email: "locked2@example.sg", password: PASSWORD });
    for (let i = 0; i < 10; i++) await attempt("locked2@example.sg", "wrong password here");
    const http = await clientAs(app, deps, owner);
    const list = await http.get(`/api/v1/members/${m.membershipId}`);
    expect(((await list.json()) as { lockedUntil: string | null }).lockedUntil).toBe("2026-10-31T03:15:00.000Z");
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
