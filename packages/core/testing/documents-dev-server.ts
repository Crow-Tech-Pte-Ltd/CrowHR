/**
 * DEV/TEST ONLY: payroll-dev-server.ts's café group and payroll history, plus a new hire starting
 * today (persona `newhire`) and a manager, for the reports and documents e2e (WS6b) and screenshots.
 * Same rules: the real app on in-memory PGlite, persona sign-in at `/__dev/as/<persona>`, bound to
 * 127.0.0.1, never part of apps/server.
 *
 *   node packages/core/testing/documents-dev-server.ts   (PORT, default 3240; WEB_DIST)
 */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { Hono } from "hono";
import type { AssignedRole } from "../src/access/matrix.ts";
import { singaporeDate } from "../src/access/scope.ts";
import { createApp } from "../src/app.ts";
import { sessionCookie } from "../src/auth/settings.ts";
import { newToken, sha256Hex } from "../src/crypto/tokens.ts";
import { sessions } from "../src/db/schema/auth.ts";
import { addDays } from "../src/employees/dates.ts";
import { ctxFor, hire } from "../src/employees/lifecycle.ts";
import { createReportingScopeResolver } from "../src/employees/reports/reporting-scope.ts";
import { createPeopleHarness, nextNric, OWNER } from "../src/testing/people-harness.ts";
import { seedPayroll } from "../src/testing/seed-payroll.ts";
import { seedPeople } from "../src/testing/seed-people.ts";
import { seedMember } from "./fixtures.ts";
import { createTestDb, createTestDeps } from "./index.ts";

const PORT = Number(process.env.PORT ?? 3240);
const DEV_PASSWORD = "kopi-kaki-dev-only";
const WEB_DIST = resolve(process.env.WEB_DIST ?? new URL("../../../apps/web/dist", import.meta.url).pathname);

const PERSONAS: Record<string, { roles: AssignedRole[]; employee: string | null; email: string }> = {
  owner: { roles: ["owner"], employee: "owner", email: "kahhui@kopikaki.example" },
  payroll: { roles: ["hr_admin", "payroll_admin"], employee: "hr", email: "aisyah@kopikaki.example" },
  hronly: { roles: ["hr_admin"], employee: null, email: "hr-temp@kopikaki.example" },
  employee: { roles: [], employee: "barista1", email: "junjie@kopikaki.example" },
  manager: { roles: [], employee: "opsmgr", email: "rajesh@kopikaki.example" },
  newhire: { roles: [], employee: "newhire", email: "mei@kopikaki.example" },
};

async function main() {
  const t = await createTestDb();
  const publicUrl = `http://127.0.0.1:${PORT}`;
  const base = createTestDeps(t.db, { responseValidation: "strip", publicUrl, clock: { now: () => new Date() } });
  const h = await createPeopleHarness(base, { orgName: "Kopi Kaki Pte. Ltd.", slug: "kopi-kaki" });
  const seeded = await seedPeople(h.deps, h.ports, h.actor(OWNER));
  // A barista starting today: the KET has to be issued within 14 days.
  const today = singaporeDate(new Date());
  seeded.employees.newhire = (
    await hire(ctxFor(h.deps, h.ports, h.actor(OWNER)), {
      person: {
        legalName: "Lee Mei Xin",
        idType: "nric",
        idNumber: nextNric("T"),
        dob: "2005-03-14",
        gender: "female",
        residencyStatus: "citizen",
        race: "chinese",
        workEmail: "mei@kopikaki.example",
        address: { block: "21", street: "Tiong Bahru Road", unit: "#05-12", postalCode: "160021" },
      },
      job: {
        hireDate: today,
        jobTitle: "Barista",
        departmentId: seeded.departments.Operations as string,
        locationId: Object.values(seeded.locations)[0] as string,
        managerEmployeeId: seeded.employees.opsmgr ?? null,
        employmentType: "full_time",
        workScheduleId: Object.values(seeded.schedules)[0] as string,
        probationEnd: addDays(today, 90),
      },
      compensation: { payBasis: "monthly", amountCents: 240_000 },
      invite: false,
    })
  ).employeeId;
  const deps = { ...h.deps, reportingScope: createReportingScopeResolver(t.db) };
  const members = new Map<string, Awaited<ReturnType<typeof seedMember>>>();
  for (const [key, p] of Object.entries(PERSONAS)) {
    members.set(
      key,
      await seedMember(deps, h.orgId, {
        email: p.email,
        roles: p.roles,
        employeeId: p.employee ? (seeded.employees[p.employee] ?? null) : null,
        password: DEV_PASSWORD,
      }),
    );
  }
  const payroll = members.get("payroll") as Awaited<ReturnType<typeof seedMember>>;
  const owner = members.get("owner") as Awaited<ReturnType<typeof seedMember>>;
  const runs = await seedPayroll(deps, h.orgId, seeded, {
    preparer: { userId: payroll.userId, membershipId: payroll.membershipId },
    approver: { userId: owner.userId, membershipId: owner.membershipId },
  });
  const cookieName = sessionCookie(publicUrl).name;

  const app = new Hono();
  app.get("/__dev/runs", (c) => c.json(runs));
  app.get("/__dev/employees", (c) => c.json(seeded.employees));
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
    return c.redirect(c.req.query("to") ?? "/payroll");
  });
  app.route("/", createApp(deps));

  const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
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
    console.warn(`Documents dev server (DEV ONLY, persona sign-in) on ${publicUrl}`);
  });
  const stop = () => server.close(() => t.close().finally(() => process.exit(0)));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
