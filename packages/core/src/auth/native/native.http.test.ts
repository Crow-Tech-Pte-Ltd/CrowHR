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
} from "../../../testing/index.ts";
import { createApp } from "../../app.ts";
import { sha256Base64Url } from "../../crypto/tokens.ts";
import { memberships } from "../../db/schema/access.ts";
import { auditEvents } from "../../db/schema/audit.ts";
import type { ErrorEnvelope } from "../../errors.ts";
import { totpAt } from "../totp.ts";

const PASSWORD = "roti prata with curry";
const REDIRECT = "crowtech.crowhr:/oauth2redirect";
const VERIFIER = `${"v".repeat(20)}erifier-0123456789-abcdefghijklmnop`;

describe("native app auth (api-platform)", () => {
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

  async function authorize(state = "state-12345678") {
    const challenge = await sha256Base64Url(VERIFIER);
    const res = await app.request(
      `/api/v1/native/authorize?org=${org.slug}&client=android&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") as string;
    expect(location).toMatch(/^\/sign-in\/kopi\?native=[0-9a-f-]{36}$/);
    return location.split("native=")[1] as string;
  }

  /** Full flow: authorize → password sign-in in the browser → code → token. */
  async function deviceFor(email: string, deviceName = "Pixel 9") {
    const nativeRequestId = await authorize();
    const browser = testClient(app, deps);
    const signIn = await browser.post("/api/v1/auth/sign-in", {
      org: org.slug,
      email,
      password: PASSWORD,
      nativeRequestId,
    });
    const body = (await signIn.json()) as { redirectTo: string };
    expect(browser.sessionToken()).toBeUndefined();
    const url = new URL(body.redirectTo);
    expect(`${url.protocol}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("state-12345678");
    const tokenRes = await app.request("/api/v1/native/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "authorization_code",
        code: url.searchParams.get("code"),
        codeVerifier: VERIFIER,
        deviceName,
        appVersion: "1.0.0",
      }),
    });
    expect(tokenRes.status).toBe(200);
    return {
      code: url.searchParams.get("code") as string,
      tokens: (await tokenRes.json()) as {
        accessToken: string;
        refreshToken: string;
        deviceSessionId: string;
        expiresIn: number;
      },
    };
  }
  const bearer = (token: string, path = "/api/v1/me") =>
    app.request(path, { headers: { authorization: `Bearer ${token}` } });
  const exchange = (body: unknown) =>
    app.request("/api/v1/native/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses an unregistered redirect URI with an error page, never redirecting", async () => {
    const challenge = await sha256Base64Url(VERIFIER);
    const res = await app.request(
      `/api/v1/native/authorize?org=kopi&client=ios&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256&state=abcdefgh`,
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("requires PKCE S256", async () => {
    const res = await app.request(
      `/api/v1/native/authorize?org=kopi&client=ios&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${"a".repeat(43)}&code_challenge_method=plain&state=abcdefgh`,
    );
    expect(res.status).toBe(400);
  });

  it("issues 15-minute access tokens that work as Bearer, and refresh rotation", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "app@kopi.sg", password: PASSWORD });
    const { tokens } = await deviceFor("app@kopi.sg");
    expect(tokens.expiresIn).toBe(900);
    expect((await bearer(tokens.accessToken)).status).toBe(200);
    clock.advance(15 * 60_000);
    expect(await code(await bearer(tokens.accessToken))).toBe("session_expired");
    const refreshed = (await (
      await exchange({ grantType: "refresh_token", refreshToken: tokens.refreshToken })
    ).json()) as { accessToken: string; refreshToken: string };
    expect(refreshed.refreshToken).not.toBe(tokens.refreshToken);
    expect((await bearer(refreshed.accessToken)).status).toBe(200);
  });

  it("codes are single use: a replay is invalid_grant and revokes the device session", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "replay@kopi.sg", password: PASSWORD });
    const { code: c, tokens } = await deviceFor("replay@kopi.sg");
    const again = await exchange({
      grantType: "authorization_code",
      code: c,
      codeVerifier: VERIFIER,
      deviceName: "Attacker",
    });
    expect(again.status).toBe(400);
    expect(await code(again)).toBe("invalid_grant");
    expect(await code(await bearer(tokens.accessToken))).toBe("session_revoked");
  });

  it("codes expire after 60 seconds; a wrong verifier invalidates the code", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "slow@kopi.sg", password: PASSWORD });
    const id1 = await authorize();
    const b1 = (await (
      await testClient(app, deps).post("/api/v1/auth/sign-in", {
        org: org.slug,
        email: "slow@kopi.sg",
        password: PASSWORD,
        nativeRequestId: id1,
      })
    ).json()) as { redirectTo: string };
    clock.advance(61_000);
    expect(
      await code(
        await exchange({
          grantType: "authorization_code",
          code: new URL(b1.redirectTo).searchParams.get("code"),
          codeVerifier: VERIFIER,
          deviceName: "x",
        }),
      ),
    ).toBe("invalid_grant");

    const id2 = await authorize();
    const b2 = (await (
      await testClient(app, deps).post("/api/v1/auth/sign-in", {
        org: org.slug,
        email: "slow@kopi.sg",
        password: PASSWORD,
        nativeRequestId: id2,
      })
    ).json()) as { redirectTo: string };
    const c2 = new URL(b2.redirectTo).searchParams.get("code");
    expect(
      await code(
        await exchange({
          grantType: "authorization_code",
          code: c2,
          codeVerifier: `${VERIFIER}-wrong`,
          deviceName: "x",
        }),
      ),
    ).toBe("invalid_grant");
    expect(
      await code(
        await exchange({ grantType: "authorization_code", code: c2, codeVerifier: VERIFIER, deviceName: "x" }),
      ),
    ).toBe("invalid_grant");
  });

  it("works through password + MFA sign-in", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "mfa-app@kopi.sg", password: PASSWORD });
    const web = await clientAs(app, deps, m);
    const { secret } = (await (await web.post("/api/v1/me/mfa/totp/setup")).json()) as { secret: string };
    await web.post("/api/v1/me/mfa/totp/confirm", { code: await totpAt(secret, clock.now()) });
    clock.advance(31_000);
    const nativeRequestId = await authorize();
    const browser = testClient(app, deps);
    const step = (await (
      await browser.post("/api/v1/auth/sign-in", { org: org.slug, email: m.email, password: PASSWORD, nativeRequestId })
    ).json()) as { mfaToken: string };
    const done = (await (
      await browser.post("/api/v1/auth/mfa/verify", {
        mfaToken: step.mfaToken,
        code: await totpAt(secret, clock.now()),
      })
    ).json()) as { redirectTo: string };
    expect(done.redirectTo).toMatch(/^crowtech\.crowhr:\/oauth2redirect\?code=/);
    expect(browser.sessionToken()).toBeUndefined();
  });

  it("refresh reuse revokes the whole device session and is audited", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "reuse@kopi.sg", password: PASSWORD });
    const { tokens } = await deviceFor("reuse@kopi.sg");
    const legit = (await (
      await exchange({ grantType: "refresh_token", refreshToken: tokens.refreshToken })
    ).json()) as { accessToken: string; refreshToken: string };
    const attacker = await exchange({ grantType: "refresh_token", refreshToken: tokens.refreshToken });
    expect(await code(attacker)).toBe("invalid_grant");
    expect(await code(await bearer(legit.accessToken))).toBe("session_revoked");
    expect(await code(await exchange({ grantType: "refresh_token", refreshToken: legit.refreshToken }))).toBe(
      "invalid_grant",
    );
    const [e] = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.refresh_reuse_detected"));
    expect(e?.meta).toMatchObject({ membershipId: m.membershipId, deviceName: "Pixel 9" });
  });

  it("idle 30 days without refresh / absolute 90 days", async () => {
    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "idle-app@kopi.sg", password: PASSWORD });
    const { tokens } = await deviceFor("idle-app@kopi.sg");
    clock.advance(30 * 86_400_000);
    expect(await code(await exchange({ grantType: "refresh_token", refreshToken: tokens.refreshToken }))).toBe(
      "invalid_grant",
    );

    clock.set("2026-10-31T01:00:00Z");
    await seedMember(deps, org.id, { email: "abs-app@kopi.sg", password: PASSWORD });
    let { refreshToken } = (await deviceFor("abs-app@kopi.sg")).tokens;
    for (let day = 0; day < 89; day += 29) {
      clock.advance(29 * 86_400_000);
      const r = await exchange({ grantType: "refresh_token", refreshToken });
      if (clock.now().getTime() >= new Date("2027-01-29T01:00:00Z").getTime()) {
        expect(r.status).toBe(400);
        break;
      }
      refreshToken = ((await r.json()) as { refreshToken: string }).refreshToken;
    }
    clock.set("2027-01-29T01:00:01Z");
    expect(await code(await exchange({ grantType: "refresh_token", refreshToken }))).toBe("invalid_grant");
  });

  it("ignores tokens in the query string, rejects cookie+bearer, and skips CSRF for bearer only", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "bearer@kopi.sg", password: PASSWORD });
    const { tokens } = await deviceFor("bearer@kopi.sg");
    expect((await app.request(`/api/v1/me?access_token=${tokens.accessToken}`)).status).toBe(401);
    const web = await clientAs(app, deps, m);
    const both = await web.get("/api/v1/me", { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    expect(both.status).toBe(400);
    expect(await code(both)).toBe("ambiguous_credentials");
    const crossOrigin = await app.request("/api/v1/me/sessions/revoke-others", {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.accessToken}`, origin: "https://elsewhere.example" },
    });
    expect(crossOrigin.status).toBe(200);
  });

  it("re-checks the member on every request: suspension → 401", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "sus-app@kopi.sg", password: PASSWORD });
    const { tokens } = await deviceFor("sus-app@kopi.sg");
    await deps.db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, m.membershipId));
    expect(await code(await bearer(tokens.accessToken))).toBe("session_revoked");
  });

  it("lists device sessions with browser sessions (marked mobile); the user and an owner can revoke them", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "devices@kopi.sg", password: PASSWORD });
    const { tokens } = await deviceFor("devices@kopi.sg", "Pixel 9");
    const web = await clientAs(app, deps, m);
    const list = (await (await web.get("/api/v1/me/sessions")).json()) as {
      items: { id: string; kind: string; device: string }[];
    };
    const phone = list.items.find((s) => s.kind === "mobile");
    expect(phone).toMatchObject({ id: tokens.deviceSessionId, device: "Pixel 9 (Android)" });
    expect((await web.delete(`/api/v1/me/sessions/${phone?.id}`)).status).toBe(204);
    expect(await code(await bearer(tokens.accessToken))).toBe("session_revoked");

    const second = await deviceFor("devices@kopi.sg", "iPhone");
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    expect(
      (await owner.delete(`/api/v1/members/${m.membershipId}/sessions/${second.tokens.deviceSessionId}`)).status,
    ).toBe(204);
    expect(await code(await bearer(second.tokens.accessToken))).toBe("session_revoked");
  });

  it("password change revokes device sessions", async () => {
    clock.set("2026-10-31T01:00:00Z");
    const m = await seedMember(deps, org.id, { email: "pwdev@kopi.sg", password: PASSWORD });
    const { tokens } = await deviceFor("pwdev@kopi.sg");
    const web = await clientAs(app, deps, m);
    expect(
      (await web.post("/api/v1/me/password", { currentPassword: PASSWORD, newPassword: "another long passphrase!" }))
        .status,
    ).toBe(204);
    expect(await code(await bearer(tokens.accessToken))).toBe("session_revoked");
  });
});
