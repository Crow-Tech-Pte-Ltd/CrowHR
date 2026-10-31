import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSetupCode, normaliseSetupCode, parseSecretKey, SETUP_CODE_ALPHABET } from "@crowhr/core";
import { NO_TRUSTED_PROXIES, parseTrustedProxies, type TrustedProxies } from "./proxy/trust.ts";

const defaultWebDist = fileURLToPath(new URL("../../web/dist", import.meta.url));

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ServerConfig {
  /** `production` inside the Docker image (set by the Dockerfile); `development` otherwise. */
  NODE_ENV: "production" | "development" | "test";
  /** Origin users open in the browser, without a trailing slash, e.g. `https://hr.acme.sg`. */
  PUBLIC_URL: string;
  /** Cookies get `Secure` (and the `__Host-` prefix) when PUBLIC_URL is https, even behind a TLS-terminating proxy. */
  secureCookies: boolean;
  HOST: string;
  PORT: number;
  /** Final connection string: DATABASE_URL, or built from DATABASE_HOST/... and the password file. */
  DATABASE_URL: string;
  DATA_DIR: string;
  FILE_STORAGE_DIR: string;
  /** Where the encryption key is generated when CROWHR_SECRET_KEY is not set. */
  SECRET_KEY_FILE: string;
  /** 32 bytes when CROWHR_SECRET_KEY is set; null means "use or generate SECRET_KEY_FILE". */
  CROWHR_SECRET_KEY: Uint8Array | null;
  TRUSTED_PROXIES: TrustedProxies;
  BACKUP_DIR: string;
  /** Daily scheduled backup time (24 h) in BACKUP_TIMEZONE, or null when BACKUP_TIME=off. */
  BACKUP_TIME: { hour: number; minute: number } | null;
  BACKUP_TIMEZONE: string;
  BACKUP_KEEP: number;
  BACKUP_PASSPHRASE: string | null;
  BACKUP_BEFORE_MIGRATE: boolean;
  MIGRATE_ON_START: boolean;
  DB_WAIT_SECONDS: number;
  MIGRATE_LOCK_TIMEOUT_SECONDS: number;
  WEB_DIST_DIR: string;
  /** Redirect every page to /setup while no organisation exists. Only tests turn this off. */
  SETUP_GATE: boolean;
  /** Fixed first-run setup code for automated installs; null = a random code on every start. */
  SETUP_CODE: string | null;
  LOG_LEVEL: LogLevel;
}

export class ConfigError extends Error {
  override name = "ConfigError";
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      [
        `Crow HR cannot start: ${problems.length === 1 ? "1 setting needs" : `${problems.length} settings need`} fixing.`,
        ...problems.map((p) => `  - ${p}`),
        "Edit .env (copy .env.example if you have none), then run: docker compose up -d",
        "Every variable is documented in .env.example and https://hr.crow.sg/docs/self-hosting/configuration/.",
      ].join("\n"),
    );
    this.problems = problems;
  }
}

export interface LoadConfigOptions {
  /** Reads DATABASE_PASSWORD_FILE. Injected for tests. */
  readFile?: (path: string) => string;
}

const TRUE = new Set(["true", "1", "yes"]);
const FALSE = new Set(["false", "0", "no"]);

/**
 * Validates the environment and reports every problem at once. Each message names the
 * variable, says what is wrong, gives a valid example and where to set it (spec
 * "Startup configuration errors"). Empty strings count as unset.
 */
