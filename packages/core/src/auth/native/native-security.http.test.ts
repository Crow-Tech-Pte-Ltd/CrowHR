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
} from "../../../testing/index.ts";
import { createApp } from "../../app.ts";
import { newToken, sha256Base64Url, sha256Hex } from "../../crypto/tokens.ts";
import { membershipRoles } from "../../db/schema/access.ts";
import { deviceSessions } from "../../db/schema/auth.ts";
import type { ErrorEnvelope } from "../../errors.ts";

const PASSWORD = "roti prata with curry";
const REDIRECT = "crowtech.crowhr:/oauth2redirect";
const VERIFIER = `${"v".repeat(20)}erifier-0123456789-abcdefghijklmnop`;

/** Review findings 11 (MFA policy on native tokens) and 23 (atomic refresh rotation). */
describe("native app tokens (security review)", () => {
  let t: TestDb;
  const clock = movableClock("2026-10-31T01:00:00Z");
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    app = createApp(deps);
    org = await seedOrg(deps, { slug: "kopi" });
  });
  afterAll(() => t.close());

  const code = async (r: Response) => ((await r.json()) as ErrorEnvelope).error.code;
  const exchange = (body: unknown) =>
    app.request("/api/v1/native/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const bearer = (token: string, path = "/api/v1/me") =>
    app.request(path, { headers: { authorization: `Bearer ${token}` } });

  async function codeFor(email: string) {
    const challenge = await sha256Base64Url(VERIFIER);
    const res = await app.request(
      `/api/v1/native/authorize?org=${org.slug}&client=android&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=state-12345678`,
    );
    const nativeRequestId = (res.headers.get("location") as string).split("native=")[1];
    const browser = testClient(app, deps);
    const signIn = await browser.post("/api/v1/auth/sign-in", {
      org: org.slug,
      email,
      password: PASSWORD,
      nativeRequestId,
    });
    expect(signIn.status).toBe(200);
    return new URL(((await signIn.json()) as { redirectTo: string }).redirectTo).searchParams.get("code") as string;
  }

  it("refuses the code exchange while the MFA enrolment policy blocks the member", async () => {
    await seedMember(deps, org.id, {
      email: "payroll@kopi.sg",
      password: PASSWORD,
      roles: ["payroll_admin"],
      grantedAt: new Date("2026-10-01T00:00:00Z"),
    });
    const res = await exchange({
      grantType: "authorization_code",
      code: await codeFor("payroll@kopi.sg"),
      codeVerifier: VERIFIER,
      deviceName: "Pixel 9",
    });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("mfa_enrolment_required");
  });

  it("applies the MFA enrolment guard to device sessions", async () => {
    const m = await seedMember(deps, org.id, { email: "later-admin@kopi.sg", password: PASSWORD });
    const res = await exchange({
      grantType: "authorization_code",
      code: await codeFor("later-admin@kopi.sg"),
      codeVerifier: VERIFIER,
      deviceName: "Pixel 9",
    });
    const tokens = (await res.json()) as { accessToken: string };
    expect((await bearer(tokens.accessToken)).status).toBe(200);
    // Granted a covered role 30 days ago and never enrolled: the bearer is blocked like a browser.
    await deps.db.insert(membershipRoles).values({
      orgId: org.id,
      membershipId: m.membershipId,
      role: "payroll_admin",
      grantedAt: new Date("2026-10-01T00:00:00Z"),
    });
    const blocked = await bearer(tokens.accessToken, "/api/v1/payroll/runs");
    expect(blocked.status).toBe(403);
    expect(await code(blocked)).toBe("mfa_enrolment_required");
    expect((await bearer(tokens.accessToken)).status).toBe(200); // GET /me stays allowed
  });

  it("rotates refresh tokens atomically: two concurrent uses yield one success and revoke the session", async () => {
    await seedMember(deps, org.id, { email: "app2@kopi.sg", password: PASSWORD });
    const res = await exchange({
      grantType: "authorization_code",
      code: await codeFor("app2@kopi.sg"),
      codeVerifier: VERIFIER,
      deviceName: "Pixel 9",
    });
    const tokens = (await res.json()) as { refreshToken: string; deviceSessionId: string };
    const call = () => exchange({ grantType: "refresh_token", refreshToken: tokens.refreshToken });
    const results = await Promise.all([call(), call()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 400]);
    const [device] = await deps.db.select().from(deviceSessions).where(eq(deviceSessions.id, tokens.deviceSessionId));
    expect(device?.revokedReason).toBe("refresh_reuse");
  });

  it("a refresh that loses the race against a rotation is treated as reuse", async () => {
    await seedMember(deps, org.id, { email: "race@kopi.sg", password: PASSWORD });
    const res = await exchange({
      grantType: "authorization_code",
      code: await codeFor("race@kopi.sg"),
      codeVerifier: VERIFIER,
      deviceName: "Pixel 9",
    });
    const tokens = (await res.json()) as { refreshToken: string; deviceSessionId: string };
    // Simulate a rotation landing between our read and our write: swap the current hash.
    const other = newToken();
    await deps.db
      .update(deviceSessions)
      .set({
        currentRefreshHash: await sha256Hex(other),
        previousRefreshHashes: [await sha256Hex(tokens.refreshToken)],
      })
      .where(eq(deviceSessions.id, tokens.deviceSessionId));
    expect(await code(await exchange({ grantType: "refresh_token", refreshToken: tokens.refreshToken }))).toBe(
      "invalid_grant",
    );
    expect(await code(await exchange({ grantType: "refresh_token", refreshToken: other }))).toBe("invalid_grant");
  });
});
