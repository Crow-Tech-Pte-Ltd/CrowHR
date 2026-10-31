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
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock {
  const date = typeof at === "string" ? new Date(at) : at;
  return { now: () => new Date(date.getTime()) };
}
