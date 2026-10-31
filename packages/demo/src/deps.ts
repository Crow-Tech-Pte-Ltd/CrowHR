import {
  type AppDeps,
  type Clock,
  createApproverDirectory,
  createDemoPasswordHasher,
  createReportingScopeResolver,
  createSecretBox,
  createUuidV7Generator,
  type Db,
  type FileStore,
  type Logger,
  type LogLevel,
  type Mailer,
  peopleDates,
  peopleManagerResolver,
} from "@crowhr/core";

/**
 * The browser host's AppDeps: the same wiring as apps/server/src/deps.ts, with browser
 * substitutes for the host-specific parts (design decision 12 of add-identity-and-access):
 *
 * | Dep | Server | Demo |
 * | --- | --- | --- |
 * | db | node-postgres | PGlite on IndexedDB, one database per visitor |
 * | passwordHasher | argon2id | PBKDF2 on Web Crypto (`$demo-pbkdf2$`, refused by the server) |
 * | fileStore | local disk | the visitor's own database (`demo_files`) |
 * | clock | system | system time shifted onto the demo date (clock.ts) |
 * | mailer | SMTP (optional) | the Demo outbox (`demo_outbox`) |
 * | secretBox | CROWHR_SECRET_KEY | a random key generated per visitor, kept with the database |
 */
export interface DemoDepsInput {
  db: Db;
  clock: Clock;
  fileStore: FileStore;
  mailer: Mailer;
  secretKey: Uint8Array;
  publicUrl: string;
  logger?: Logger;
}

export function createDemoDeps(input: DemoDepsInput): AppDeps {
  return {
    db: input.db,
    passwordHasher: createDemoPasswordHasher(),
    fileStore: input.fileStore,
    clock: input.clock,
    ids: createUuidV7Generator(input.clock),
    logger: input.logger ?? createConsoleLogger("warn"),
    secretBox: createSecretBox(input.secretKey),
    publicUrl: input.publicUrl,
    mailer: input.mailer,
    demoMode: true,
    reportingScope: createReportingScopeResolver(input.db),
    approverDirectory: createApproverDirectory({ managers: peopleManagerResolver }),
    peopleDates,
    responseValidation: "strip",
  };
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Logs to the browser console (warn and above by default; the demo has no log files). */
export function createConsoleLogger(level: LogLevel, base: Record<string, unknown> = {}): Logger {
  const emit = (l: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[l] < ORDER[level]) return;
    const entry = { ...base, ...fields };
    if (l === "error") console.error(`[crowhr-demo] ${message}`, entry);
    else console.warn(`[crowhr-demo] ${message}`, entry);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createConsoleLogger(level, { ...base, ...fields }),
  };
}
