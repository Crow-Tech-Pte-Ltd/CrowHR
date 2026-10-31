import type { Context } from "hono";
import type { ReportingScopeResolver } from "./access/scope.ts";
import type { ClientInfo } from "./context.ts";
import type { SecretBox } from "./crypto/secret-box.ts";
import type { Db } from "./db/types.ts";
import type { FileStore } from "./files/file-store.ts";
import type { Logger } from "./logger.ts";
import type { SystemHost } from "./system/host.ts";

/**
 * Hashes and verifies passwords. Server: argon2id. Browser demo: PBKDF2 via Web Crypto with a
 * `$demo-pbkdf2$` prefix that the server hasher refuses. `verify` must return false (never throw)
 * for hashes it does not recognise.
 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
  /** True when a verified hash used weaker parameters and should be replaced on this sign-in. */
  needsRehash?(hash: string): boolean;
}

/** Outbound email. Optional: without it, invitations and resets offer a copyable link. */
export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
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
   * Resolves the client IP and scheme for a request. The server applies `TRUSTED_PROXIES`;
   * without it the client is unknown (`ip: null`) and the scheme comes from the request URL.
   */
  resolveClient?: (c: Context) => ClientInfo;
  /** Host facts for `GET /api/v1/system/status` (disk, backup settings, proxy trust). */
  systemHost?: SystemHost;
  /**
   * How route responses are checked against their declared schema (see `defineRoute`).
   * `strict` (tests): a field the schema doesn't declare fails the request with 500, so
   * undocumented fields are caught. `strip` (default, production): unknown fields are dropped.
   */
  responseValidation?: "strict" | "strip";
  /** AES-256-GCM encryption at rest, keyed from CROWHR_SECRET_KEY. */
  secretBox: SecretBox;
  /**
   * The public origin users reach the app at (PUBLIC_URL), e.g. `https://hr.example.sg`.
   * Drives the CSRF origin check, the cookie name (`__Host-` only over https) and SSO redirect URIs.
   */
  publicUrl: string;
  mailer?: Mailer;
  /** Outbound HTTP for OIDC discovery and token calls. Defaults to global `fetch`; tests inject the mock IdP. */
  httpFetch?: typeof fetch;
  /** Browser demo: SSO disabled with an explanation, persona sign-in offered. */
  demoMode?: boolean;
  /** Allowed native-app redirect URIs (api-platform). Defaults to the official app schemes. */
  nativeRedirectUris?: readonly string[];
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock {
  const date = typeof at === "string" ? new Date(at) : at;
  return { now: () => new Date(date.getTime()) };
}
