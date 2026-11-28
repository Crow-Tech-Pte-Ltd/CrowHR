import { createServer, type RequestListener, type Server } from "node:http";
import { createApp, SECRET_PURPOSES, schema } from "@crowhr/core";
import { generateRpKeys, singpassConfiguration } from "@crowhr/core/singpass";
import {
  clientAs,
  createMockIdp,
  createTestDb,
  createTestDeps,
  type MockIdp,
  seedMember,
  seedOrg,
  testClient,
} from "@crowhr/core/testing";
import { PGlite } from "@electric-sql/pglite";
import * as oidc from "openid-client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type BrokerAudit, createBroker, SINGPASS_CALLBACK_PATH, subjectFor } from "./broker.ts";
import { createStorage } from "./storage.ts";

const subjectKey = Uint8Array.from({ length: 32 }, () => 25);
const clients = [
  {
    id: "first",
    secret: "a".repeat(48),
    callback: "https://hr.customer.example/api/v1/auth/oidc/67ff2334-f13f-40df-88b1-0fb893ecb3c1/callback",
    suspended: false,
  },
  {
    id: "second",
    secret: "b".repeat(48),
    callback: "https://hr.another.example/api/v1/auth/oidc/98013ffc-540c-438d-a519-e8a20eaefe82/callback",
    suspended: false,
  },
  { id: "suspended", secret: "c".repeat(48), callback: "https://hr.suspended.example/callback", suspended: true },
] as const;
const upstreamIssuer = "https://singpass.example.test";
const rawSubject = "s=S1234567D,u=8f1c6f9e-0000-4000-8000-000000000001";
const audit: Parameters<BrokerAudit>[0][] = [];
let issuer: string;
let server: Server;
let upstream: MockIdp;
let db: PGlite;

beforeAll(async () => {
  const rp = await generateRpKeys();
  const signing = await generateRpKeys();
  const retiring = await generateRpKeys();
  upstream = await createMockIdp({
    issuer: upstreamIssuer,
    clientId: "mock-upstream",
    par: true,
    privateKeyJwt: true,
    dpop: true,
    encryptIdToken: true,
    singpass: true,
    rpJwks: async () => rp.publicJwks,
  });
  upstream.nextUser = { sub: rawSubject, email: "fake@example.test", email_verified: true };
  const configuration = await singpassConfiguration(upstreamIssuer, "mock-upstream", rp.privateJwks, {
    [oidc.customFetch]: (url, init) => upstream.fetch(url, init as RequestInit),
  });
  db = new PGlite();
  let handler: RequestListener;
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a loopback port");
  issuer = `http://127.0.0.1:${address.port}`;
  const storage = createStorage((sql, parameters) => db.query(sql, parameters), issuer);
  await storage.initialise();
  const broker = createBroker({
    issuer,
    clients: [...clients],
    storage,
    subjectKey,
    attemptKey: Uint8Array.from({ length: 32 }, () => 32),
    cookieKeys: ["c".repeat(48)],
    signingKeys: { keys: [...signing.privateJwks.keys.slice(0, 1), ...retiring.privateJwks.keys.slice(0, 1)] },
    singpassKeys: rp.privateJwks,
    upstream: async () => configuration,
    audit: (event) => audit.push(event),
  });
  handler = broker.callback();
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (db) await db.close();
});

