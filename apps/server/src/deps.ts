import { type AppDeps, createUuidV7Generator, type Logger, systemClock } from "@crowhr/core";
import { createArgon2Hasher } from "./argon2-hasher.ts";
import type { ServerConfig } from "./config.ts";
import type { Database } from "./db.ts";
import { createDiskFileStore } from "./disk-file-store.ts";

export function createServerDeps(config: ServerConfig, database: Database, logger: Logger): AppDeps {
  return {
    db: database.db,
    passwordHasher: createArgon2Hasher(),
    fileStore: createDiskFileStore(config.FILE_STORAGE_DIR),
    clock: systemClock,
    ids: createUuidV7Generator(systemClock),
    logger,
  };
}
