import { dsnOrigin, type MonitoringConfig } from "./config.ts";

/**
 * What the web app needs to report browser errors. The server writes it into index.html at
 * runtime, so one image serves every install and no DSN is ever baked into the build.
 * Read by apps/web/src/monitoring.ts.
 */
export interface BrowserMonitoring {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
}

export const MONITORING_META_NAME = "crowhr-monitoring";

export function browserMonitoringFrom(config: MonitoringConfig | null): BrowserMonitoring | null {
  if (!config?.browserDsn) return null;
  return {
    dsn: config.browserDsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
  };
}

/** Adds `<meta name="crowhr-monitoring" content="{json}">` to the page (a meta tag passes `script-src 'self'`). */
export function injectMonitoringMeta(html: string, monitoring: BrowserMonitoring): string {
  const content = JSON.stringify(monitoring).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const tag = `<meta name="${MONITORING_META_NAME}" content="${content}">`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : `${tag}${html}`;
}

/** The page CSP's `connect-src`: the app itself, plus the monitoring service when browsers report to it. */
export function connectSrc(monitoring: BrowserMonitoring | null | undefined): string {
  return monitoring ? `'self' ${dsnOrigin(monitoring.dsn)}` : "'self'";
}
