import type { ReportingScopeResolver } from "./access/scope.ts";
import type { Db } from "./db/types.ts";
import type { FileStore } from "./files/file-store.ts";
import type { Logger } from "./logger.ts";

/** Hashes and verifies passwords. Server: argon2id. Browser demo: whatever runs there. */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

/** Source of "now". Inject a fixed clock in tests; never call `new Date()` in services. */
export interface Clock {
  now(): Date;
}

/** Generates primary keys. */
export interface IdGenerator {
  newId(): string;
}

/**
 * Everything host-specific that core needs. Core never imports a driver,
 * filesystem or crypto library directly; the host (apps/server, the browser
 * demo, tests) builds these and passes them to `createApp`.
 */
export interface AppDeps {
  db: Db;
  passwordHasher: PasswordHasher;
  fileStore: FileStore;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /**
   * Manager scope (direct + indirect reports). Implemented by the people module; defaults to
   * `noReportingLines` (nobody is a manager) when absent.
   */
  reportingScope?: ReportingScopeResolver;
  /**
   * How route responses are checked against their declared schema (see `defineRoute`).
   * `strict` (tests): a field the schema doesn't declare fails the request with 500, so
   * undocumented fields are caught. `strip` (default, production): unknown fields are dropped.
   */
  responseValidation?: "strict" | "strip";
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock {
  const date = typeof at === "string" ? new Date(at) : at;
  return { now: () => new Date(date.getTime()) };
}
