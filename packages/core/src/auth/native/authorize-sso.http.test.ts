import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createMockIdp,
  createTestDb,
  createTestDeps,
  type MockIdp,
  seedMember,
  seedOrg,
  ssoRoundTrip,
  type TestDb,
  testClient,
} from "../../../testing/index.ts";
import { createApp } from "../../app.ts";
import { sha256Base64Url } from "../../crypto/tokens.ts";

const VERIFIER = "native-sso-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";

describe("native authorisation through SSO (mock IdP)", () => {
  let t: TestDb;
  let idp: MockIdp;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let providerId: string;
  beforeAll(async () => {
    t = await createTestDb();
    idp = await createMockIdp({ issuer: "https://idp.native.test", clientId: "crowhr", clientSecret: "s" });
    deps = createTestDeps(t.db, { httpFetch: idp.fetch });
    app = createApp(deps);
    const org = await seedOrg(deps, { slug: "kopi" });
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    providerId = (
      (await (
        await owner.post("/api/v1/security/providers", {
          kind: "oidc",
          displayName: "Okta",
          issuer: "https://idp.native.test",
          clientId: "crowhr",
          clientSecret: "s",
          enabled: true,
        })
      ).json()) as { id: string }
    ).id;
    await seedMember(deps, org.id, { email: "app-user@kopi.sg" });
  });
  afterAll(() => t.close());

  it("completes into a one-time code for the app; no browser session survives", async () => {
    const challenge = await sha256Base64Url(VERIFIER);
    const authz = await app.request(
      `/api/v1/native/authorize?org=kopi&client=ios&redirect_uri=${encodeURIComponent("crowtech.crowhr:/oauth2redirect")}&code_challenge=${challenge}&code_challenge_method=S256&state=native-state-1`,
    );
    const nativeId = (authz.headers.get("location") as string).split("native=")[1] as string;
    idp.nextUser = { sub: "okta-app-user", email: "app-user@kopi.sg", email_verified: true };
    const browser = testClient(app, deps);
    const { location } = await ssoRoundTrip(browser, idp, providerId, `?native=${nativeId}`);
    expect(location).toMatch(/^crowtech\.crowhr:\/oauth2redirect\?code=.+&state=native-state-1$/);
    expect(browser.sessionToken()).toBeUndefined();
    const code = new URL(location).searchParams.get("code");
    const res = await app.request("/api/v1/native/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grantType: "authorization_code", code, codeVerifier: VERIFIER, deviceName: "iPhone 17" }),
    });
    expect(res.status).toBe(200);
    const { accessToken } = (await res.json()) as { accessToken: string };
    const me = (await (
      await app.request("/api/v1/me", { headers: { authorization: `Bearer ${accessToken}` } })
    ).json()) as { authMethod: string; session: { kind: string } };
    expect(me).toMatchObject({ authMethod: "oidc", session: { kind: "device" } });
  });
});
