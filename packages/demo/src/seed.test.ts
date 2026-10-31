import { schema } from "@crowhr/core";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiBridge } from "./bridge.ts";
import { CORE_MIGRATIONS } from "./bundled-migrations.ts";
import { createCookieJar } from "./cookie-jar.ts";
import { PERSONAS } from "./personas.ts";
import { type DemoRuntime, openDemo } from "./runtime.ts";

/**
 * The demo seed on in-memory PGlite, through the same runtime the worker uses: the company is
 * there, the history was produced by the real engines, and every persona has work waiting.
 */
const ORIGIN = "https://hr.crow.sg";
// 31 Oct 2026, 10:00 Singapore: the demo clock starts on the seed's "today".
const REAL_NOW = Date.parse("2026-10-31T02:00:00Z");

describe("demo seed", () => {
  let pglite: PGlite;
  let demo: DemoRuntime;
  const flushes: number[] = [];

  beforeAll(async () => {
    pglite = new PGlite();
    demo = await openDemo({
      pglite,
      origin: ORIGIN,
      dataVersion: "test",
      migrations: CORE_MIGRATIONS,
      realNow: () => REAL_NOW,
      flush: async () => {
        flushes.push(1);
      },
    });
  });
  afterAll(async () => {
    await demo?.stop();
    await pglite?.close();
  });

  /** A signed-in persona, through a fresh browser-like client of the demo runtime. */
  async function as(email: string) {
    const jar = createCookieJar();
    const handle = createApiBridge(demo.app, { origin: ORIGIN, jar, now: () => demo.deps.clock.now().getTime() });
    const call = async <T>(method: string, url: string, json?: unknown) => {
      const res = await handle({
        method,
        url,
        headers: json === undefined ? [] : [["content-type", "application/json"]],
        body: json === undefined ? null : (new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer),
      });
      const text = new TextDecoder().decode(res.body);
      if (res.status >= 400) throw new Error(`${method} ${url} → ${res.status} ${text}`);
      return (text ? JSON.parse(text) : null) as T;
    };
    const personas = await call<{ items: { membershipId: string; email: string }[] }>(
      "GET",
      "/api/v1/auth/demo/personas",
    );
    const me = personas.items.find((p) => p.email === email);
    if (!me) throw new Error(`No persona ${email}`);
    await call("POST", "/api/v1/auth/demo/sign-in", { membershipId: me.membershipId });
    return { get: <T>(url: string) => call<T>("GET", url) };
  }
  const persona = (key: string) => PERSONAS.find((p) => p.key === key)?.email as string;

  it("seeds on first open, and a second open finds the data (no re-seed)", async () => {
    expect(demo.timings.seeded).toBe(true);
    expect(demo.info).toMatchObject({ dataVersion: "test", orgSlug: "kopi-kaki", today: "2026-10-31" });
    const again = await openDemo({
      pglite,
      origin: ORIGIN,
      dataVersion: "test",
      migrations: CORE_MIGRATIONS,
      realNow: () => REAL_NOW,
    });
    expect(again.timings.seeded).toBe(false);
    await again.stop();
    await expect(
      openDemo({ pglite, origin: ORIGIN, dataVersion: "other", migrations: CORE_MIGRATIONS }),
    ).rejects.toThrow(/data version/);
  });

  it("is one fictional SME: ~25 people, fictional emails and valid-format IDs only", async () => {
    const employees = await demo.deps.db.select().from(schema.employees);
    expect(employees).toHaveLength(27);
    for (const e of employees) {
      expect(e.idNumberMasked).toMatch(/^[STFGM]\*{4}\d{3}[A-Z]$/);
      if (e.workEmail) expect(e.workEmail).toMatch(/@kopikaki\.example$/);
    }
    const users = await demo.deps.db.select().from(schema.users);
    for (const u of users) expect(u.email).toMatch(/@kopikaki\.example$/);
    expect(new Set(employees.map((e) => e.residencyStatus))).toEqual(new Set(["citizen", "pr", "foreigner"]));
  });

  it("has three paid months computed by the payroll engine and an October draft with warnings only", async () => {
    const chloe = await as(persona("payroll"));
    const runs = await chloe.get<{ items: { id: string; month: string; status: string }[] }>("/api/v1/payroll/runs");
    const byMonth = Object.fromEntries(runs.items.map((r) => [r.month, r]));
    expect(byMonth["2026-07"]?.status).toBe("paid");
    expect(byMonth["2026-08"]?.status).toBe("paid");
    expect(byMonth["2026-09"]?.status).toBe("paid");
    expect(byMonth["2026-10"]?.status).toBe("draft");
    const oct = await chloe.get<{ issues: { severity: string; code: string }[]; totals: unknown }>(
      `/api/v1/payroll/runs/${byMonth["2026-10"]?.id}`,
    );
    expect(oct.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(oct.issues.filter((i) => i.severity === "warning").length).toBeGreaterThanOrEqual(2);
  });

  it("leaves approvals waiting for each approving persona and requests for the employee", async () => {
    const tasks = async (key: string) =>
      (await (await as(persona(key))).get<{ items: { subjectType: string }[] }>("/api/v1/approvals/tasks")).items.map(
        (t) => t.subjectType,
      );
    expect(await tasks("owner")).toContain("claim");
    expect(await tasks("hr")).toEqual(expect.arrayContaining(["claim", "profile_change"]));
    expect(await tasks("payroll")).toContain("profile_change");
    expect((await tasks("manager")).filter((t) => t === "claim")).toHaveLength(2);
    expect(await tasks("manager")).toContain("leave");
    expect(await tasks("owner")).toContain("leave");
    const junJie = await as(persona("employee"));
    const mine = await junJie.get<{ items: { status: string }[] }>("/api/v1/claims?mine=true");
    const statuses = mine.items.map((c) => c.status);
    expect(statuses).toEqual(expect.arrayContaining(["draft", "submitted", "rejected"]));
    const notes = await junJie.get<{ items: unknown[] }>("/api/v1/notifications");
    expect(notes.items.length).toBeGreaterThan(0);
  });

  it("sent its emails to the Demo outbox", async () => {
    const outbox = await demo.outbox();
    expect(outbox.length).toBeGreaterThan(0);
    for (const m of outbox) expect(m.to).toMatch(/@kopikaki\.example$/);
  });
});
