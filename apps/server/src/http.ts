import { existsSync } from "node:fs";
import { join } from "node:path";
import { type AppDeps, createApp } from "@crowhr/core";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";

/** Sets cache-control on successful responses produced further down the chain. */
const cacheControl = (value: string) =>
  createMiddleware(async (c, next) => {
    await next();
    if (c.res.status === 200 && !c.res.headers.has("cache-control")) c.res.headers.set("cache-control", value);
  });

/**
 * The full HTTP surface: core's `/api/*` plus the built web app.
 * Non-API GETs that match no file get index.html (SPA fallback), so
 * `/payroll` survives a reload. `/api/*` never falls back: core answers it.
 */
export function createServerApp(deps: AppDeps, options: { webDistDir: string }) {
  const { webDistDir } = options;
  // Security headers wrap everything, so they must be registered before core's routes.
  const app = new Hono<{ Bindings: { incoming?: { socket?: { remoteAddress?: string } } } }>();
  // Core reads the client IP (throttling, audit) from x-crowhr-client-ip. Never trust a value the
  // client sent; set it from the socket. NOT IMPLEMENTED: X-Forwarded-For from TRUSTED_PROXIES
  // (add-self-hosting owns proxy handling).
  app.use("*", async (c, next) => {
    const headers = c.req.raw.headers;
    headers.delete("x-crowhr-client-ip");
    const ip = c.env?.incoming?.socket?.remoteAddress;
    if (ip) headers.set("x-crowhr-client-ip", ip.replace(/^::ffff:/, ""));
    await next();
  });
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Radix positions popovers with inline styles.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );
  app.route("/", createApp(deps));

  if (!existsSync(join(webDistDir, "index.html"))) {
    deps.logger.warn("Web app build not found; serving the API only. Run `bun run build`.", { webDistDir });
    return app;
  }

  // Vite fingerprints everything under /assets; index.html must always revalidate.
  app.use("/assets/*", cacheControl("public, max-age=31536000, immutable"));
  app.use("/assets/*", serveStatic({ root: webDistDir }));
  app.use("*", cacheControl("no-cache"), serveStatic({ root: webDistDir, index: "index.html" }));
  app.get("*", serveStatic({ root: webDistDir, path: "index.html" }));
  return app;
}
