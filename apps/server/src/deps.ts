import { join } from "node:path";
import {
  type AppDeps,
  createApproverDirectory,
  createReportingScopeResolver,
  createSecretBox,
  createUuidV7Generator,
  type DemoCompaniesDeps,
  type Logger,
  peopleDates,
  peopleManagerResolver,
  systemClock,
} from "@crowhr/core";
import type { DemoCompanyProvisionerInput } from "@crowhr/demo/demo-company";
import { demoCompanyPersonaInfo } from "@crowhr/demo/demo-company-personas";
import { createArgon2Hasher } from "./argon2-hasher.ts";
import { findSingpassLogo, SINGPASS_LOGO_PATH } from "./branding.ts";
import { createClamAvScanner } from "./clamav.ts";
import type { ServerConfig } from "./config.ts";
import { type Database, openDatabase } from "./db.ts";
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
  const fileStore = createDiskFileStore(config.FILE_STORAGE_DIR);
  return {
    ...{ fileScanner },
    db: database.db,
    passwordHasher: createArgon2Hasher(),
    fileStore,
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
    // The official Singpass logo, when the deployer put it in <DATA_DIR>/branding (checked per request).
    singpassLogoUrl: () => (findSingpassLogo(join(config.DATA_DIR, "branding")) ? SINGPASS_LOGO_PATH : null),
    // The in-browser demo's Singpass round trip (DEMO_SINGPASS_*), off unless both are set.
    ...(config.DEMO_SINGPASS_PROVIDER_ID && config.DEMO_SINGPASS_RETURN_URL
      ? {
          demoSingpass: {
            providerId: config.DEMO_SINGPASS_PROVIDER_ID,
            returnUrl: config.DEMO_SINGPASS_RETURN_URL,
          },
        }
      : {}),
    // Demo companies (DEMO_COMPANIES=1): each copy is seeded in its own in-memory PGlite, then
    // copied into this database and file store. Off unless configured.
    ...(config.demoCompanies
      ? {
          demoCompanies: {
            ...config.demoCompanies,
            provision: lazyDemoCompanyProvisioner({
              target: database.db,
              fileStore,
              secretKey: new Uint8Array(secretKey),
              publicUrl: config.PUBLIC_URL,
              logger,
              openScratch: openScratchDatabase,
            }),
            personaInfo: demoCompanyPersonaInfo,
          },
        }
      : {}),
    // `mailer` (SMTP_URL / MAIL_FROM, see mailer.ts) arrives in `extra` when configured; without it,
    // notifications are in-app only and invitations and password resets offer a copyable link.
    ...extra,
  };
}

/**
 * The demo-company seed (packages/demo) and PGlite load on the first seed, so a server that never
 * makes a demo company never loads them.
 */
function lazyDemoCompanyProvisioner(input: DemoCompanyProvisionerInput): DemoCompaniesDeps["provision"] {
  let provisioner: Promise<DemoCompaniesDeps["provision"]> | null = null;
  return async (args) => {
    provisioner ??= import("@crowhr/demo/demo-company").then((m) => m.createDemoCompanyProvisioner(input));
    return (await provisioner)(args);
  };
}

/** A fresh, migrated in-memory database for one demo-company seed (closed by the caller). */
async function openScratchDatabase() {
  const scratch = await openDatabase("pglite:memory");
  try {
    await scratch.migrate();
  } catch (err) {
    await scratch.close().catch(() => undefined);
    throw err;
  }
  return { db: scratch.db, close: () => scratch.close() };
}
