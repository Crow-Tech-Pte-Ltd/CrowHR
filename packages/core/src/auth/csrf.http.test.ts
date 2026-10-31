import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { ErrorEnvelope } from "../errors.ts";

describe("CSRF protection", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let org: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
    org = await seedOrg(deps);
  });
  afterAll(() => t.close());

  it("rejects a cross-origin POST carrying a valid session cookie", async () => {
    const owner = await seedMember(deps, org.id, { roles: ["owner"] });
    const http = await clientAs(app, deps, owner);
    const res = await http.post("/api/v1/me/sessions/revoke-others", undefined, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("csrf_rejected");
  });

  it("rejects Sec-Fetch-Site: cross-site even without Origin", async () => {
    const m = await seedMember(deps, org.id);
    const http = await clientAs(app, deps, m);
    const res = await http.request("/api/v1/me/sessions/revoke-others", {
      method: "POST",
      headers: { origin: "", "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts same-origin requests", async () => {
    const m = await seedMember(deps, org.id);
    const http = await clientAs(app, deps, m);
    const res = await http.post("/api/v1/me/sessions/revoke-others", undefined, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(res.status).toBe(200);
  });

  it("leaves GET alone", async () => {
    const m = await seedMember(deps, org.id);
    const http = await clientAs(app, deps, m);
    expect((await http.get("/api/v1/me", { headers: { origin: "https://evil.example" } })).status).toBe(200);
  });

  it("protects the unauthenticated sign-in POST (login CSRF)", async () => {
    const res = await app.request("https://hr.test/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ org: org.slug, email: "a@b.sg", password: "x" }),
    });
    expect(res.status).toBe(403);
  });
});
