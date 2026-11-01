import { PGlite } from "@electric-sql/pglite";
import type { MigrationBundle } from "../src/migrations.ts";
import { openDemo, prepareDemoSnapshot } from "../src/runtime.ts";

/** Shared by the Node build script and the dump/load regression test. No browser assets needed. */
export async function buildDemoSnapshot(dataVersion: string, migrations: MigrationBundle): Promise<Blob> {
  const pglite = new PGlite();
  try {
    const demo = await openDemo({ pglite, origin: "https://hr.crow.sg", dataVersion, migrations });
    await demo.stop();
    await prepareDemoSnapshot(pglite, "https://hr.crow.sg");
    // Checkpoint so visitors do not replay the seed's WAL history during startup.
    await pglite.exec("CHECKPOINT");
    return await pglite.dumpDataDir("gzip");
  } finally {
    await pglite.close();
  }
}
