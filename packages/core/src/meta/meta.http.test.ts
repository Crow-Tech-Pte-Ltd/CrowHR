import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { allV1Modules, createApp } from "../app.ts";
import { orgSecuritySettings, ssoProviders } from "../db/schema/auth.ts";
import { companyProfiles } from "../db/schema/organisation.ts";
import { defineModule, defineRoute } from "../http/route.ts";

const leave = defineModule({
  name: "leave",
  basePath: "/leave-stub",
  feature: "leave",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "x",
      access: "public",
      responses: { 204: null },
      handler: () => undefined,
    }),
  ],
});

const builtInFeatures = allV1Modules().flatMap((m) => (m.feature ? [m.feature] : []));

describe("GET /api/v1/meta", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  it("links the company logo publicly once one is uploaded, for the sign-in screen and the apps", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps, { name: "Kampong Kopi", slug: "kampong-kopi" });
    const app = createApp(deps);
    const meta = async () =>
      ((await (await app.request("/api/v1/meta")).json()) as { organisations: { logoUrl: string | null }[] })
        .organisations[0];
    expect((await meta())?.logoUrl).toBeNull();
    expect((await app.request("/api/v1/meta/logo?org=kampong-kopi")).status).toBe(404);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await deps.fileStore.put("org/x/company/logo.png", png, { contentType: "image/png" });
    const now = deps.clock.now();
    await deps.db.insert(companyProfiles).values({
      orgId: org.id,
      legalName: "Kampong Kopi Pte. Ltd.",
      uen: "201912345K",
      logoFileKey: "org/x/company/logo.png",
      logoContentType: "image/png",
      createdAt: now,
      updatedAt: now,
    });
    const logoUrl = (await meta())?.logoUrl;
    expect(logoUrl).toBe(`${deps.publicUrl}/api/v1/meta/logo?org=kampong-kopi`);
    const res = await app.request(new URL(logoUrl ?? "").pathname + new URL(logoUrl ?? "").search);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect((await app.request("/api/v1/meta/logo?org=nobody")).status).toBe(404);
  });

  it("lists every feature the mobile apps gate screens on", async () => {
    const app = createApp(createTestDeps(t.db));
    const body = (await (await app.request("/api/v1/meta")).json()) as { features: string[] };
    // add-mobile-apps design decision 2: apps gate screens on these, never on version numbers.
    expect(body.features).toEqual(
      expect.arrayContaining([
        "leave",
        "attendance.offlinePunch",
        "payslips",
        "claims",
        "scheduling",
        "approvals",
        "notifications",
      ]),
    );
  });

  it("is public and includes the only organisation with its enabled methods, no secrets, cacheable", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps, { name: "Kampong Kopi", slug: "kampong-kopi" });
    await seedMember(deps, org.id, { email: "secret-member@example.sg" });
    const now = deps.clock.now();
    const enc = await deps.secretBox.encrypt("sso-client-secret", "super-secret-value");
    await deps.db.insert(ssoProviders).values([
      {
        id: deps.ids.newId(),
        orgId: org.id,
        kind: "google",
        displayName: "Google",
        issuer: "https://accounts.google.com",
        clientId: "g",
        clientSecretEnc: enc,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: deps.ids.newId(),
        orgId: org.id,
        kind: "entra",
        displayName: "Microsoft",
        issuer: "https://login.microsoftonline.com/t/v2.0",
        clientId: "e",
        clientSecretEnc: enc,
        tenantId: "t",
        enabled: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: deps.ids.newId(),
        orgId: org.id,
        kind: "singpass",
        displayName: "Singpass",
        issuer: "https://stg-id.singpass.gov.sg",
        clientId: "s",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const res = await createApp(deps, { modules: [leave] }).request("/api/v1/meta");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const text = await res.text();
    expect(text).not.toContain("super-secret-value");
    expect(text).not.toContain("secret-member");
    expect(JSON.parse(text)).toEqual({
      serverVersion: expect.any(String),
      apiVersions: ["v1"],
      // Built-in modules that declare a feature, plus the stub: modules add theirs as they land.
      features: [...builtInFeatures, "leave"],
      demo: false,
      orgSlugRequired: false,
      organisations: [
        {
          slug: "kampong-kopi",
          displayName: "Kampong Kopi",
          logoUrl: null,
          // Entra is disabled; Singpass is enabled but has no RP keys → not configured → hidden.
          signInMethods: [
            { kind: "password", displayName: "Email and password" },
            { kind: "google", displayName: "Google" },
          ],
        },
      ],
    });
  });

  it("does not list a multi-org install's organisations without a slug", async () => {
    const deps = createTestDeps(t.db);
    for (const slug of ["a-co", "b-co", "c-co"]) await seedOrg(deps, { slug });
    const app = createApp(deps);
    const body = (await (await app.request("/api/v1/meta")).json()) as {
      organisations: unknown[];
      orgSlugRequired: boolean;
    };
    expect(body).toMatchObject({ organisations: [], orgSlugRequired: true });
    const one = (await (await app.request("/api/v1/meta?org=b-co")).json()) as { organisations: { slug: string }[] };
    expect(one.organisations.map((o) => o.slug)).toEqual(["b-co"]);
  });

  it("omits password when the organisation disabled it", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps, { slug: "sso-only" });
    const { eq } = await import("drizzle-orm");
    await deps.db
      .update(orgSecuritySettings)
      .set({ passwordEnabled: false })
      .where(eq(orgSecuritySettings.orgId, org.id));
    const body = (await (await createApp(deps).request("/api/v1/meta")).json()) as {
      organisations: { signInMethods: unknown[] }[];
    };
    expect(body.organisations[0]?.signInMethods).toEqual([]);
  });
});
