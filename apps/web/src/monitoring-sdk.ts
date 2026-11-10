/**
 * The Sentry SDK calls, in their own chunk: loaded by `monitoring.ts` only when the server
 * enabled browser reporting. Named imports keep tree-shaking working (no replay or feedback).
 */
import { captureException, init, reactErrorHandler, tanstackRouterBrowserTracingIntegration } from "@sentry/react";
import { type BrowserMonitoringConfig, isExpectedError, scrubBreadcrumb, scrubEvent } from "./monitoring.ts";

export { captureException, reactErrorHandler };

export function initSdk(config: BrowserMonitoringConfig, router: unknown): void {
  const tracing = config.tracesSampleRate > 0;
  init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    // Classic transactions (the 10.x default, stated so an upgrade cannot switch to span streaming,
    // which GlitchTip does not read).
    traceLifecycle: "static",
    ...(tracing ? { tracesSampleRate: config.tracesSampleRate } : {}),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    integrations: (defaults) => [
      // GlitchTip has no release-health sessions.
      ...defaults.filter((i) => i.name !== "BrowserSession"),
      // No INP spans: they are named after the element clicked, whose label can name a person.
      ...(tracing ? [tanstackRouterBrowserTracingIntegration(router, { enableInp: false })] : []),
    ],
    beforeSend: (event, hint) => (isExpectedError(hint.originalException) ? null : scrubEvent(event)),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}
