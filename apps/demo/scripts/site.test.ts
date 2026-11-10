import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkModuleIds } from "./forbidden-modules.ts";
import { cleanUrlRedirect, headersFor, matchRedirect, parseHeaders, parseRedirects } from "./pages-rules.ts";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const headers = parseHeaders(read("../public/_headers"));
const redirects = parseRedirects(read("../public/_redirects"));

describe("Cloudflare Pages rules", () => {
  it("rewrite every client-side route of apps/web to the app shell, and nothing under /docs or /assets", () => {
    const tree = read("../../web/src/routeTree.gen.ts");
    const block = /interface FileRoutesByFullPath \{([\s\S]*?)\}/.exec(tree)?.[1] ?? "";
    const paths = [...block.matchAll(/'([^']+)':/g)].map((m) => m[1] as string).filter((p) => p !== "/");
    expect(paths.length).toBeGreaterThan(20);
    for (const p of [...paths, "/about-demo"]) {
      const sample = p.replace(/\$\w+/g, "x").replace(/\/$/, "");
      expect(matchRedirect(redirects, sample), `${p} needs a line in apps/demo/public/_redirects`).toEqual({
        to: "/",
        status: 200,
      });
    }
    for (const p of ["/docs/", "/docs/getting-started/", "/assets/main-abc.js", "/demo-sw.js", "/api/v1/me"]) {
      expect(matchRedirect(redirects, p)).toBeNull();
    }
    expect(matchRedirect(redirects, "/docs")).toEqual({ to: "/docs/", status: 301 });
  });

  it("never rewrite to an .html path: Pages would answer it with a 308 to the clean URL and lose the deep link", () => {
    for (const r of redirects) if (r.status === 200) expect(cleanUrlRedirect(r.to), `${r.from} -> ${r.to}`).toBeNull();
    expect(cleanUrlRedirect("/index.html")).toBe("/");
    expect(cleanUrlRedirect("/docs/quick-start/index.html")).toBe("/docs/quick-start/");
    expect(cleanUrlRedirect("/about.html")).toBe("/about");
    expect(cleanUrlRedirect("/payroll")).toBeNull();
    expect(cleanUrlRedirect("/404.html")).toBeNull();
  });

  it("send a strict CSP with only this origin, WebAssembly and workers allowed", () => {
    const app = headersFor(headers, "/payroll");
    const csp = app.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/ 'unsafe-eval'|https?:\/\/|\*\./);
    expect(csp.split(";").find((d) => d.trim().startsWith("script-src"))).not.toContain("unsafe-inline");
    expect(app.get("referrer-policy")).toBe("no-referrer");
    expect(headersFor(headers, "/assets/x.js").get("cache-control")).toContain("immutable");
    expect(headersFor(headers, "/demo-sw.js").get("cache-control")).toBe("no-cache");
  });

  it("give /docs its own policy instead of combining two (Pages joins repeated headers)", () => {
    const docs = headersFor(headers, "/docs/guide/");
    const csp = docs.get("content-security-policy") ?? "";
    expect(csp).not.toContain(", ");
    expect(csp).not.toMatch(/https?:\/\//);
    expect(docs.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("bundle guard", () => {
  it("flags server-only packages and Node built-ins outside PGlite", () => {
    const ok = checkModuleIds(
      [
        "/repo/packages/core/src/app.ts",
        "node:module",
        "/repo/node_modules/.bun/hono@4/node_modules/hono/dist/index.js",
      ],
      (id) =>
        id === "node:module"
          ? ["/repo/node_modules/.bun/@electric-sql+pglite@0.5/node_modules/@electric-sql/pglite/dist/x.js"]
          : [],
    );
    expect(ok).toEqual([]);
    const bad = checkModuleIds(
      [
        "/repo/node_modules/.bun/@node-rs+argon2@2/node_modules/@node-rs/argon2/index.js",
        "/repo/node_modules/.bun/pg@8/node_modules/pg/lib/index.js",
        "/repo/apps/server/src/main.ts",
        "/repo/packages/core/testing/index.ts",
        "/repo/node_modules/.bun/@sentry+react@11.11.0/node_modules/@sentry/react/build/esm/index.js",
        "node:fs",
      ],
      (id) => (id === "node:fs" ? ["/repo/packages/demo/src/oops.ts"] : []),
    );
    expect(bad).toHaveLength(6);
  });
});
