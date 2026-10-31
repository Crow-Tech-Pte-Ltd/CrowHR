import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createMockIdp,
  createTestDb,
  createTestDeps,
  type MockIdp,
  seedMember,
  seedOrg,
  type TestDb,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { ssoProviders } from "../db/schema/auth.ts";
import type { ErrorEnvelope } from "../errors.ts";

describe("SSO provider configuration", () => {
  let t: TestDb;
  let idp: MockIdp;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let orgId: string;
  let owner: Awaited<ReturnType<typeof clientAs>>;
  beforeAll(async () => {
    t = await createTestDb();
    idp = await createMockIdp({ issuer: "https://idp.example.test", clientId: "crowhr", clientSecret: "s3cr3t-value" });
    deps = createTestDeps(t.db, { httpFetch: idp.fetch });
    app = createApp(deps);
    orgId = (await seedOrg(deps)).id;
    owner = await clientAs(app, deps, await seedMember(deps, orgId, { roles: ["owner"] }));
  });
  afterAll(() => t.close());

  const issues = async (res: Response) =>
    ((await res.json()) as ErrorEnvelope).error.details as { issues: { path: string; message: string }[] };

  it("fetches discovery, encrypts the secret, never echoes it, and audits", async () => {
    const res = await owner.post("/api/v1/security/providers", {
      kind: "oidc",
      displayName: "Keycloak",
      issuer: "https://idp.example.test",
      clientId: "crowhr",
      clientSecret: "s3cr3t-value",
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain("s3cr3t-value");
    const body = JSON.parse(text) as { id: string; clientSecretSet: boolean; callbackUrl: string; enabled: boolean };
    expect(body).toMatchObject({
      clientSecretSet: true,
      enabled: false,
      callbackUrl: `https://hr.test/api/v1/auth/oidc/${body.id}/callback`,
    });
    const read = await (await owner.get(`/api/v1/security/providers/${body.id}`)).text();
    expect(read).not.toContain("s3cr3t-value");
    const [row] = await deps.db.select().from(ssoProviders).where(eq(ssoProviders.id, body.id));
    expect(row?.clientSecretEnc).toMatch(/^v1\./);
    const [event] = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "sso.provider_created"));
    expect(JSON.stringify(event)).not.toContain("s3cr3t-value");
    const upd = await owner.patch(`/api/v1/security/providers/${body.id}`, { clientSecret: "rotated-secret-2" });
    expect(await upd.text()).not.toContain("rotated-secret-2");
    const [updated] = await deps.db.select().from(auditEvents).where(eq(auditEvents.action, "sso.provider_updated"));
    expect(updated?.diff).toMatchObject({ clientSecret: { changed: true } });
  });

  it("explains an unreachable discovery document", async () => {
    const res = await owner.post("/api/v1/security/providers", {
      kind: "oidc",
      issuer: "https://unreachable.example.test",
      clientId: "x",
      clientSecret: "y",
    });
    expect(res.status).toBe(400);
    expect((await issues(res)).issues[0]).toEqual({
      path: "issuer",
      message:
        "The discovery document at https://unreachable.example.test/.well-known/openid-configuration could not be fetched. Check the issuer URL and that this server can reach it.",
    });
  });

  it("explains an issuer mismatch", async () => {
    idp.tamper.wrongIssuer = true;
    try {
      const res = await owner.post("/api/v1/security/providers", {
        kind: "oidc",
        issuer: "https://idp.example.test",
        clientId: "x",
        clientSecret: "y",
      });
      expect(res.status).toBe(400);
      expect((await issues(res)).issues[0]?.message).toContain("names a different issuer");
    } finally {
      idp.tamper = {};
    }
  });

  it("rejects Entra common/organizations tenants and a missing tenant", async () => {
    for (const tenantId of ["common", "organizations", "consumers"]) {
      const res = await owner.post("/api/v1/security/providers", {
        kind: "entra",
        clientId: "x",
        clientSecret: "y",
        tenantId,
      });
      expect((await issues(res)).issues[0]?.path).toBe("tenantId");
    }
    const missing = await owner.post("/api/v1/security/providers", { kind: "entra", clientId: "x", clientSecret: "y" });
    expect((await issues(missing)).issues[0]?.message).toContain("tenant (directory) ID");
  });

  it("is owner-only", async () => {
    for (const roles of [["hr_admin"], ["payroll_admin"]] as const) {
      const http = await clientAs(app, deps, await seedMember(deps, orgId, { roles: [...roles] }));
      expect((await http.get("/api/v1/security/settings")).status).toBe(403);
      expect(
        (
          await http.post("/api/v1/security/providers", {
            kind: "oidc",
            issuer: "https://idp.example.test",
            clientId: "x",
            clientSecret: "y",
          })
        ).status,
      ).toBe(403);
    }
  });

  it("refuses to enable a provider that isn't configured", async () => {
    const now = deps.clock.now();
    const id = deps.ids.newId();
    await deps.db.insert(ssoProviders).values({
      id,
      orgId,
      kind: "singpass",
      displayName: "Singpass",
      issuer: "https://stg-id.singpass.gov.sg",
      clientId: "sp",
      createdAt: now,
      updatedAt: now,
    });
    const res = await owner.patch(`/api/v1/security/providers/${id}`, { enabled: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorEnvelope).error.message).toContain("Singpass is not configured yet");
  });
});
