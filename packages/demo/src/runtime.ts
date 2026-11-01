import { createApp, createManualScheduler, schema } from "@crowhr/core";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createApiBridge } from "./bridge.ts";
import { demoClockOffset, movableSeedClock, offsetClock } from "./clock.ts";
import { createCookieJar, type StoredCookie } from "./cookie-jar.ts";
import { createDemoDeps } from "./deps.ts";
import { createKv, createOutboxMailer, createSqlFileStore, ensureLocalTables, type SqlClient } from "./local-store.ts";
import { applyMigrations, type MigrationBundle } from "./migrations.ts";
import type { BootStage, BootTimings, DemoInfo } from "./protocol.ts";
import { singaporeDate } from "./seed/dates.ts";
import { seedDemo } from "./seed/index.ts";
import { DEMO_ORG } from "./seed/people.ts";

/**
 * One visitor's demo: their PGlite database, the real core app on it, and the bridge that turns
 * page requests into app requests. Runs in the demo Web Worker (and in tests, on in-memory PGlite).
 */
interface Meta {
  dataVersion: string;
  offsetMs: number;
  secretKey: string;
  seededAt: string;
  /** Build snapshots are re-anchored only once, on their first visitor open. */
  needsAnchor?: boolean;
  snapshotOrigin?: string;
}

export interface OpenDemoInput {
  pglite: PGlite;
  origin: string;
  dataVersion: string;
  migrations: MigrationBundle;
  /** Real time; tests pass a fixed value. */
  realNow?: () => number;
  onStage?: (stage: BootStage, label: string) => void;
  onOutbox?: (count: number) => void;
  /** Persists the database (IndexedDB). Awaited after every write so a reload never loses it. */
  flush?: () => Promise<void>;
}

const b64 = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  decode: (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)),
};

export async function openDemo(input: OpenDemoInput) {
  const realNow = input.realNow ?? Date.now;
  const stages: BootTimings["stages"] = [];
  let mark = realNow();
  const stage = (s: BootStage) => {
    const now = realNow();
    stages.push({ stage: s, ms: now - mark });
    mark = now;
  };
  const started = mark;
  const sql = input.pglite as unknown as SqlClient;
  const db = drizzle({ client: input.pglite, schema });
  await ensureLocalTables(sql);
  const kv = createKv(sql);
  let meta = await kv.get<Meta>("meta");
  if (meta && meta.dataVersion !== input.dataVersion) {
    throw new Error(`This database holds demo data version ${meta.dataVersion}, not ${input.dataVersion}.`);
  }
  let seeded = false;
  const fileStore = await createSqlFileStore(sql);

  if (!meta) {
    input.onStage?.("migrate", "Creating the database");
    await applyMigrations(db, input.migrations);
    stage("migrate");
    input.onStage?.("seed", "Seeding Kopi Kaki's payroll history");
    const secretKey = crypto.getRandomValues(new Uint8Array(32));
    const seedClock = movableSeedClock("2026-06-22T01:00:00.000Z");
    const seedMailer = createOutboxMailer(sql, { now: seedClock.now });
    const seedDeps = createDemoDeps({
      db,
      clock: seedClock,
      fileStore,
      mailer: seedMailer,
      secretKey,
      publicUrl: input.origin,
    });
    await seedDemo(seedDeps, seedClock, input.origin);
    await fileStore.flush();
    meta = {
      dataVersion: input.dataVersion,
      offsetMs: demoClockOffset(new Date(realNow())),
      secretKey: b64.encode(secretKey),
      seededAt: new Date(realNow()).toISOString(),
    };
    await kv.set("meta", meta);
    seeded = true;
    stage("seed");
  }

  if (meta.needsAnchor) {
    // Seeded outbox links must work on local previews and alternate static hosts too.
    if (meta.snapshotOrigin && meta.snapshotOrigin !== input.origin) {
      await sql.query(
        "update demo_outbox set body_text = replace(body_text, $1, $2), body_html = replace(body_html, $1, $2)",
        [meta.snapshotOrigin, input.origin],
      );
    }
    meta = {
      ...meta,
      needsAnchor: false,
      offsetMs: demoClockOffset(new Date(realNow())),
      seededAt: new Date(realNow()).toISOString(),
    };
    await kv.set("meta", meta);
    // A snapshot restore is a fresh visitor copy, just like seeding, for durability and reset.
    seeded = true;
  }

  input.onStage?.("app", "Starting Crow HR");
  const offsetMs = meta.offsetMs;
  const clock = offsetClock(offsetMs, realNow);
  const mailer = createOutboxMailer(sql, {
    now: clock.now,
    onSent: () => void mailer.count().then((n) => input.onOutbox?.(n)),
  });
  const deps = createDemoDeps({
    db,
    clock,
    fileStore,
    mailer,
    secretKey: b64.decode(meta.secretKey),
    publicUrl: input.origin,
  });
  const app = createApp(deps);
  const jar = createCookieJar((await kv.get<StoredCookie[]>("cookies")) ?? []);
  const handle = createApiBridge(app, {
    origin: input.origin,
    jar,
    now: () => clock.now().getTime(),
    onCookiesChanged: () => kv.set("cookies", jar.toJSON()),
    afterWrite: async () => {
      await fileStore.flush();
      await input.flush?.();
    },
  });
  const scheduler = createManualScheduler(deps);
  scheduler.start();
  stage("app");

  const info: DemoInfo = {
    dataVersion: meta.dataVersion,
    orgSlug: DEMO_ORG.slug,
    today: singaporeDate(clock.now()),
    seededAt: meta.seededAt,
  };
  const timings: BootTimings = { stages, totalMs: realNow() - started, seeded };
  return {
    handle,
    deps,
    app,
    jar,
    info,
    timings,
    tick: async () => {
      const report = await scheduler.tick();
      await fileStore.flush();
      return report;
    },
    outbox: () => mailer.list(),
    outboxCount: () => mailer.count(),
    stop: () => scheduler.stop(),
  };
}

export type DemoRuntime = Awaited<ReturnType<typeof openDemo>>;

/** Mark only a build-generated copy; its build-machine date must never become a visitor's clock. */
export async function prepareDemoSnapshot(pglite: PGlite, origin: string) {
  const kv = createKv(pglite as unknown as SqlClient);
  const meta = await kv.get<Meta>("meta");
  if (!meta) throw new Error("Cannot snapshot an unseeded demo");
  await kv.set("meta", { ...meta, needsAnchor: true, snapshotOrigin: origin });
}

export async function validateDemoSnapshot(pglite: PGlite, dataVersion: string) {
  const meta = await createKv(pglite as unknown as SqlClient).get<Meta>("meta");
  if (meta?.dataVersion !== dataVersion || !meta.needsAnchor) throw new Error("Stale or unseeded demo snapshot");
}
