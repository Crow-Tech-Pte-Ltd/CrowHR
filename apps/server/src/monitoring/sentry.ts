/**
 * The Sentry SDK (works with GlitchTip) for the server, loaded only when SENTRY_DSN is set.
 * Started by `instrument.ts` (`node --import`) so Hono, node-postgres and HTTP are
 * instrumented before the app loads; `main.ts` only uses the handle.
 *
 * Personal data: Crow HR holds NRIC, salaries, bank and medical details, so the SDK collects
 * no request bodies, cookies, query strings, IP addresses, user info, database parameters or
 * stack-frame variables (SDK 11 collects all of these by default), and `scrubEvent` removes
 * them again before anything is sent. Free text (error messages, breadcrumbs, span data) is
 * masked by `redactText`: a failed query's bound values, NRIC/FIN numbers, email addresses.
 */
import type { Breadcrumb, ErrorEvent, NodeOptions } from "@sentry/node";
import type { MonitoringConfig } from "./config.ts";
import { redactDeep, redactText } from "./redact.ts";

type LogLevel = "debug" | "info" | "warn" | "error";
type TransactionEvent = Parameters<NonNullable<NodeOptions["beforeSendTransaction"]>>[0];
type SamplingContext = Parameters<NonNullable<NodeOptions["tracesSampler"]>>[0];

export interface Monitoring {
  captureException(err: unknown, extra?: Record<string, unknown>): void;
  /** Tags the current request's events with its `x-request-id` (the ID users quote). */
  tagRequest(requestId: string): void;
  captureMessage(message: string, extra?: Record<string, unknown>): void;
  log(level: LogLevel, message: string, attributes: Record<string, unknown>): void;
  /** Sends what is queued; resolves false if `timeoutMs` passed first. */
  flush(timeoutMs?: number): Promise<boolean>;
}

/** Request headers worth keeping on events; everything else (cookie, authorization, forwarding) is dropped. */
const REQUEST_HEADERS = ["user-agent", "accept", "content-type", "content-length", "x-request-id"];

export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: REQUEST_HEADERS }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
} satisfies NonNullable<NodeOptions["dataCollection"]>;

/**
 * Default integrations replaced or left out. Http, Hono and OnUnhandledRejection are re-added
 * with our options; GlitchTip has no release-health sessions (ProcessSession); Console would
 * attach every log line, unfiltered, to each event as a breadcrumb (the logger bridge forwards
 * logs instead, and SENTRY_ENABLE_LOGS=false must mean no log content leaves).
 */
export const DROPPED_INTEGRATIONS = ["Http", "Hono", "ProcessSession", "Console", "OnUnhandledRejection"];

let active: Monitoring | null = null;

/** The running SDK, or null when monitoring is off. */
export function activeMonitoring(): Monitoring | null {
  return active;
}

/** Loads and starts the SDK once. No-op (null) without a server DSN. */
export async function startMonitoring(config: MonitoringConfig): Promise<Monitoring | null> {
  if (active || !config.dsn) return active;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    // SDK 11 streams spans by default; GlitchTip reads classic transactions.
    traceLifecycle: "static",
    ...(config.tracesSampleRate > 0
      ? { tracesSampler: (ctx: SamplingContext) => sampleTrace(ctx, config.tracesSampleRate) }
      : {}),
    dataCollection: DATA_COLLECTION,
    // Outgoing calls go to third parties (identity providers): never send them `sentry-trace`
    // or `baggage` headers, which carry this DSN's public key, the release and the route.
    tracePropagationTargets: [],
    integrations: (defaults) => [
      ...defaults.filter((i) => !DROPPED_INTEGRATIONS.includes(i.name)),
      Sentry.httpIntegration({ sessions: false }),
      Sentry.honoIntegration({ shouldHandleError: shouldReportError }),
      // Report, then exit like Node does without the SDK ("warn", the SDK default, would keep a
      // process running after an unhandled rejection only because monitoring is on).
      Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
    ],
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  active = {
    captureException: (err, extra) => {
      Sentry.captureException(err, extra ? { extra } : undefined);
    },
    tagRequest: (requestId) => {
      Sentry.getIsolationScope().setTag("request_id", requestId);
    },
    captureMessage: (message, extra) => {
      Sentry.captureMessage(message, { level: "error", ...(extra ? { extra } : {}) });
    },
    log: (level, message, attributes) => Sentry.logger[level](message, attributes),
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
  };
  return active;
}

/**
 * AppError is how handlers report expected failures (validation, permissions, conflicts,
 * not implemented): never an issue. Other errors with an HTTP status count from 500 up.
 */
export function shouldReportError(err: unknown): boolean {
  if (err && typeof err === "object") {
    if ((err as { name?: unknown }).name === "AppError") return false;
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status >= 500;
  }
  return true;
}

/** Traces API requests only: never health checks (every 15 s) or the web app's static files. */
export function sampleTrace(ctx: SamplingContext, rate: number): number {
  const path = requestPath(ctx);
  if (path !== null && (!path.startsWith("/api/") || path === "/api/health")) return 0;
  return ctx.inheritOrSampleWith(rate);
}

function requestPath(ctx: SamplingContext): string | null {
  const url = ctx.normalizedRequest?.url;
  if (url) {
    try {
      return new URL(url, "http://localhost").pathname;
    } catch {
      return null;
    }
  }
  const match = /^[A-Z]+ (\/\S*)$/.exec(ctx.name);
  return match?.[1] ? (match[1].split("?")[0] ?? null) : null;
}

/** Second line of defence after DATA_COLLECTION: nothing personal leaves, whatever an integration adds. */
export function scrubEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  const request = event.request;
  if (request) {
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    delete request.env;
    if (request.url) request.url = withoutQuery(request.url);
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => REQUEST_HEADERS.includes(name.toLowerCase())),
      );
    }
  }
  delete event.user;
  if (typeof event.message === "string") event.message = redactText(event.message);
  if (event.logentry) event.logentry = redactDeep(event.logentry);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value);
  }
  if (event.extra) event.extra = redactDeep(event.extra);
  const trace = event.contexts?.trace;
  if (trace?.data) trace.data = redactDeep(trace.data);
  for (const span of event.spans ?? []) {
    if (span.description) span.description = redactText(span.description);
    if (span.data) span.data = redactDeep(span.data);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const scrubbed = crumb.message ? { ...crumb, message: redactText(crumb.message) } : crumb;
  if (!crumb.data) return scrubbed;
  const data = redactDeep({ ...crumb.data });
  for (const key of ["url", "from", "to"]) {
    if (typeof data[key] === "string") data[key] = withoutQuery(data[key]);
  }
  return { ...scrubbed, data };
}

function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
