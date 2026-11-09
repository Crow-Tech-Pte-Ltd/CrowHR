/**
 * Optional error and performance monitoring with a Sentry-compatible service (GlitchTip,
 * Sentry). Off unless the operator sets SENTRY_DSN and/or SENTRY_BROWSER_DSN: without them
 * no SDK is loaded and nothing is sent anywhere.
 *
 * This module must stay free of `@crowhr/core` and SDK imports: `instrument.ts` reads it
 * before the app's modules load, so they can be instrumented.
 */

export interface MonitoringConfig {
  /** Server DSN; null = the server reports nothing. */
  dsn: string | null;
  /** Public DSN for the web app, delivered to browsers at runtime; null = browsers report nothing. */
  browserDsn: string | null;
  environment: string;
  release: string;
  /** Share of requests traced (0 to 1). Health checks and static files are never traced. */
  tracesSampleRate: number;
  /** Forward the server's structured log entries as Sentry logs. */
  logs: boolean;
}

export interface MonitoringConfigResult {
  /** Null when no DSN is set: monitoring is off and the other variables are ignored. */
  config: MonitoringConfig | null;
  problems: string[];
}

const TRUE = new Set(["true", "1", "yes"]);
const FALSE = new Set(["false", "0", "no"]);
const DSN_EXAMPLE = "https://0123456789abcdef@glitchtip.example.sg/1";

/** Rejects what Sentry and GlitchTip refuse as release or environment names. */
const UNSAFE_NAME = /[\s/\\]/;

export function readMonitoringConfig(
  env: Record<string, string | undefined>,
  options: { version: string; production: boolean },
): MonitoringConfigResult {
  const get = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const problems: string[] = [];

  const dsn = (name: string): string | null => {
    const raw = get(name);
    if (raw === undefined) return null;
    if (!isDsn(raw)) {
      // Never echo the value: a DSN lets anyone send events to the project.
      problems.push(
        `${name} is not a valid DSN. Copy it from the project's settings in GlitchTip or Sentry (Client Keys / DSN), for example ${name}=${DSN_EXAMPLE}. Leave it empty to turn monitoring off. Set it in .env.`,
      );
      return null;
    }
    return raw;
  };
  const serverDsn = dsn("SENTRY_DSN");
  const browserDsn = dsn("SENTRY_BROWSER_DSN");
  if (get("SENTRY_DSN") === undefined && get("SENTRY_BROWSER_DSN") === undefined) {
    return { config: null, problems: [] };
  }

  const environment = get("SENTRY_ENVIRONMENT") ?? (options.production ? "production" : "development");
  if (environment.length > 64 || UNSAFE_NAME.test(environment)) {
    problems.push(
      "SENTRY_ENVIRONMENT must be at most 64 characters without spaces or slashes, for example SENTRY_ENVIRONMENT=staging. Set it in .env.",
    );
  }

  const gitSha = get("CROWHR_GIT_SHA");
  if (gitSha !== undefined && !/^[0-9a-f]{7,40}$/i.test(gitSha)) {
    problems.push(
      "CROWHR_GIT_SHA must be a git commit hash (7 to 40 hex characters), for example CROWHR_GIT_SHA=$(git rev-parse HEAD) when building the image. Leave it unset if you do not build from git.",
    );
  }
  const release =
    get("SENTRY_RELEASE") ??
    `crowhr@${options.version}${gitSha && /^[0-9a-f]{7,40}$/i.test(gitSha) ? `+${gitSha.slice(0, 12).toLowerCase()}` : ""}`;
  if (release.length > 200 || UNSAFE_NAME.test(release) || release === "." || release === "..") {
    problems.push(
      "SENTRY_RELEASE must be at most 200 characters without spaces or slashes, for example SENTRY_RELEASE=crowhr@1.2.0. Usually leave it unset: it defaults to crowhr@<version>+<commit>. Set it in .env.",
    );
  }

  let tracesSampleRate = 0.2;
  const rateRaw = get("SENTRY_TRACES_SAMPLE_RATE");
  if (rateRaw !== undefined) {
    const rate = Number(rateRaw);
    if (!/^\d*\.?\d+$/.test(rateRaw) || !(rate >= 0 && rate <= 1)) {
      problems.push(
        "SENTRY_TRACES_SAMPLE_RATE must be a number from 0 to 1 (the share of requests traced), for example SENTRY_TRACES_SAMPLE_RATE=0.2, or 0 to turn tracing off. Set it in .env.",
      );
    } else {
      tracesSampleRate = rate;
    }
  }

  let logs = true;
  const logsRaw = get("SENTRY_ENABLE_LOGS")?.toLowerCase();
  if (logsRaw !== undefined) {
    if (TRUE.has(logsRaw)) logs = true;
    else if (FALSE.has(logsRaw)) logs = false;
    else
      problems.push("SENTRY_ENABLE_LOGS must be true or false, for example SENTRY_ENABLE_LOGS=true. Set it in .env.");
  }

  return {
    config: { dsn: serverDsn, browserDsn, environment, release, tracesSampleRate, logs },
    problems,
  };
}

/** `https://<public key>@<host>[/<path>]/<project id>`, as issued by Sentry and GlitchTip. */
export function isDsn(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.username !== "" &&
    url.hostname !== "" &&
    /\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) &&
    !url.search &&
    !url.hash
  );
}

/** The origin events are posted to, for the page's CSP `connect-src`. */
export function dsnOrigin(dsn: string): string {
  return new URL(dsn).origin;
}
