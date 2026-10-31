import {
  type AppDeps,
  createReportingScopeResolver,
  createSecretBox,
  createUuidV7Generator,
  type Logger,
  parseSecretKey,
  systemClock,
} from "@crowhr/core";
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
    secretBox: createSecretBox(parseSecretKey(config.CROWHR_SECRET_KEY)),
    publicUrl: config.PUBLIC_URL,
    // Manager scope from employment records (people module).
    reportingScope: createReportingScopeResolver(database.db),
    // NOT IMPLEMENTED: SMTP mailer (add-approvals-and-notifications owns the outbox). Without it,
    // invitations and password resets offer a copyable link.
  };
}
