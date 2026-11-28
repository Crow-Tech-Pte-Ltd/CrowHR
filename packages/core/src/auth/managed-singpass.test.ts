import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createMockIdp,
  createTestDb,
  createTestDeps,
  seedMember,
  seedOrg,
  ssoRoundTrip,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { users } from "../db/schema/users.ts";

const issuer = "https://login.example.test";
const credentials = { kind: "managed_singpass", clientId: "hosted-company", clientSecret: "mock-testing" };
const testDb = await createTestDb();
const idp = await createMockIdp({ issuer, clientId: credentials.clientId, clientSecret: credentials.clientSecret });
const deps = createTestDeps(testDb.db, { httpFetch: idp.fetch, managedSingpassIssuer: issuer });
const app = createApp(deps);
let orgId: string;
let owner: Awaited<ReturnType<typeof clientAs>>;
let providerId: string;

beforeAll(async () => {
  const org = await seedOrg(deps, { slug: "hosted" });
  orgId = org.id;
  owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
  const saved = await owner.post("/api/v1/security/providers", credentials);
  expect(saved.status, await saved.clone().text()).toBe(201);
  const savedMethod = await saved.json();
  expect(savedMethod).toMatchObject({
    kind: "singpass",
    managed: true,
    issuer,
    jwksUrl: null,
    displayName: "Singpass",
  });
  providerId = savedMethod.id;
  expect((await owner.patch(`/api/v1/security/providers/${providerId}`, { enabled: true })).status).toBe(200);
});
afterAll(() => testDb.close());

describe("managed Singpass in hosted Crow HR", () => {
  it("publishes a Singpass sign-in button using the same browser and native-compatible discovery", async () => {
    const res = await app.request("/api/v1/auth/methods?org=hosted");
    expect((await res.json()).providers).toEqual([
      { id: providerId, kind: "singpass", displayName: "Singpass", allowedDomains: [] },
    ]);
  });

  it("refuses linking by verified email and requests only an explicitly authenticated openid subject", async () => {
    const account = await seedMember(deps, orgId, { email: "managed@example.sg" });
    idp.nextUser = { sub: "stable-tenant-subject", email: account.email, email_verified: true };
    const http = testClient(app, deps);
    expect((await ssoRoundTrip(http, idp, providerId)).location).toContain("error=not_provisioned");
    expect(idp.seen.authorizeParams.at(-1)).toMatchObject({ scope: "openid", prompt: "login" });
  });

  it("links an invited employee and accepts ordinary sign-in once linked", async () => {
    const invitation = await owner.post("/api/v1/members/invitations", {
      email: "invited@example.sg",
      displayName: "Invited",
    });
    const { inviteUrl } = await invitation.json();
    const token = new URL(inviteUrl).pathname.split("/").at(-1);
    const preview = await owner.post("/api/v1/auth/invitations/inspect", { token });
    expect((await preview.json()).providers).toEqual([{ id: providerId, kind: "singpass", displayName: "Singpass" }]);
    idp.nextUser = { sub: "invitation-subject" };
    const http = testClient(app, deps);
    expect((await ssoRoundTrip(http, idp, providerId, `?invitation=${token}`)).location).toBe("/");
    expect(await (await http.get("/api/v1/me")).json()).toMatchObject({
      authMethod: "singpass",
      user: { email: "invited@example.sg" },
    });
    expect((await ssoRoundTrip(testClient(app, deps), idp, providerId)).location).toBe("/");
  });

  it("links from a recent authenticated session and still requires Crow HR MFA on sign-in", async () => {
    const member = await seedMember(deps, orgId, { email: "mfa-managed@example.sg" });
    const signedIn = await clientAs(app, deps, member);
    idp.nextUser = { sub: "linked-mfa-subject" };
    expect((await ssoRoundTrip(signedIn, idp, providerId, "?purpose=link")).location).toBe("/me/sessions?link=ok");
    await deps.db.update(users).set({ mfaEnrolledAt: deps.clock.now() }).where(eq(users.id, member.userId));
    const fresh = testClient(app, deps);
    expect((await ssoRoundTrip(fresh, idp, providerId)).location).toBe("/sign-in/hosted?mfa=1");
    expect((await fresh.get("/api/v1/me")).status).toBe(401);
  });

  it("keeps managed Singpass pinned to the operator's issuer and disables JIT", async () => {
    expect(
      (await owner.patch(`/api/v1/security/providers/${providerId}`, { issuer: "https://different.example" })).status,
    ).toBe(400);
    expect(
      (
        await owner.patch(`/api/v1/security/providers/${providerId}`, {
          jitEnabled: true,
          allowedDomains: ["example.sg"],
        })
      ).status,
    ).toBe(400);
    const { managedSingpassIssuer: _managedIssuer, ...selfHostDeps } = deps;
    const selfHost = createApp(selfHostDeps);
    expect(await (await selfHost.request("/api/v1/auth/methods?org=hosted")).json()).toMatchObject({ providers: [] });
    expect((await selfHost.request(`/api/v1/auth/oidc/${providerId}/start`)).status).toBe(404);
  });

  it("requires another way for staff to sign in even after managed Singpass passes its test", async () => {
    const result = await ssoRoundTrip(owner, idp, providerId, "?purpose=test");
    expect(result.location).toContain("test=ok");
    expect((await owner.patch("/api/v1/security/settings", { passwordEnabled: false })).status).toBe(409);
  });
});
