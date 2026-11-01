import {
  type AppDeps,
  createApproverDirectory,
  createReportingScopeResolver,
  createSecretBox,
  createUuidV7Generator,
  type Logger,
  peopleDates,
  peopleManagerResolver,
  systemClock,
} from "@crowhr/core";
import { createArgon2Hasher } from "./argon2-hasher.ts";
import { createClamAvScanner } from "./clamav.ts";
import type { ServerConfig } from "./config.ts";
import type { Database } from "./db.ts";
import { createDiskFileStore } from "./disk-file-store.ts";
import { createClientResolver } from "./proxy/client.ts";
import { createSystemHost } from "./system/host.ts";

/** `secretKey` is the resolved CROWHR_SECRET_KEY (environment, key file, or generated on first boot). */
export function createServerDeps(
  config: ServerConfig,
  database: Database,
  logger: Logger,
  secretKey: Uint8Array,
  extra: Partial<AppDeps> = {},
): AppDeps {
  const fileScanner = config.CLAMAV_HOST
    ? createClamAvScanner({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT })
    : undefined;
  return {
    ...{ fileScanner },
    db: database.db,
    passwordHasher: createArgon2Hasher(),
    fileStore: createDiskFileStore(config.FILE_STORAGE_DIR),
    clock: systemClock,
    ids: createUuidV7Generator(systemClock),
    logger,
    secretBox: createSecretBox(new Uint8Array(secretKey)),
    // Cookie security (`Secure`, `__Host-`) and the CSRF origin derive from PUBLIC_URL, never from
    // request headers, so https works behind a TLS-terminating proxy.
    publicUrl: config.PUBLIC_URL,
    // Manager scope from employment records (people module).
    reportingScope: createReportingScopeResolver(database.db),
    // Approvals: line managers, work-pass expiry and probation dates from the people module.
    approverDirectory: createApproverDirectory({ managers: peopleManagerResolver }),
    peopleDates,
    resolveClient: createClientResolver({ trusted: config.TRUSTED_PROXIES, logger, dataDir: config.DATA_DIR }),
    systemHost: createSystemHost(config, database.driver),
    // `mailer` (SMTP_URL / MAIL_FROM, see mailer.ts) arrives in `extra` when configured; without it,
    // notifications are in-app only and invitations and password resets offer a copyable link.
    ...extra,
  };
}
