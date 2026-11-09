import type { Context } from "hono";
import type { ReportingScopeResolver } from "./access/scope.ts";
import type { ClientInfo } from "./context.ts";
import type { SecretBox } from "./crypto/secret-box.ts";
import type { Db } from "./db/types.ts";
import type { FileStore } from "./files/file-store.ts";
import type { Logger } from "./logger.ts";
import type { SystemHost } from "./system/host.ts";
import type { ApproverDirectory, PeopleDates, WorkflowPlugin } from "./workflows/types.ts";

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
  send(message: { to: string; subject: string; text: string; html?: string }): Promise<void>;
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
  /**
   * Demo Singpass round trip (server settings DEMO_SINGPASS_PROVIDER_ID / DEMO_SINGPASS_RETURN_URL):
   * this server is the Singpass relying party for the in-browser demo. `purpose=demo` on that one
   * Singpass provider validates Singpass's answer, keeps nothing about the person and redirects to
   * `returnUrl` with `singpass=ok|failed`. Off when absent.
   */
  /**
   * URL of the official Singpass logo for the Singpass button, if the deployer supplied one (the
   * repository has no Singpass artwork). Server: `/branding/singpass-logo` when the file exists in
   * the data directory; demo: the build-time `VITE_SINGPASS_LOGO_SRC`.
   */
  singpassLogoUrl?: () => string | null;
  demoSingpass?: {
    providerId: string;
    returnUrl: string;
    /** Starts per network per hour (default 20). */
    hourlyLimitPerNetwork?: number;
    /** Starts per day overall (default 1,000; Singpass Login is free up to 50,000 a month per UEN). */
    dailyLimit?: number;
  };
  /** Allowed native-app redirect URIs (api-platform). Defaults to the official app schemes. */
  nativeRedirectUris?: readonly string[];
  /**
   * Approver lookups for the approval engine (workflows). Defaults to memberships + roles with no
   * reporting lines (nobody has a manager) until the people module supplies `managerOf`.
   */
  approverDirectory?: ApproverDirectory;
  /** Work pass and probation dates for reminders (people module). Absent: those reminders are off. */
  peopleDates?: PeopleDates;
  /** Extra approval subject types, inbox and reminder sources (tests, hosts). Core modules register in workflows/registry.ts. */
  workflowPlugins?: readonly WorkflowPlugin[];
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock {
  const date = typeof at === "string" ? new Date(at) : at;
  return { now: () => new Date(date.getTime()) };
}
