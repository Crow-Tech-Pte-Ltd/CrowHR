/**
 * DEV/TEST ONLY: a local server running the real app (`createApp`: sessions,
 * CSRF, permission matrix, audit) on an in-memory PGlite seeded with the
 * fictional Kopi Kaki staff, plus the built web app.
 *
 * Signing in: there is no first-run setup wizard yet (self-hosting
 * workstream), so `/__dev/as/<persona>` creates a real session for a seeded
 * member and sets the real session cookie. That endpoint exists only in this
 * file; it binds to 127.0.0.1 and is never part of apps/server.
 *
 *   node packages/core/testing/people-dev-server.ts   (PORT, default 3200; WEB_DIST)
 */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { Hono } from "hono";
import type { AssignedRole } from "../src/access/matrix.ts";
import { createApp } from "../src/app.ts";
import { sessionCookie } from "../src/auth/settings.ts";
import { newToken, sha256Hex } from "../src/crypto/tokens.ts";
import { sessions } from "../src/db/schema/auth.ts";
import { createReportingScopeResolver } from "../src/employees/reports/reporting-scope.ts";
import { createPeopleHarness, OWNER } from "../src/testing/people-harness.ts";
import { seedPeople } from "../src/testing/seed-people.ts";
import { seedMember } from "./fixtures.ts";
import { createTestDb, createTestDeps } from "./index.ts";

const PORT = Number(process.env.PORT ?? 3200);
const WEB_DIST = resolve(process.env.WEB_DIST ?? new URL("../../../apps/web/dist", import.meta.url).pathname);

const PERSONAS: Record<string, { roles: AssignedRole[]; employee: string | null; email: string }> = {
  owner: { roles: ["owner"], employee: "owner", email: "kahhui@kopikaki.example" },
  hr: { roles: ["hr_admin", "payroll_admin"], employee: "hr", email: "aisyah@kopikaki.example" },
  hronly: { roles: ["hr_admin"], employee: null, email: "hr-temp@kopikaki.example" },
  manager: { roles: [], employee: "opsmgr", email: "rajesh@kopikaki.example" },
  employee: { roles: [], employee: "barista1", email: "junjie@kopikaki.example" },
};

async function main() {
  const t = await createTestDb();
  const publicUrl = `http://127.0.0.1:${PORT}`;
  const base = createTestDeps(t.db, { responseValidation: "strip", publicUrl, clock: { now: () => new Date() } });
  const h = await createPeopleHarness(base, { orgName: "Kopi Kaki Pte. Ltd.", slug: "kopi-kaki" });
  const seeded = await seedPeople(h.deps, h.ports, h.actor(OWNER));
  const deps = { ...h.deps, reportingScope: createReportingScopeResolver(t.db) };
  const members = new Map<string, Awaited<ReturnType<typeof seedMember>>>();
  for (const [key, p] of Object.entries(PERSONAS)) {
    members.set(
      key,
      await seedMember(deps, h.orgId, {
        email: p.email,
        roles: p.roles,
        employeeId: p.employee ? (seeded.employees[p.employee] ?? null) : null,
      }),
    );
  }
  const cookieName = sessionCookie(publicUrl).name;

  const app = new Hono();
  app.get("/__dev/as/:persona", async (c) => {
    const m = members.get(c.req.param("persona"));
    if (!m) return c.text(`Unknown persona. Use one of: ${Object.keys(PERSONAS).join(", ")}`, 400);
    const token = newToken();
    const now = new Date();
    await t.db.insert(sessions).values({
      id: await sha256Hex(token),
      orgId: m.orgId,
      userId: m.userId,
      membershipId: m.membershipId,
      authMethod: "password",
      createdAt: now,
      lastSeenAt: now,
      authenticatedAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 12 * 3600_000),
      mfaSatisfied: true,
    });
    c.header("set-cookie", `${cookieName}=${token}; Path=/; SameSite=Lax; HttpOnly`);
    return c.redirect(c.req.query("to") ?? "/people");
  });
  app.route("/", createApp(deps));

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
    const response = await app.fetch(new Request(`${publicUrl}${req.url}`, { method: req.method, headers, body }));
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => {
      if (k !== "set-cookie") out[k] = v;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.warn(`People dev server (DEV ONLY, persona sign-in) on ${publicUrl}`);
  });
  const stop = () => server.close(() => t.close().finally(() => process.exit(0)));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
