import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../../context.ts";
import { VERSION } from "../../version.ts";

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  time: string;
  database: "ok" | "unreachable";
}

/** `GET /api/health` — unauthenticated liveness + database reachability. */
export const healthRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { db, clock } = c.var.deps;
  let database: HealthResponse["database"] = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    database = "unreachable";
    c.var.logger.warn("Health check: database unreachable", { err });
  }
  const body: HealthResponse = {
    status: database === "ok" ? "ok" : "degraded",
    version: VERSION,
    time: clock.now().toISOString(),
    database,
  };
  c.header("cache-control", "no-store");
  return c.json(body, database === "ok" ? 200 : 503);
});
