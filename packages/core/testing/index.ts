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
import { migrationsFolder } from "./migrations-folder.ts";

export interface TestDb {
  db: Db;
  /** The underlying PGlite instance, for raw SQL or simulating failures (`close()`). */
  pglite: PGlite;
  close(): Promise<void>;
}

/** A fresh in-memory Postgres (PGlite) with every migration applied. No Docker. */
export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite();
  const db = drizzle({ client: pglite, schema });
  await migrate(db, { migrationsFolder });
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
    ...overrides,
    logger,
  };
}

export * from "./cross-org.ts";
export * from "./fixtures.ts";
export * from "./http.ts";
export * from "./mock-oidc.ts";
export * from "./sso.ts";
export * from "./workflows.ts";
