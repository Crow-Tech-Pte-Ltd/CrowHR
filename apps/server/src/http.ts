import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ApiModule, type AppDeps, createApp, VERSION } from "@crowhr/core";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import { type MaintenanceInfo, maintenanceMessage } from "./backup/maintenance.ts";
import { type BrowserMonitoring, connectSrc, injectMonitoringMeta } from "./monitoring/browser.ts";
import { type SetupGate, setupGateMiddleware } from "./setup/gate.ts";

/** Sets cache-control on successful responses produced further down the chain. */
const cacheControl = (value: string) =>
  createMiddleware(async (c, next) => {
    await next();
    if (c.res.status === 200 && !c.res.headers.has("cache-control")) c.res.headers.set("cache-control", value);
  });

export interface ServerAppOptions {
  webDistDir: string;
  /** Redirect to /setup while no organisation exists (omitted in tests that don't need it). */
  setupGate?: SetupGate;
  /** Maintenance flag (restore in progress): everything answers 503. */
  maintenance?: () => MaintenanceInfo | null;
  /** Extra API modules mounted under /api/v1 (the e2e server adds a test-only request type). */
  modules?: readonly ApiModule[];
  /** Browser error reporting (SENTRY_BROWSER_DSN): settings go into index.html, the DSN's origin into the CSP. */
  browserMonitoring?: BrowserMonitoring | null;
}

/** Minimal self-contained page for 503s (no external assets: the app may be mid-restore). */
export function plainPage(title: string, message: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>${esc(title)} · Crow HR</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#fafaf7;color:#111;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:32rem;padding:2rem;border:1px solid #1112}h1{font:600 1rem ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}

function maintenanceGuard(probe: () => MaintenanceInfo | null) {
  return createMiddleware(async (c, next) => {
    const info = probe();
    if (!info) return next();
    const message = maintenanceMessage(info);
    c.header("retry-after", "10");
    c.header("cache-control", "no-store");
    if (c.req.path === "/api/health") return c.json({ status: "maintenance", version: VERSION, message }, 503);
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: { code: "service_unavailable", message, requestId: "maintenance" } }, 503);
    }
    return c.html(plainPage("Maintenance", message), 503);
  });
}

/**
 * The full HTTP surface: core's `/api/*` plus the built web app.
 * Non-API GETs that match no file get index.html (SPA fallback), so
 * `/payroll` survives a reload. `/api/*` never falls back: core answers it.
 */
export function createServerApp(deps: AppDeps, options: ServerAppOptions) {
  const { webDistDir, browserMonitoring } = options;
  const pageCsp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src ${connectSrc(browserMonitoring)}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
  // Security headers wrap everything, so they must be registered before core's routes.
  const app = new Hono<{ Bindings: { incoming?: { socket?: { remoteAddress?: string } } } }>();
  // Core reads the client IP (throttling, audit) from x-crowhr-client-ip. Never trust a value the
  // client sent: it is always replaced with the IP resolved by `deps.resolveClient` (the socket
  // peer, or the right-most untrusted X-Forwarded-For hop when the peer is in TRUSTED_PROXIES).
  app.use("*", async (c, next) => {
    const headers = c.req.raw.headers;
    headers.delete("x-crowhr-client-ip");
    const ip = deps.resolveClient
      ? deps.resolveClient(c as unknown as Parameters<NonNullable<AppDeps["resolveClient"]>>[0]).ip
      : c.env?.incoming?.socket?.remoteAddress?.replace(/^::ffff:/, "");
    if (ip) headers.set("x-crowhr-client-ip", ip);
    await next();
  });
  app.use(
    "*",
    secureHeaders({
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );
  // secureHeaders writes after downstream handlers. Install the page CSP separately so
  // a file handler's stricter sandbox policy survives the outer middleware.
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("content-security-policy")) c.res.headers.set("content-security-policy", pageCsp);
  });
  if (options.maintenance) app.use("*", maintenanceGuard(options.maintenance));
  if (options.setupGate) app.use("*", setupGateMiddleware(options.setupGate));
  app.route("/", createApp(deps, { modules: options.modules ?? [] }));

  if (!existsSync(join(webDistDir, "index.html"))) {
    deps.logger.warn("Web app build not found; serving the API only. Run `bun run build`.", { webDistDir });
    return app;
  }

  // Vite fingerprints everything under /assets; index.html must always revalidate.
  app.use("/assets/*", cacheControl("public, max-age=31536000, immutable"));
  app.use("/assets/*", serveStatic({ root: webDistDir }));
  if (browserMonitoring) {
    // index.html carries this install's monitoring settings, so it is served from memory.
    const indexHtml = injectMonitoringMeta(readFileSync(join(webDistDir, "index.html"), "utf8"), browserMonitoring);
    const serveIndex = (c: Context) => {
      c.header("cache-control", "no-cache");
      return c.html(indexHtml);
    };
    app.get("/", serveIndex);
    app.get("/index.html", serveIndex);
    app.use("*", cacheControl("no-cache"), serveStatic({ root: webDistDir }));
    app.get("*", serveIndex);
    return app;
  }
  app.use("*", cacheControl("no-cache"), serveStatic({ root: webDistDir, index: "index.html" }));
  app.get("*", serveStatic({ root: webDistDir, path: "index.html" }));
  return app;
}

/** Served while migrations run: health says `starting`, everything else a 503 page. */
export function createStartingApp() {
  const app = new Hono();
  app.get("/api/health", (c) => {
    c.header("cache-control", "no-store");
    return c.json({ status: "starting", version: VERSION }, 503);
  });
  app.all("/api/*", (c) =>
    c.json(
      {
        error: {
          code: "service_unavailable",
          message: "Crow HR is starting. Try again in a few seconds.",
          requestId: "starting",
        },
      },
      503,
    ),
  );
  app.all("*", (c) =>
    c.html(plainPage("Starting", "Crow HR is starting (applying database updates). This page reloads by itself."), 503),
  );
  return app;
}
