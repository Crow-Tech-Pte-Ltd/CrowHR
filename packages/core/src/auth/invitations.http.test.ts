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
import { memberships } from "../db/schema/access.ts";
import type { Mailer } from "../deps.ts";
import type { ErrorEnvelope } from "../errors.ts";

const PASSWORD = "kaya toast and soft eggs";

describe("invitations", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  let owner: Awaited<ReturnType<typeof clientAs>>;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    app = createApp(deps);
    org = await seedOrg(deps, { name: "Kampong Kopi" });
    owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
  });
  afterAll(() => t.close());

  const invite = async (email: string, roles: string[] = []) => {
    const res = await owner.post("/api/v1/members/invitations", { email, displayName: "Invitee", roles });
    return { res, body: (await res.json()) as { member: { id: string; status: string }; inviteUrl: string | null } };
  };
  const tokenOf = (url: string | null) => (url ?? "").split("/invite/")[1] as string;

  it("without a mailer returns a copyable link; accepting with a password activates and signs in", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const { res, body } = await invite("new.hire@example.sg", ["payroll_admin"]);
    expect(res.status).toBe(201);
    expect(body.member.status).toBe("invited");
    expect(body.inviteUrl).toMatch(/^https:\/\/hr\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(body.inviteUrl);
    const anon = testClient(app, deps);
    const look = (await (await anon.post("/api/v1/auth/invitations/inspect", { token })).json()) as {
      status: string;
      email: string;
    };
    expect(look).toMatchObject({ status: "valid", email: "new.hire@example.sg" });
    const weak = await anon.post("/api/v1/auth/invitations/accept", { token, password: "password1234" });
    expect(((await weak.json()) as ErrorEnvelope).error.details).toMatchObject({ issues: [{ path: "password" }] });
    const ok = await anon.post("/api/v1/auth/invitations/accept", { token, password: PASSWORD });
    expect(ok.status).toBe(200);
    const me = (await (await anon.get("/api/v1/me")).json()) as { roles: string[]; user: { email: string } };
    expect(me.user.email).toBe("new.hire@example.sg");
    expect(me.roles).toEqual(["payroll_admin"]);
    expect((await anon.post("/api/v1/auth/invitations/accept", { token, password: PASSWORD })).status).toBe(409);
  });

  it("expires after 7 days and the membership stays invited", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const { body } = await invite("late@example.sg");
    clock.advance(7 * 24 * 3600_000 + 1);
    const token = tokenOf(body.inviteUrl);
    const anon = testClient(app, deps);
    expect(
      ((await (await anon.post("/api/v1/auth/invitations/inspect", { token })).json()) as { status: string }).status,
    ).toBe("expired");
    expect((await anon.post("/api/v1/auth/invitations/accept", { token, password: PASSWORD })).status).toBe(409);
    const [m] = await deps.db.select().from(memberships).where(eq(memberships.id, body.member.id));
    expect(m?.status).toBe("invited");
  });

  it("resend replaces the token; revoke invalidates it", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const { body } = await invite("resend@example.sg");
    const first = tokenOf(body.inviteUrl);
    const again = (await (await owner.post(`/api/v1/members/${body.member.id}/invitation/resend`)).json()) as {
      inviteUrl: string;
    };
    const second = tokenOf(again.inviteUrl);
    expect(second).not.toBe(first);
    const anon = testClient(app, deps);
    expect(
      ((await (await anon.post("/api/v1/auth/invitations/inspect", { token: first })).json()) as { status: string })
        .status,
    ).toBe("revoked");
    expect((await owner.delete(`/api/v1/members/${body.member.id}/invitation`)).status).toBe(204);
    expect(
      ((await (await anon.post("/api/v1/auth/invitations/inspect", { token: second })).json()) as { status: string })
        .status,
    ).toBe("revoked");
  });

  it("refuses to invite an email that is already an active member (409)", async () => {
    await seedMember(deps, org.id, { email: "already@example.sg" });
    const { res, body } = await invite("Already@Example.sg");
    expect(res.status).toBe(409);
    expect((body as unknown as ErrorEnvelope).error.code).toBe("conflict");
  });

  it("emails the link instead of returning it when a mailer is configured", async () => {
    const sent: { to: string; text: string }[] = [];
    const mailer: Mailer = { send: async (m) => void sent.push(m) };
    const mDeps = createTestDeps(t.db, { clock, mailer });
    const mApp = createApp(mDeps);
    const o = await clientAs(mApp, mDeps, await seedMember(mDeps, org.id, { roles: ["owner"] }));
    const res = await o.post("/api/v1/members/invitations", { email: "mailed@example.sg", displayName: "Mailed" });
    expect(((await res.json()) as { inviteUrl: string | null }).inviteUrl).toBeNull();
    expect(sent[0]?.to).toBe("mailed@example.sg");
    expect(sent[0]?.text).toMatch(/https:\/\/hr\.test\/invite\//);
  });

  it("a person already on Crow HR in another org confirms their existing password", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const other = await seedOrg(deps);
    await seedMember(deps, other.id, { email: "accountant@example.sg", password: PASSWORD });
    const { body } = await invite("accountant@example.sg");
    const anon = testClient(app, deps);
    const token = tokenOf(body.inviteUrl);
    expect(
      ((await (await anon.post("/api/v1/auth/invitations/inspect", { token })).json()) as { existingAccount: boolean })
        .existingAccount,
    ).toBe(true);
    expect((await anon.post("/api/v1/auth/invitations/accept", { token, password: "not my existing pw" })).status).toBe(
      401,
    );
    expect((await anon.post("/api/v1/auth/invitations/accept", { token, password: PASSWORD })).status).toBe(200);
  });
});
