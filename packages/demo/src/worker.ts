import { PGlite } from "@electric-sql/pglite";
import { pgliteAssets } from "./pglite-assets.ts";
import type { BootStage, FromWorker, ToWorker } from "./protocol.ts";
import type { DemoRuntime } from "./runtime.ts";

/**
 * The demo Web Worker: owns the visitor's PGlite database (IndexedDB) and the real core app, so
 * Postgres, payroll computation and PDF rendering never block the page. The page talks to it over
 * a tiny RPC (protocol.ts). Exactly one tab runs it at a time (the page holds a Web Lock), because
 * two PGlite instances must never write the same IndexedDB database.
 */
declare const self: DedicatedWorkerGlobalScope;

export const DB_PREFIX = "crowhr-demo-";

let runtime: DemoRuntime | null = null;
let pglite: PGlite | null = null;
let boot: { origin: string; dataVersion: string } | null = null;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

// Start the big downloads the moment the worker script runs, in parallel: PGlite's WebAssembly and
// filesystem bundle (pglite-assets.ts) and the chunk with core and the seed (~2.5 MB of JS). The
// modules are reused by a reset.
const assets = pgliteAssets();
const runtimeModule = import("./runtime.ts");
const migrationsModule = import("./bundled-migrations.ts");

// With `relaxedDurability`, PGlite copies its in-memory files to IndexedDB in the background after
// a query. A temporary file Postgres deletes in the meantime (sort spill, relation rewrite) makes
// that copy reject with ENOENT (Emscripten errno 44); the next sync writes the current state, so
// nothing is lost. Swallow only that case; anything else still surfaces.
self.addEventListener("unhandledrejection", (event) => {
  const r = event.reason as { name?: string; errno?: number } | null;
  if (r?.name === "ErrnoError" && r.errno === 44) event.preventDefault();
});

/**
 * Durable write-back to IndexedDB. PGlite runs with `relaxedDurability` (its own sync after each
 * query is fire-and-forget, which keeps seeding fast); the bridge awaits this after every
 * state-changing request, so what the UI shows as saved survives a reload. It runs while no query
 * is executing, so the copy is never taken mid-statement.
 */
async function flush() {
  const p = pglite;
  if (!p?.fs) return;
  const fs = p.fs;
  await p.runExclusive(() => fs.syncToFs(false));
}

async function deleteOldDatabases(keep: string | null) {
  // PGlite's IndexedDB filesystem stores `idb://<name>` as the database `/pglite/<name>`.
  const all = (await indexedDB.databases?.()) ?? [];
  for (const db of all) {
    if (!db.name?.includes(DB_PREFIX)) continue;
    if (keep && db.name.endsWith(keep)) continue;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(db.name as string);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
}

async function start(origin: string, dataVersion: string) {
  boot = { origin, dataVersion };
  const name = `${DB_PREFIX}${dataVersion}`;
  const stageStart = performance.now();
  const progress = (stage: BootStage, label: string) => post({ event: "progress", stage, label });
  progress("wasm", "Starting Postgres in your browser");
  // A new demo release with a different data version starts clean; old copies are deleted.
  await deleteOldDatabases(name);
  pglite = await PGlite.create(`idb://${name}`, { relaxedDurability: true, ...(await assets) });
  const [{ openDemo }, { CORE_MIGRATIONS }] = await Promise.all([runtimeModule, migrationsModule]);
  const wasmMs = performance.now() - stageStart;
  progress("open", "Opening your copy of the demo");
  runtime = await openDemo({
    pglite,
    origin,
    dataVersion,
    migrations: CORE_MIGRATIONS,
    realNow: () => Date.now(),
    onStage: progress,
    onOutbox: (count) => post({ event: "outbox", count }),
    flush,
  });
  // Persist the fresh seed and run the first scheduled sweep just after the app is on screen
  // (doing it first would add ~100 ms to the first load). Requests wait for the flush's lock.
  const started = runtime;
  setTimeout(() => {
    void (async () => {
      if (started.timings.seeded) await flush();
      await started.tick();
      await flush();
    })().catch(() => undefined);
  }, 0);
  const timings = {
    ...runtime.timings,
    stages: [{ stage: "wasm" as const, ms: Math.round(wasmMs) }, ...runtime.timings.stages],
    totalMs: Math.round(performance.now() - stageStart),
  };
  return { timings, info: runtime.info };
}

async function reset() {
  if (!boot) throw new Error("The demo hasn't started yet.");
  await runtime?.stop();
  await pglite?.close();
  runtime = null;
  pglite = null;
  await deleteOldDatabases(null);
  const result = await start(boot.origin, boot.dataVersion);
  // The page reloads right after a reset: the new seed must be on disk first.
  await flush();
  return result;
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    switch (msg.method) {
      case "boot":
        post({ id: msg.id, result: await start(msg.params.origin, msg.params.dataVersion) });
        return;
      case "fetch": {
        if (!runtime) throw new Error("The demo is still starting.");
        const res = await runtime.handle(msg.params);
        post({ id: msg.id, result: res }, [res.body]);
        return;
      }
      case "reset":
        post({ id: msg.id, result: await reset() });
        return;
      case "outbox":
        post({ id: msg.id, result: runtime ? await runtime.outbox() : [] });
        return;
      case "tick":
        if (runtime) {
          await runtime.tick();
          await flush();
        }
        post({ id: msg.id, result: { ran: !!runtime } });
        return;
    }
  } catch (err) {
    post({ id: msg.id, error: { message: err instanceof Error ? err.message : String(err) } });
  }
};