export function loadConfig(env: Record<string, string | undefined>, options: LoadConfigOptions = {}): ServerConfig {
  const readFile = options.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const get = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const problems: string[] = [];
  const fail = (message: string) => {
    problems.push(message);
  };

  const nodeEnvRaw = get("NODE_ENV") ?? "development";
  const NODE_ENV = nodeEnvRaw === "production" || nodeEnvRaw === "test" ? nodeEnvRaw : "development";
  const production = NODE_ENV === "production";

  const bool = (name: string, fallback: boolean): boolean => {
    const v = get(name);
    if (v === undefined) return fallback;
    if (TRUE.has(v.toLowerCase())) return true;
    if (FALSE.has(v.toLowerCase())) return false;
    fail(`${name} must be true or false, for example ${name}=${fallback}. Set it in .env.`);
    return fallback;
  };
  const int = (name: string, fallback: number, min: number, max: number, hint = ""): number => {
    const v = get(name);
    if (v === undefined) return fallback;
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
      fail(
        `${name} must be a whole number from ${min} to ${max}, for example ${name}=${fallback}.${hint} Set it in .env.`,
      );
      return fallback;
    }
    return Number(v);
  };

  // --- HTTP ---------------------------------------------------------------------------
  const PORT = int("PORT", 8080, 1, 65535);
  const HOST = get("HOST") ?? (production ? "0.0.0.0" : "127.0.0.1");

  let PUBLIC_URL = `http://localhost:${PORT}`;
  const publicRaw = get("PUBLIC_URL");
  if (publicRaw === undefined) {
    if (production) {
      fail(
        "PUBLIC_URL is not set. Set it to the address people type in the browser, for example PUBLIC_URL=https://hr.acme.sg or PUBLIC_URL=http://192.168.1.20:8080. Set it in .env.",
      );
    }
  } else if (!/^https?:\/\//i.test(publicRaw)) {
    fail(
      `PUBLIC_URL must start with http:// or https://, for example PUBLIC_URL=https://${publicRaw.replace(/^\/*/, "") || "hr.acme.sg"}. Set it in .env.`,
    );
  } else {
    let url: URL | null = null;
    try {
      url = new URL(publicRaw);
    } catch {
      fail(`PUBLIC_URL "${publicRaw}" is not a valid URL, for example PUBLIC_URL=https://hr.acme.sg. Set it in .env.`);
    }
    if (url) {
      if (url.pathname !== "/" || url.search || url.hash) {
        fail(
          `PUBLIC_URL must not contain a path, query or #fragment (got "${publicRaw}"). Crow HR must be served from the root of its own (sub)domain, for example PUBLIC_URL=${url.origin}. Set it in .env.`,
        );
      } else if (url.username || url.password) {
        fail(
          `PUBLIC_URL must not contain a user name or password, for example PUBLIC_URL=${url.origin}. Set it in .env.`,
        );
      } else {
        PUBLIC_URL = url.origin;
      }
    }
  }
  const secureCookies = PUBLIC_URL.startsWith("https://");

  const trusted = parseTrustedProxies(get("TRUSTED_PROXIES"));
  let TRUSTED_PROXIES = NO_TRUSTED_PROXIES;
  if (trusted.ok) {
    TRUSTED_PROXIES = trusted.value;
  } else {
    fail(
      `TRUSTED_PROXIES has ${trusted.invalid.length === 1 ? "an entry that is" : "entries that are"} not an IP address or CIDR range: ${trusted.invalid.join(", ")}. Use a comma-separated list such as TRUSTED_PROXIES=172.16.0.0/12,10.0.0.5 (or the shorthands private, loopback). Leave it empty when no reverse proxy is used. Set it in .env.`,
    );
  }

  // --- Database -----------------------------------------------------------------------
  let DATABASE_URL = get("DATABASE_URL");
  if (DATABASE_URL !== undefined) {
    if (!/^postgres(ql)?:\/\//.test(DATABASE_URL) && !/^pglite:/.test(DATABASE_URL)) {
      fail(
        "DATABASE_URL must be a PostgreSQL URL, for example DATABASE_URL=postgres://crowhr:password@db:5432/crowhr (or pglite:memory / pglite:<directory> for local development). With docker compose leave it unset. Set it in .env.",
      );
    }
  } else if (get("DATABASE_HOST") !== undefined) {
    const host = get("DATABASE_HOST") as string;
    const port = int("DATABASE_PORT", 5432, 1, 65535);
    const user = get("DATABASE_USER") ?? "crowhr";
    const name = get("DATABASE_NAME") ?? "crowhr";
    let password = get("DATABASE_PASSWORD");
    const passwordFile = get("DATABASE_PASSWORD_FILE");
    if (password === undefined && passwordFile !== undefined) {
      try {
        password = readFile(passwordFile).trim();
        if (!password)
          fail(
            `DATABASE_PASSWORD_FILE (${passwordFile}) is empty. Run docker compose up -d so the init service writes it.`,
          );
      } catch {
        fail(
          `DATABASE_PASSWORD_FILE points to ${passwordFile}, which cannot be read. The init service creates it on first start: run docker compose up -d (all services, not only app).`,
        );
      }
    }
    if (password === undefined && !problems.length) {
      fail(
        "DATABASE_PASSWORD (or DATABASE_PASSWORD_FILE) is required with DATABASE_HOST, for example DATABASE_PASSWORD=change-me. Set it in .env.",
      );
    }
    DATABASE_URL = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password ?? "")}@${host}:${port}/${encodeURIComponent(name)}`;
  } else if (production) {
    fail(
      "DATABASE_URL is not set. With docker compose this is set for you; otherwise use DATABASE_URL=postgres://crowhr:password@localhost:5432/crowhr. Set it in .env.",
    );
  } else {
    DATABASE_URL = "pglite:./data/pglite";
  }

  // --- Data, secrets ------------------------------------------------------------------
  const DATA_DIR = absolute(get("DATA_DIR") ?? "./data");
  const FILE_STORAGE_DIR = absolute(get("FILE_STORAGE_DIR") ?? join(DATA_DIR, "files"));
  const SECRET_KEY_FILE = absolute(get("SECRET_KEY_FILE") ?? join(DATA_DIR, "secrets", "crowhr.key"));
  let CROWHR_SECRET_KEY: Uint8Array | null = null;
  const keyRaw = get("CROWHR_SECRET_KEY");
  if (keyRaw !== undefined) {
    CROWHR_SECRET_KEY = decodeSecretKey(keyRaw);
    if (!CROWHR_SECRET_KEY) {
      fail(
        "CROWHR_SECRET_KEY must be 32 random bytes written as 64 hex characters or 44 base64 characters. Generate one with: openssl rand -base64 32. Or leave it unset and Crow HR generates one in the data volume on first start. Set it in .env.",
      );
    }
  }

  // --- Backups ------------------------------------------------------------------------
  const BACKUP_DIR = absolute(get("BACKUP_DIR") ?? (production ? "/backups" : join(DATA_DIR, "backups")));
  let BACKUP_TIME: ServerConfig["BACKUP_TIME"] = { hour: 2, minute: 0 };
  const backupTimeRaw = get("BACKUP_TIME");
  if (backupTimeRaw !== undefined) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(backupTimeRaw);
    if (backupTimeRaw.toLowerCase() === "off") BACKUP_TIME = null;
    else if (m) BACKUP_TIME = { hour: Number(m[1]), minute: Number(m[2]) };
    else
      fail(
        `BACKUP_TIME must be a 24-hour time like BACKUP_TIME=02:00, or BACKUP_TIME=off to turn scheduled backups off. Set it in .env.`,
      );
  }
  const BACKUP_TIMEZONE = get("BACKUP_TIMEZONE") ?? "Asia/Singapore";
  try {
    new Intl.DateTimeFormat("en-SG", { timeZone: BACKUP_TIMEZONE });
  } catch {
    fail(
      `BACKUP_TIMEZONE "${BACKUP_TIMEZONE}" is not a known time zone, for example BACKUP_TIMEZONE=Asia/Singapore. Set it in .env.`,
    );
  }
  const BACKUP_KEEP = int("BACKUP_KEEP", 14, 1, 3650, " Older scheduled backups are deleted.");
  const BACKUP_PASSPHRASE = get("BACKUP_PASSPHRASE") ?? null;
  if (BACKUP_PASSPHRASE !== null && BACKUP_PASSPHRASE.length < 12) {
    fail(
      "BACKUP_PASSPHRASE must be at least 12 characters, for example several random words. Store it somewhere safe outside this server. Set it in .env.",
    );
  }

  let SETUP_CODE: string | null = null;
  const setupCodeRaw = get("SETUP_CODE");
  if (setupCodeRaw !== undefined) {
    const clean = normaliseSetupCode(setupCodeRaw);
    if (clean.length !== 16 || [...clean].some((ch) => !SETUP_CODE_ALPHABET.includes(ch))) {
      fail(
        `SETUP_CODE must be 16 characters from ${SETUP_CODE_ALPHABET} (no look-alikes such as 0/O or 1/I), for example SETUP_CODE=ACDE-FGHJ-KMNP-QRTU. Usually leave it unset: a random code is printed in the log. Set it in .env.`,
      );
    } else {
      SETUP_CODE = formatSetupCode(clean);
    }
  }

  const logLevel = (get("LOG_LEVEL") ?? "info").toLowerCase();
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    fail("LOG_LEVEL must be debug, info, warn or error, for example LOG_LEVEL=info. Set it in .env.");
  }

  const config: ServerConfig = {
    NODE_ENV,
    PUBLIC_URL,
    secureCookies,
    HOST,
    PORT,
    DATABASE_URL: DATABASE_URL ?? "",
    DATA_DIR,
    FILE_STORAGE_DIR,
    SECRET_KEY_FILE,
    CROWHR_SECRET_KEY,
    TRUSTED_PROXIES,
    BACKUP_DIR,
    BACKUP_TIME,
    BACKUP_TIMEZONE,
    BACKUP_KEEP,
    BACKUP_PASSPHRASE,
    BACKUP_BEFORE_MIGRATE: bool("BACKUP_BEFORE_MIGRATE", true),
    MIGRATE_ON_START: bool("MIGRATE_ON_START", true),
    DB_WAIT_SECONDS: int("DB_WAIT_SECONDS", 60, 0, 3600),
    MIGRATE_LOCK_TIMEOUT_SECONDS: int("MIGRATE_LOCK_TIMEOUT_SECONDS", 300, 1, 3600),
    WEB_DIST_DIR: absolute(get("WEB_DIST_DIR") ?? defaultWebDist),
    SETUP_GATE: bool("SETUP_GATE", true),
    SETUP_CODE,
    LOG_LEVEL: logLevel as LogLevel,
  };
  if (problems.length) throw new ConfigError(problems);
  return config;
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(path);
}

/** 32 bytes from 64 hex chars or (url-safe) base64, as core's `parseSecretKey`. Null otherwise. */
export function decodeSecretKey(raw: string): Uint8Array | null {
  try {
    return parseSecretKey(raw);
  } catch {
    return null;
  }
}
