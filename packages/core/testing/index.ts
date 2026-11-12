/**
 * Test utilities for @crowhr/core. Node-only (lives outside src/ on purpose so
 * the runtime-agnostic check never sees it). Import from "@crowhr/core/testing".
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createSecretBox } from "../src/crypto/secret-box.ts";
import * as schema from "../src/db/schema/index.ts";
import type { Db } from "../src/db/types.ts";
import { type AppDeps, fixedClock, type PasswordHasher } from "../src/deps.ts";
import { createMemoryFileStore } from "../src/files/memory-file-store.ts";
import { createUuidV7Generator } from "../src/ids.ts";
import { createMemoryLogger } from "../src/logger.ts";
import { createApproverDirectory } from "../src/workflows/directory.ts";
import { peopleDates, peopleManagerResolver } from "../src/workflows/people.ts";
import { migrationsFolder } from "./migrations-folder.ts";

export interface TestDb {
  db: Db;
  /** The underlying PGlite instance, for raw SQL or simulating failures (`close()`). */
  pglite: PGlite;
  close(): Promise<void>;
}

/**
 * A migrated data directory, built once per test worker. Booting PGlite and running every
 * migration takes over a second (several on CI runners); loading this snapshot takes a fraction
 * of that, and each test still gets its own independent database.
 */
let migratedSnapshot: Promise<Blob> | undefined;

function migratedDataDir(): Promise<Blob> {
  migratedSnapshot ??= (async () => {
    const pglite = new PGlite();
    await migrate(drizzle({ client: pglite, schema }), { migrationsFolder });
    const dump = await pglite.dumpDataDir("none");
    await pglite.close();
    return dump;
  })();
  return migratedSnapshot;
}

/** A fresh in-memory Postgres (PGlite) with every migration applied. No Docker. */
export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite({ loadDataDir: await migratedDataDir() });
  const db = drizzle({ client: pglite, schema });
  return {
    db,
    pglite,
    close: async () => {
      if (!pglite.closed) await pglite.close();
    },
  };
}

/**
 * NOT FOR PRODUCTION: reversible "hash" so tests stay fast. Never wire this
 * into a real host.
 */
export const fakePasswordHasher: PasswordHasher & { verifyCalls: number } = {
  verifyCalls: 0,
  hash: async (plain) => `fake$${plain}`,
  async verify(hash, plain) {
    fakePasswordHasher.verifyCalls++;
    return hash === `fake$${plain}`;
  },
  needsRehash: (hash) => hash.startsWith("fake-weak$"),
};

/** Fixed 32-byte test key (never use outside tests). */
export const TEST_SECRET_KEY = new Uint8Array(32).fill(7);
export const TEST_PUBLIC_URL = "https://hr.test";

/** Default test clock: 31 Oct 2026, 09:00 Singapore time. */
export const TEST_NOW = "2026-10-31T01:00:00.000Z";

export function createTestDeps(
  db: Db,
  overrides: Partial<AppDeps> = {},
): AppDeps & {
  logger: ReturnType<typeof createMemoryLogger>;
} {
  const clock = overrides.clock ?? fixedClock(TEST_NOW);
  const logger = createMemoryLogger();
  return {
    db,
    passwordHasher: fakePasswordHasher,
    fileStore: createMemoryFileStore(),
    clock,
    ids: createUuidV7Generator(clock),
    responseValidation: "strict",
    secretBox: createSecretBox(TEST_SECRET_KEY),
    publicUrl: TEST_PUBLIC_URL,
    // Workflows read real reporting lines and dates from the people tables (tests may override).
    approverDirectory: createApproverDirectory({ managers: peopleManagerResolver }),
    peopleDates,
    ...overrides,
    logger,
  };
}

export * from "./cross-org.ts";
export * from "./demo-companies.ts";
export * from "./fixtures.ts";
export * from "./http.ts";
export * from "./mock-oidc.ts";
export * from "./sso.ts";
export * from "./workflows.ts";
