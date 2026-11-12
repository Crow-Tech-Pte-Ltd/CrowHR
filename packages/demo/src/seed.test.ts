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
// Any real time: the demo clock always opens on Saturday 31 Oct 2026 at 11:30 in Singapore.
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
    return {
      get: <T>(url: string) => call<T>("GET", url),
      post: <T>(url: string, body: unknown = {}) => call<T>("POST", url, body),
    };
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

  it("gives everyone a preferred name and classifies outlet managers", async () => {
    const employees = await demo.deps.db.select().from(schema.employees);
    expect(employees.every((e) => !!e.preferredName?.trim())).toBe(true);
    expect(employees.find((e) => e.legalName === "Goh Jun Jie")?.preferredName).toBe("Jun Jie");
    const jobs = await demo.deps.db.select().from(schema.employmentRecords);
    for (const name of ["Tan Wei Ming", "Siti Nurhaliza binte Osman", "Lau Mei Xuan"]) {
      const employee = employees.find((e) => e.legalName === name);
      expect(jobs.filter((j) => j.employeeId === employee?.id).at(-1)?.isManagerOrExecutive).toBe(true);
    }
  });

  it("publishes current and next week at all three outlets, and leaves a usable swap for Siti", async () => {
    const rows = await demo.deps.db.select().from(schema.rosters);
    const locations = await demo.deps.db.select().from(schema.locations);
    for (const week of ["2026-10-26", "2026-11-02"]) {
      for (const name of ["Tanjong Pagar outlet", "Jurong Point outlet", "Tiong Bahru outlet"]) {
        expect(
          rows.find((r) => r.weekStart === week && r.locationId === locations.find((l) => l.name === name)?.id)
            ?.publishedAt,
        ).toBeTruthy();
      }
    }
    const templates = await demo.deps.db.select().from(schema.shiftTemplates);
    expect(templates.map((t) => t.code)).toEqual(expect.arrayContaining(["OPN", "AM", "MID", "PM"]));
    const manager = await as(persona("manager"));
    const tasks = await manager.get<{ items: { taskId: string; subjectType: string }[] }>("/api/v1/approvals/tasks");
    const swap = tasks.items.find((t) => t.subjectType === "shift_swap");
    expect(swap).toBeDefined();
    await manager.post(`/api/v1/approvals/tasks/${swap?.taskId}/decision`, { decision: "approve" });
    const swaps = await demo.deps.db.select().from(schema.shiftSwaps);
    expect(swaps.some((s) => s.status === "approved")).toBe(true);
  });

  it("feeds approved clocked overtime into October payroll without manual overrides", async () => {
    const punches = await demo.deps.db.select().from(schema.attendancePunches);
    expect(punches.length).toBeGreaterThan(100);
    const shifts = await demo.deps.db.select().from(schema.publishedShifts);
    expect(
      punches.every((p) =>
        shifts.some((s) => s.employeeId === p.employeeId && s.date === p.workDate && s.kind === "shift"),
      ),
    ).toBe(true);
    expect(
      punches.some(
        (p) =>
          p.kind === "in" &&
          shifts.some(
            (s) => s.employeeId === p.employeeId && s.date === p.workDate && s.startsAt && p.recordedAt > s.startsAt,
          ),
      ),
    ).toBe(true);
    const approved = (await demo.deps.db.select().from(schema.overtimeClaims)).filter((c) => c.status === "approved");
    expect(approved.length).toBeGreaterThan(0);
    const payroll = await as(persona("payroll"));
    const runs = await payroll.get<{ items: { id: string; month: string }[] }>("/api/v1/payroll/runs");
    const run = runs.items.find((r) => r.month === "2026-10");
    const employee = (await demo.deps.db.select().from(schema.employees)).find((e) => e.legalName === "Goh Jun Jie");
    const detail = await payroll.get<{
      input: { items: { kind: string; source: string; minutes: number }[] };
      result: { lines: { code: string; amountCents: number }[] };
    }>(`/api/v1/payroll/runs/${run?.id}/employees/${employee?.id}`);
    const ot = detail.input.items.filter((i) => i.kind === "overtime");
    expect(ot.length).toBeGreaterThan(0);
    expect(ot.every((i) => i.source === "attendance")).toBe(true);
    expect(ot.reduce((sum, i) => sum + i.minutes, 0)).toBe(
      approved.filter((c) => c.employeeId === employee?.id).reduce((sum, c) => sum + (c.approvedMinutes ?? 0), 0),
    );
    expect(detail.result.lines.some((l) => l.code.startsWith("OT_") && l.amountCents > 0)).toBe(true);
  });

  it("has generated KETs, an employee acknowledgement, expiring work pass and populated reports", async () => {
    const docs = await demo.deps.db.select().from(schema.documentVersions);
    expect(docs.filter((d) => d.source === "generated").length).toBeGreaterThanOrEqual(3);
    const employee = await as(persona("employee"));
    const home = await employee.get<{ items: { kind: string }[] }>("/api/v1/inbox");
    expect(home.items.some((i) => i.kind === "acknowledgement")).toBe(true);
    const hr = await as(persona("hr"));
    const expiring = await hr.get<{ items: { title: string }[] }>("/api/v1/documents?expiry=expiring");
    expect(expiring.items.some((d) => /work pass/i.test(d.title))).toBe(true);
    for (const p of PERSONAS) {
      const home = await (await as(p.email)).get<{ items: unknown[] }>("/api/v1/inbox");
      expect(home.items.length).toBeGreaterThan(0);
    }
    const report = await (await as(persona("payroll"))).get<{ rows: unknown[] }>(
      "/api/v1/reports/payroll.cost?from=2026-07&to=2026-09",
    );
    expect(report.rows.length).toBeGreaterThan(0);
  });

  it("opens on a working Saturday: late morning, with the outlets' morning crews clocked in", async () => {
    expect(new Date(demo.deps.clock.now().getTime() + 8 * 3600_000).toISOString().slice(0, 16)).toBe(
      "2026-10-31T11:30",
    );
    const owner = await as(persona("owner"));
    const team = await owner.get<{
      items: { employee: { name: string }; days: { firstIn: string | null; lateMinutes: number }[] }[];
    }>("/api/v1/attendance/team?from=2026-10-31&to=2026-10-31");
    const inNow = team.items.filter((s) => s.days[0]?.firstIn);
    expect(inNow).toHaveLength(4);
    expect(inNow.filter((s) => (s.days[0]?.lateMinutes ?? 0) > 0).map((s) => s.employee.name)).toEqual([
      "Maria Santos Reyes",
    ]);
  });

  it("looked after its history: nothing on anyone's Home is weeks overdue", async () => {
    for (const p of PERSONAS) {
      const home = await (await as(p.email)).get<{ items: { kind: string; title: string; dueOn: string | null }[] }>(
        "/api/v1/inbox",
      );
      const longOverdue = home.items.filter(
        (i) =>
          i.dueOn &&
          i.dueOn < "2026-10-24" &&
          // An expired work pass is a deliberate exception to show; so is the October leaver's final
          // pay, which goes out with October's draft run (see the run's warning).
          i.kind !== "work_pass_expiry" &&
          !(i.title.startsWith("Prepare final pay") && i.title.includes("Priyanka")),
      );
      expect(longOverdue.map((i) => i.title)).toEqual([]);
    }
  });

  it("lists Google, Microsoft and Singpass on the sign-in page (Singpass has generated keys, so it counts as set up)", async () => {
    const res = await demo.app.request("/api/v1/auth/methods?org=kopi-kaki");
    const methods = (await res.json()) as { providers: { kind: string }[]; demoMode: boolean };
    expect(methods.demoMode).toBe(true);
    expect(methods.providers.map((p) => p.kind).sort()).toEqual(["entra", "google", "singpass"]);
  });

  it("sent its emails to the Demo outbox", async () => {
    const outbox = await demo.outbox();
    expect(outbox.length).toBeGreaterThan(0);
    for (const m of outbox) expect(m.to).toMatch(/@kopikaki\.example$/);
  });
});
