import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { DEMO_COMPANY_DEFAULTS } from "../demo-companies/config.ts";

describe("AI assistant connector", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it("only an owner can opt a company in and both demo modes stay unavailable", async () => {
    const deps = createTestDeps(t.db, { publicUrl: "https://hr.example.org", assistantEnabled: true });
    const app = createApp(deps);
    const org = await seedOrg(deps);
    const owner = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["owner"] }));
    const hr = await clientAs(app, deps, await seedMember(deps, org.id, { roles: ["hr_admin"] }));
    const path = "/api/v1/assistant/settings";
    expect((await hr.put(path, { enabled: true })).status).toBe(403);
    expect((await owner.put(path, { enabled: true })).status).toBe(200);
    const transport = { assistantTransport: async () => Response.json({}) };
    const demo = createApp({ ...deps, demoMode: true }, transport);
    const sharedDemo = createApp(
      {
        ...deps,
        demoCompanies: {
          ...DEMO_COMPANY_DEFAULTS,
          provision: async () => {
            throw new Error("Unexpected demo provision");
          },
        },
      },
      transport,
    );
    expect((await sharedDemo.request(`/mcp/${org.slug}`)).status).toBe(404);
    expect((await demo.request("/.well-known/oauth-authorization-server")).status).toBe(404);
    expect(
      (
        await createApp({ ...deps, assistantEnabled: false }, transport).request(
          "/.well-known/oauth-authorization-server",
        )
      ).status,
    ).toBe(404);
  });
});
