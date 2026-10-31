/**
 * DEV/TEST ONLY: a local server with the people modules, an in-memory PGlite
 * seeded with the fictional Kopi Kaki staff, and the built web app.
 *
 * NOT IMPLEMENTED (real sign-in): the identity workstream has not landed
 * sessions yet, so this server picks a persona from the `crowhr_dev_persona`
 * cookie (set by visiting `/__dev/as/<persona>`). It binds to 127.0.0.1 only
 * and is never used by apps/server. Used for Playwright e2e and screenshots
 * until real sign-in exists; then the e2e specs move to the real server.
 *
 *   node packages/core/testing/people-dev-server.ts   (PORT, default 3200; WEB_DIST)
 */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { Hono } from "hono";
import { V1_MODULES } from "../src/app.ts";
import type { AppEnv, AuthContext } from "../src/context.ts";
import { createReportingScopeResolver } from "../src/employees/reports/reporting-scope.ts";
import { handleError } from "../src/errors.ts";
import { requestContext } from "../src/http/request-context.ts";
import { buildModuleRouter } from "../src/http/route.ts";
import { healthRoutes } from "../src/modules/health/routes.ts";
import { createPeopleHarness, OWNER } from "../src/testing/people-harness.ts";
import { seedPeople } from "../src/testing/seed-people.ts";
import { createTestDb, createTestDeps } from "./index.ts";

const PORT = Number(process.env.PORT ?? 3200);
const WEB_DIST = resolve(process.env.WEB_DIST ?? new URL("../../../apps/web/dist", import.meta.url).pathname);

const PERSONAS: Record<string, { roles: AuthContext["roles"]; employee: string | null; name: string }> = {
  owner: { roles: ["owner"], employee: null, name: "Owner (no employee record)" },
  hr: { roles: ["hr_admin", "payroll_admin"], employee: "hr", name: "Nur Aisyah (HR + payroll)" },
  hronly: { roles: ["hr_admin"], employee: null, name: "HR admin only" },
  manager: { roles: [], employee: "opsmgr", name: "Rajesh (manager)" },
  employee: { roles: [], employee: "barista1", name: "Goh Jun Jie (employee)" },
};

async function main() {
  const t = await createTestDb();
  const base = createTestDeps(t.db, { responseValidation: "strip" });
  const h = await createPeopleHarness(base, { orgName: "Kopi Kaki Pte. Ltd." });
  const seeded = await seedPeople(h.deps, h.ports, h.actor(OWNER));
  const deps = { ...h.deps, clock: { now: () => new Date() }, reportingScope: createReportingScopeResolver(t.db) };

  const app = new Hono<AppEnv>();
  app.use("*", requestContext(deps));
  app.get("/__dev/as/:persona", (c) => {
    const p = c.req.param("persona");
    if (!PERSONAS[p]) return c.text(`Unknown persona. Use one of: ${Object.keys(PERSONAS).join(", ")}`, 400);
    c.header("set-cookie", `crowhr_dev_persona=${p}; Path=/; SameSite=Lax; HttpOnly`);
    return c.redirect(c.req.query("to") ?? "/people");
  });
  app.use("/api/*", async (c, next) => {
    const cookie = c.req.header("cookie") ?? "";
    const key = /crowhr_dev_persona=([a-z]+)/.exec(cookie)?.[1] ?? "owner";
    const p = PERSONAS[key] ?? PERSONAS.owner;
    if (p) {
      c.set("auth", {
        user: {
          id: `00000000-0000-7000-8000-00000000000${Object.keys(PERSONAS).indexOf(key)}`,
          email: `${key}@kopikaki.example`,
          displayName: p.name,
        },
        orgId: h.orgId,
        membershipId: "00000000-0000-7000-8000-0000000000aa",
        membershipStatus: "active",
        employeeId: p.employee ? (seeded.employees[p.employee] ?? null) : null,
        roles: p.roles,
        authMethod: "password",
        identity: null,
        session: { id: "dev", kind: "browser", authenticatedAt: new Date(), mfaSatisfied: true },
      });
    }
    await next();
  });
  app.onError(handleError);
  app.route("/api/health", healthRoutes);
  app.route("/api/v1", buildModuleRouter(V1_MODULES));
  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "No API endpoint here." } }, 404));

  const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".map": "application/json",
  };
  app.get("*", async (c) => {
    const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(WEB_DIST, rel);
    if (!file.startsWith(WEB_DIST) || !(await stat(file).catch(() => null))?.isFile())
      file = join(WEB_DIST, "index.html");
    const data = await readFile(file).catch(() => null);
    if (!data) return c.text("Build the web app first: bun run --cwd apps/web build", 500);
    return c.body(data, 200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  });

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks);
    const response = await app.fetch(
      new Request(`http://127.0.0.1:${PORT}${req.url}`, { method: req.method, headers, body }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.warn(`People dev server (DEV ONLY, fake personas) on http://127.0.0.1:${PORT}`);
  });
  const stop = () => server.close(() => t.close().finally(() => process.exit(0)));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
