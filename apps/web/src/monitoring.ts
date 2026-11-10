/**
 * Optional browser error and performance reporting to the operator's own Sentry-compatible
 * service (GlitchTip, Sentry). The server writes the settings into index.html only when
 * SENTRY_BROWSER_DSN is set (apps/server/src/monitoring/browser.ts). Without them (default
 * installs, the public demo, Vite dev) nothing happens and the SDK is never downloaded.
 *
 * Personal data: no user info, cookies, query strings, request bodies or session replay;
 * API errors (4xx are expected, 5xx are reported by the server) are not sent. Invitation and
 * password-reset links carry their token in the path (`/invite/$token`, `/reset/$token`): it is
 * replaced everywhere it appears (URLs, span names and attributes, breadcrumbs). Element labels
 * in click breadcrumbs and web-vitals attributes (they can name a person) are masked, and console
 * output is not attached.
 */
import type { ErrorInfo } from "react";
import type { RootOptions } from "react-dom/client";
import { ApiError } from "./lib/api.ts";

export interface BrowserMonitoringConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
}

type Sdk = typeof import("./monitoring-sdk.ts");
type SdkOptions = NonNullable<Parameters<typeof import("@sentry/react")["init"]>[0]>;
type ErrorEvent = Parameters<NonNullable<SdkOptions["beforeSend"]>>[0];
type TransactionEvent = Parameters<NonNullable<SdkOptions["beforeSendTransaction"]>>[0];
type Breadcrumb = Parameters<NonNullable<SdkOptions["beforeBreadcrumb"]>>[0];

export const MONITORING_META_NAME = "crowhr-monitoring";

let sdk: Sdk | null = null;

/** The settings the server put in the page, or null (monitoring off). */
export function readMonitoringConfig(doc: Pick<Document, "querySelector"> = document): BrowserMonitoringConfig | null {
  const raw = doc.querySelector(`meta[name="${MONITORING_META_NAME}"]`)?.getAttribute("content");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BrowserMonitoringConfig>;
    if (typeof value.dsn !== "string" || value.dsn === "") return null;
    const rate = value.tracesSampleRate;
    return {
      dsn: value.dsn,
      environment: typeof value.environment === "string" ? value.environment : "production",
      release: typeof value.release === "string" ? value.release : "crowhr",
      tracesSampleRate: typeof rate === "number" && rate >= 0 && rate <= 1 ? rate : 0,
    };
  } catch {
    return null;
  }
}

/** Downloads and starts the SDK. Never throws: the app works the same without monitoring. */
export async function startMonitoring(config: BrowserMonitoringConfig, router: unknown): Promise<void> {
  try {
    const loaded = await import("./monitoring-sdk.ts");
    loaded.initSdk(config, router);
    sdk = loaded;
  } catch {
    sdk = null;
  }
}

/** Reports an error the UI caught and showed (route error screens). No-op when monitoring is off. */
export function reportError(error: unknown): void {
  if (sdk && !isExpectedError(error)) sdk.captureException(error);
}

/** React root error hooks: report, then log to the console as React does by default. */
export function rootErrorOptions(): RootOptions {
  const Sentry = sdk;
  if (!Sentry) return {};
  const log = (error: unknown, info: ErrorInfo) => console.error(error, info.componentStack ?? "");
  return {
    onUncaughtError: Sentry.reactErrorHandler(log),
    onCaughtError: Sentry.reactErrorHandler(log),
    onRecoverableError: Sentry.reactErrorHandler(log),
  };
}

/** API errors are answers from the server (and 5xx are reported there), not browser bugs. */
export function isExpectedError(error: unknown): boolean {
  return error instanceof ApiError;
}

export function scrubEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  const request = event.request;
  if (request) {
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    if (request.url) request.url = withoutQuery(redactText(request.url));
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => name.toLowerCase() === "user-agent"),
      );
    }
  }
  delete event.user;
  if (event.transaction) event.transaction = redactText(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value);
  }
  const trace = event.contexts?.trace;
  if (trace?.data) trace.data = scrubData(trace.data);
  for (const span of event.spans ?? []) {
    if (span.description) {
      const description = redactText(span.description);
      span.description = /^(http|resource)/.test(span.op ?? "") ? withoutQuery(description) : description;
    }
    if (span.data) span.data = scrubData(span.data);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  return event;
}

/** Null drops the breadcrumb: console output (it can echo API messages that name people). */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === "console") return null;
  const scrubbed = crumb.message ? { ...crumb, message: redactText(crumb.message) } : crumb;
  if (!crumb.data) return scrubbed;
  const data = scrubData(crumb.data);
  for (const key of ["url", "from", "to"]) {
    if (typeof data[key] === "string") data[key] = withoutQuery(data[key]);
  }
  return { ...scrubbed, data };
}

/**
 * Invitation and password-reset tokens in paths (not the route template `/invite/$token`);
 * element labels and titles in CSS selectors.
 */
const TOKEN_PATH = /\/(invite|reset)\/[^/?#\s"'$][^/?#\s"']*/g;
const LABELLED_SELECTOR = /\[(aria-label|title|alt|name)="[^"]*"\]/g;

export function redactText(text: string): string {
  return text.replace(TOKEN_PATH, "/$1/[token]").replace(LABELLED_SELECTOR, '[$1="[redacted]"]');
}

const QUERY_KEYS = new Set(["url.query", "http.query", "url.fragment", "http.fragment"]);
const URL_KEYS = new Set(["url", "url.full", "http.url", "http.target", "url.path"]);

/**
 * Span/breadcrumb data: route params named `token` and query/fragment attributes are dropped,
 * URLs lose their query string, every string is redacted.
 */
function scrubData<D extends Record<string, unknown>>(data: D): D {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (/(^|\.)token$/.test(key) || QUERY_KEYS.has(key)) continue;
    if (URL_KEYS.has(key) && typeof value === "string") {
      out[key] = withoutQuery(redactText(value));
      continue;
    }
    out[key] =
      typeof value === "string"
        ? redactText(value)
        : Array.isArray(value)
          ? value.map((v) => (typeof v === "string" ? redactText(v) : v))
          : value;
  }
  return out as D;
}

function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
