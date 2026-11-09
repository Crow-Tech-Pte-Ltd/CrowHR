/**
 * Optional browser error and performance reporting to the operator's own Sentry-compatible
 * service (GlitchTip, Sentry). The server writes the settings into index.html only when
 * SENTRY_BROWSER_DSN is set (apps/server/src/monitoring/browser.ts). Without them (default
 * installs, the public demo, Vite dev) nothing happens and the SDK is never downloaded.
 *
 * Personal data: no user info, cookies, query strings, request bodies or session replay;
 * API errors (4xx are expected, 5xx are reported by the server) are not sent.
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
    if (request.url) request.url = withoutQuery(request.url);
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => name.toLowerCase() === "user-agent"),
      );
    }
  }
  delete event.user;
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (!crumb.data) return crumb;
  const data = { ...crumb.data };
  for (const key of ["url", "from", "to"]) {
    if (typeof data[key] === "string") data[key] = withoutQuery(data[key]);
  }
  return { ...crumb, data };
}

function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}
