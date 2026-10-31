import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, TEST_NOW, type TestDb } from "../../../testing/index.ts";
import { createApp } from "../../app.ts";
import type { HealthResponse } from "./routes.ts";

describe("GET /api/health", () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    await testDb?.close();
  });

  it("reports ok when the database answers", async () => {
    testDb = await createTestDb();
    const app = createApp(createTestDeps(testDb.db));
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as HealthResponse;
    expect(body).toEqual({ status: "ok", version: expect.any(String), time: TEST_NOW, database: "ok" });
  });

  it("reports degraded with 503 when the database is unreachable", async () => {
    testDb = await createTestDb();
    const deps = createTestDeps(testDb.db);
    await testDb.pglite.close();
    const res = await createApp(deps).request("/api/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", database: "unreachable" });
    expect(deps.logger.entries.some((e) => e.level === "warn" && typeof e.requestId === "string")).toBe(true);
  });
});
