import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestDeps,
  movableClock,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";

const PASSWORD = "chicken rice with chilli";

/** The organisation switcher's list: the organisations the signed-in person can switch to. */
describe("GET /me/organisations", () => {
  let t: TestDb;
  const clock = movableClock("2026-11-13T01:00:00Z");
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  const orgs: Record<string, { id: string; slug: string }> = {};
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    app = createApp(deps);
    for (const [key, name] of [
      ["home", "Kopi Kaki Pte. Ltd."],
      ["second", "Bakery Two Pte. Ltd."],
      ["former", "Teh Tarik Pte. Ltd."],
      ["suspended", "Suspended Co"],
      ["invited", "Invited Co"],
      ["stranger", "Stranger Co"],
    ] as const)
      orgs[key] = await seedOrg(deps, { name, slug: key });
    await seedMember(deps, orgs.home?.id as string, { email: "aisyah@example.sg", password: PASSWORD });
    await seedMember(deps, orgs.second?.id as string, { email: "aisyah@example.sg" });
    await seedMember(deps, orgs.former?.id as string, { email: "aisyah@example.sg", status: "former" });
    await seedMember(deps, orgs.suspended?.id as string, { email: "aisyah@example.sg", status: "suspended" });
    await seedMember(deps, orgs.invited?.id as string, { email: "aisyah@example.sg", status: "invited" });
    await seedMember(deps, orgs.stranger?.id as string, { email: "someone@example.sg", password: PASSWORD });
  });
  afterAll(() => t.close());

  async function signedIn(org: string, email: string) {
    const http = testClient(app, deps);
    const res = await http.post("/api/v1/auth/sign-in", { org, email, password: PASSWORD });
    expect(res.status).toBe(200);
    return http;
  }
  type Item = { id: string; name: string; slug: string; current: boolean; status: string };
  const list = async (http: Awaited<ReturnType<typeof signedIn>>) => {
    const res = await http.get("/api/v1/me/organisations");
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: Item[] }).items;
  };

  it("lists only the organisations you can switch to, the current one marked, by name", async () => {
    const http = await signedIn("home", "aisyah@example.sg");
    expect(await list(http)).toEqual([
      { id: orgs.second?.id, name: "Bakery Two Pte. Ltd.", slug: "second", current: false, status: "active" },
      { id: orgs.home?.id, name: "Kopi Kaki Pte. Ltd.", slug: "home", current: true, status: "active" },
      { id: orgs.former?.id, name: "Teh Tarik Pte. Ltd.", slug: "former", current: false, status: "former" },
    ]);
  });

  it("follows a switch, and every listed organisation can be switched to", async () => {
    const http = await signedIn("home", "aisyah@example.sg");
    for (const item of await list(http)) {
      const res = await http.post("/api/v1/auth/switch-organisation", { org: item.slug });
      expect(res.status, item.slug).toBe(200);
      expect((await list(http)).find((o) => o.current)?.slug).toBe(item.slug);
    }
  });

  it("never shows another person's organisations", async () => {
    const http = await signedIn("stranger", "someone@example.sg");
    expect((await list(http)).map((o) => o.slug)).toEqual(["stranger"]);
  });

  it("needs a session", async () => {
    expect((await testClient(app, deps).get("/api/v1/me/organisations")).status).toBe(401);
  });
});
