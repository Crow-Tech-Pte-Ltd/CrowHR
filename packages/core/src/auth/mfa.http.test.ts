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
import { totpAt } from "./totp.ts";

const PASSWORD = "nasi lemak with sambal";

describe("TOTP MFA", () => {
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

  /** Enrols MFA for a fresh member; returns the secret and recovery codes. */
  async function enrolled(email: string) {
    const m = await seedMember(deps, org.id, { email, password: PASSWORD });
    const http = await clientAs(app, deps, m);
    const setup = (await (await http.post("/api/v1/me/mfa/totp/setup")).json()) as {
      secret: string;
      otpauthUri: string;
    };
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const confirm = await http.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(setup.secret, clock.now()) });
    expect(confirm.status).toBe(200);
    const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
    clock.advance(31_000); // next code window
    return { m, secret: setup.secret, recoveryCodes };
  }
  const passwordStep = async (email: string) => {
    const http = testClient(app, deps);
    const res = await http.post("/api/v1/auth/sign-in", { org: org.slug, email, password: PASSWORD });
    return {
      http,
      res,
      body: (await res.json()) as { mfaRequired: boolean; mfaToken?: string; mfaExpiresAt?: string },
    };
  };

  it("enrolment only completes with a valid code", async () => {
    const m = await seedMember(deps, org.id, { email: "enrol@example.sg", password: PASSWORD });
    const http = await clientAs(app, deps, m);
    await http.post("/api/v1/me/mfa/totp/setup");
    const bad = await http.post("/api/v1/me/mfa/totp/confirm", { code: "000000" });
    expect(((await bad.json()) as ErrorEnvelope).error.code).toBe("invalid_mfa_code");
    expect(((await (await http.get("/api/v1/me")).json()) as { mfa: { enrolled: boolean } }).mfa.enrolled).toBe(false);
  });

  it("after a correct password: mfaRequired with a 5-minute token and no cookie; a code completes sign-in", async () => {
    const { secret } = await enrolled("two@example.sg");
    const { http, res, body } = await passwordStep("two@example.sg");
    expect(body.mfaRequired).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(new Date(body.mfaExpiresAt as string).getTime() - clock.now().getTime()).toBe(5 * 60_000);
    const done = await http.post("/api/v1/auth/mfa/verify", {
      mfaToken: body.mfaToken,
      code: await totpAt(secret, clock.now()),
    });
    expect(done.status).toBe(200);
    expect(http.sessionToken()).toBeTruthy();
    expect((await http.get("/api/v1/me")).status).toBe(200);
  });

  it("rejects a replayed code within its window", async () => {
    const { secret } = await enrolled("replay@example.sg");
    const code = await totpAt(secret, clock.now());
    const first = await passwordStep("replay@example.sg");
    expect((await first.http.post("/api/v1/auth/mfa/verify", { mfaToken: first.body.mfaToken, code })).status).toBe(
      200,
    );
    const second = await passwordStep("replay@example.sg");
    const res = await second.http.post("/api/v1/auth/mfa/verify", { mfaToken: second.body.mfaToken, code });
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("invalid_mfa_code");
  });

  it("the pending token expires after 5 minutes and dies after 5 wrong codes (MFA bypass attempts)", async () => {
    const { secret } = await enrolled("brute@example.sg");
    const late = await passwordStep("brute@example.sg");
    clock.advance(5 * 60_000);
    expect(
      (
        await late.http.post("/api/v1/auth/mfa/verify", {
          mfaToken: late.body.mfaToken,
          code: await totpAt(secret, clock.now()),
        })
      ).status,
    ).toBe(401);

    const step = await passwordStep("brute@example.sg");
    for (let i = 0; i < 5; i++) {
      const r = await step.http.post("/api/v1/auth/mfa/verify", {
        mfaToken: step.body.mfaToken,
        code: String(100000 + i),
      });
      expect(r.status).toBe(401);
    }
    const right = await step.http.post("/api/v1/auth/mfa/verify", {
      mfaToken: step.body.mfaToken,
      code: await totpAt(secret, clock.now()),
    });
    expect(right.status).toBe(401);
    expect(((await right.json()) as ErrorEnvelope).error.details).toMatchObject({ restart: true });
  });

  it("a forged or missing MFA token never yields a session", async () => {
    await enrolled("forge@example.sg");
    const http = testClient(app, deps);
    const res = await http.post("/api/v1/auth/mfa/verify", { mfaToken: "x".repeat(43), code: "123456" });
    expect(res.status).toBe(401);
    expect(http.sessionToken()).toBeUndefined();
  });

  it("gives 10 single-use recovery codes; regenerating invalidates the old ones; use is audited", async () => {
    const { m, recoveryCodes } = await enrolled("recover@example.sg");
    expect(recoveryCodes).toHaveLength(10);
    for (const c of recoveryCodes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    const a = await passwordStep("recover@example.sg");
    expect(
      (await a.http.post("/api/v1/auth/mfa/verify", { mfaToken: a.body.mfaToken, code: recoveryCodes[0] })).status,
    ).toBe(200);
    expect(
      ((await (await a.http.get("/api/v1/me")).json()) as { mfa: { remainingRecoveryCodes: number } }).mfa
        .remainingRecoveryCodes,
    ).toBe(9);
    const b = await passwordStep("recover@example.sg");
    expect(
      (await b.http.post("/api/v1/auth/mfa/verify", { mfaToken: b.body.mfaToken, code: recoveryCodes[0] })).status,
    ).toBe(401);
    const used = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.recovery_code_used"));
    expect(used.some((e) => e.targetId === m.membershipId)).toBe(true);

    const fresh = await clientAs(app, deps, m);
    const regen = (await (await fresh.post("/api/v1/me/mfa/recovery-codes")).json()) as { recoveryCodes: string[] };
    expect(regen.recoveryCodes).toHaveLength(10);
    const c = await passwordStep("recover@example.sg");
    expect(
      (await c.http.post("/api/v1/auth/mfa/verify", { mfaToken: c.body.mfaToken, code: recoveryCodes[1] })).status,
    ).toBe(401);
  });

  it("an owner can reset a member's MFA (audited)", async () => {
    const { m } = await enrolled("reset-mfa@example.sg");
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    expect((await owner.post(`/api/v1/members/${m.membershipId}/mfa/reset`)).status).toBe(204);
    const step = await passwordStep("reset-mfa@example.sg");
    expect(step.body.mfaRequired).toBe(false);
    const [e] = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.mfa_reset"));
    expect(e?.targetId).toBe(m.membershipId);
  });

  it("stores the TOTP secret encrypted", async () => {
    const { m, secret } = await enrolled("enc@example.sg");
    const { rows } = await t.pglite.query<{ s: string }>(
      `select mfa_totp_secret_enc as s from users where id = '${m.userId}'`,
    );
    expect(rows[0]?.s).toMatch(/^v1\./);
    expect(rows[0]?.s).not.toContain(secret);
  });
});
