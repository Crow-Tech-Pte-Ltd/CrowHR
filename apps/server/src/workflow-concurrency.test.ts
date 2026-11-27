import { type Db, schema, tick } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { createWorkflowWorld, movableClock, type WorkflowWorld } from "@crowhr/core/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createPgAdvisoryLock } from "./db.ts";
import { runMigrations } from "./migrate/runner.ts";

// The self-host CI job supplies a disposable database. PGlite serialises connections.
describe.skipIf(!process.env.CROWHR_TEST_POSTGRES_URL)("approval concurrency on PostgreSQL", () => {
  it("continues other escalations while a decision holds the parent request lock", async () => {
    const pool = new pg.Pool({ connectionString: process.env.CROWHR_TEST_POSTGRES_URL });
    const db = drizzle({ client: pool, schema }) as unknown as Db;
    const reset = () =>
      pool.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
    let world: WorkflowWorld | undefined;
    try {
      await reset();
      await runMigrations({ db, lock: createPgAdvisoryLock(pool), migrationsFolder });
      const clock = movableClock("2026-11-02T01:00:00.000Z");
      world = await createWorkflowWorld({ db, clock });
      const locked = await world.submit(world.m.staff, "leave");
      await world.submit(world.m.other, "leave");
      clock.set("2026-11-06T01:00:00.000Z");

      const decision = await pool.connect();
      let beforeUnlock: Awaited<ReturnType<typeof tick>> | null = null;
      let sweep: ReturnType<typeof tick> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await decision.query("begin");
        await decision.query("select id from approval_requests where id = $1 for update", [locked.requestId]);
        sweep = tick(world.deps);
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 3_000);
        });
        beforeUnlock = await Promise.race([sweep, timeout]);
      } finally {
        clearTimeout(timer);
        await decision.query("rollback");
        decision.release();
        await sweep;
      }
      expect(beforeUnlock?.errors).toEqual([]);
      expect(beforeUnlock?.escalations).toBe(1);
      expect((await tick(world.deps)).escalations).toBe(1);
      expect((await tick(world.deps)).escalations).toBe(0);
    } finally {
      await world?.close();
      await reset();
      await pool.end();
    }
  });
});