function browser() {
  const jar = new Map<string, string>();
  return async (url: string) => {
    const headers = { cookie: [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ") };
    const response = await fetch(new URL(url, issuer), { redirect: "manual", headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair?.indexOf("=") ?? -1;
      if (pair && separator >= 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  };
}

function redirect(response: Response): URL {
  const location = response.headers.get("location");
  expect(location, `Expected a redirect, received ${response.status}`).not.toBeNull();
  return new URL(location as string, issuer);
}

async function start(client: (typeof clients)[number], redirectUri: string = client.callback) {
  const config = await oidc.discovery(new URL(issuer), client.id, undefined, oidc.ClientSecretPost(client.secret), {
    execute: [oidc.allowInsecureRequests],
  });
  oidc.enableNonRepudiationChecks(config);
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const authorize = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid",
    prompt: "login",
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  });
  return { authorize, config, verifier, state, nonce };
}

async function completeUpstream(authorize: URL, visit = browser()) {
  const interaction = redirect(await visit(authorize.href));
  const singpass = redirect(await visit(interaction.href));
  const callback = redirect(await upstream.fetch(singpass.href, { redirect: "manual" }));
  expect(callback.origin + callback.pathname).toBe(`${issuer}${SINGPASS_CALLBACK_PATH}`);
  const resume = redirect(await visit(callback.href));
  return redirect(await visit(resume.href));
}

async function roundTrip(client: (typeof clients)[number]) {
  const attempt = await start(client);
  const returned = await completeUpstream(attempt.authorize);
  expect(returned.origin + returned.pathname).toBe(client.callback);
  expect(returned.searchParams.has("code")).toBe(true);
  return { ...attempt, returned };
}

async function redeem(attempt: Awaited<ReturnType<typeof roundTrip>>) {
  return oidc.authorizationCodeGrant(attempt.config, attempt.returned, {
    expectedState: attempt.state,
    expectedNonce: attempt.nonce,
    pkceCodeVerifier: attempt.verifier,
    idTokenExpected: true,
  });
}

it("uses the same FAPI callback for two customer domains and issues independent subjects", async () => {
  const first = await roundTrip(clients[0]);
  const second = await roundTrip(clients[1]);
  const a = (await redeem(first)).claims();
  const b = (await redeem(second)).claims();
  expect(a?.sub).toBe(subjectFor(subjectKey, "first", upstreamIssuer, rawSubject));
  expect(b?.sub).toBe(subjectFor(subjectKey, "second", upstreamIssuer, rawSubject));
  expect(a?.sub).not.toBe(b?.sub);
  expect(a).not.toHaveProperty("email");
  expect(JSON.stringify(a)).not.toContain("S1234567D");
  expect(upstream.seen.tokenRequests).toContainEqual({ dpop: true, clientAuth: "private_key_jwt" });
  expect(upstream.seen.authorizeParams.at(-1)).toMatchObject({
    redirect_uri: `${issuer}${SINGPASS_CALLBACK_PATH}`,
    scope: "openid",
  });
  expect(audit.slice(-2)).toEqual([
    { client: "first", outcome: "success" },
    { client: "second", outcome: "success" },
  ]);
  await expect(redeem(first)).rejects.toThrow();
});

it("refuses a different callback or a suspended customer", async () => {
  const mismatched = await start(clients[0], clients[1].callback);
  expect((await browser()(mismatched.authorize.href)).status).toBe(400);
  const suspended = await start(clients[2]);
  expect((await browser()(suspended.authorize.href)).status).toBe(400);
});

it("preserves subjects when the derivation key is restored", () => {
  const restored = Uint8Array.from(Buffer.from(subjectKey).toString("hex").match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  expect(subjectFor(restored, "first", upstreamIssuer, rawSubject)).toBe(
    subjectFor(subjectKey, "first", upstreamIssuer, rawSubject),
  );
});

async function testInstance(instance: (typeof clients)[number], database: Awaited<ReturnType<typeof createTestDb>>) {
  const callback = new URL(instance.callback);
  const providerId = callback.pathname.split("/").at(-2) as string;
  const deps = createTestDeps(database.db, { publicUrl: callback.origin, managedSingpassIssuer: issuer });
  const app = createApp(deps);
  const org = await seedOrg(deps, { slug: instance.id });
  const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
  await deps.db.insert(schema.ssoProviders).values({
    id: providerId,
    orgId: org.id,
    kind: "managed_singpass",
    displayName: "Singpass",
    issuer,
    clientId: instance.id,
    clientSecretEnc: await deps.secretBox.encrypt(SECRET_PURPOSES.ssoClientSecret, instance.secret),
    enabled: true,
    createdAt: deps.clock.now(),
    updatedAt: deps.clock.now(),
  });
  const email = `${instance.id}@company.example`;
  const invite = await owner.post("/api/v1/members/invitations", { email, displayName: instance.id });
  expect(invite.status).toBe(201);
  const { inviteUrl } = await invite.json();
  const token = new URL(inviteUrl).pathname.split("/").at(-1);
  const http = testClient(app, deps);
  const browserCallback = async (url: URL) => http.get(url.pathname + url.search);
  const authorize = async (invitation?: string) => {
    const path = callback.pathname.replace(/callback$/, "start");
    const query = invitation ? `?invitation=${invitation}` : "";
    return completeUpstream(redirect(await http.get(path + query)));
  };
  return { http, token, email, browserCallback, authorize, deps };
}

it("links the same upstream account in two independent Crow HR databases and refuses a cross-instance code", async () => {
  const firstDb = await createTestDb();
  const secondDb = await createTestDb();
  try {
    const first = await testInstance(clients[0], firstDb);
    const second = await testInstance(clients[1], secondDb);
    const a = await first.authorize(first.token);
    const b = await second.authorize(second.token);
    expect(a.origin + a.pathname).toBe(clients[0].callback);
    expect(b.origin + b.pathname).toBe(clients[1].callback);
    const cross = new URL(b);
    cross.searchParams.set("code", a.searchParams.get("code") as string);
    expect((await second.browserCallback(cross)).headers.get("location")).toContain("error=");
    expect((await second.http.get("/api/v1/me")).status).toBe(401);

    expect((await first.browserCallback(a)).headers.get("location")).toBe("/");
    expect((await second.browserCallback(await second.authorize(second.token))).headers.get("location")).toBe("/");
    for (const instance of [first, second]) {
      expect(await (await instance.http.get("/api/v1/me")).json()).toMatchObject({
        authMethod: "singpass",
        user: { email: instance.email },
      });
      expect((await instance.browserCallback(await instance.authorize())).headers.get("location")).toBe("/");
    }
    const [firstLink] = await first.deps.db.select().from(schema.userIdentities);
    const [secondLink] = await second.deps.db.select().from(schema.userIdentities);
    expect(firstLink?.subject).toBeTruthy();
    expect(secondLink?.subject).toBeTruthy();
    expect(firstLink?.subject).not.toBe(secondLink?.subject);
  } finally {
    await secondDb.close();
    await firstDb.close();
  }
});

it("rejects a code redeemed with a different PKCE verifier", async () => {
  const attempt = await roundTrip(clients[0]);
  await expect(redeem({ ...attempt, verifier: oidc.randomPKCECodeVerifier() })).rejects.toThrow();
});

it("publishes both downstream signing keys during rotation and only the public Singpass keys", async () => {
  const metadata = await (await fetch(new URL("/.well-known/openid-configuration", issuer))).json();
  const downstream = await (await fetch(metadata.jwks_uri)).json();
  const upstreamKeys = await (await fetch(new URL("/singpass/jwks.json", issuer))).json();
  expect(downstream.keys).toHaveLength(2);
  expect(downstream.keys.every((key: JsonWebKey) => key.use === "sig" && key.d === undefined)).toBe(true);
  expect(upstreamKeys.keys.map((key: JsonWebKey) => key.use).sort()).toEqual(["enc", "sig"]);
  expect(upstreamKeys.keys.every((key: JsonWebKey) => key.d === undefined)).toBe(true);
});
