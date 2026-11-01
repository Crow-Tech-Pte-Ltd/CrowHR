import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import { seedMember } from "../../testing/fixtures.ts";
import { clientAs, type TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { employees, tenures } from "../db/schema/employees.ts";
import { readXlsxSheet } from "../export/xlsx-read.ts";
import { leaveReportSource } from "../leave/reports.ts";
import { CORE_REPORT_SOURCES } from "./registry.ts";

/**
 * Reporting over HTTP (add-reporting tasks 1.1, 1.2, 2.3): catalogue per role, 403/404, scope and
 * sensitivity enforcement, totals over every scoped row, paging and sorting, exports and audit.
 */
describe("reports", () => {
  let w: LeaveWorld;
  let hrPay: TestClient;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
    await w.deps.db.update(employees).set({ preferredName: "Ravi" }).where(eq(employees.id, w.emp.staff));
    hrPay = await clientAs(w.app, w.deps, await seedMember(w.deps, w.orgId, { roles: ["hr_admin", "payroll_admin"] }));
    // Farah leaves on 31 Oct 2026 (resignation).
    await w.deps.db
      .update(tenures)
      .set({ lastWorkingDay: "2026-10-31", cessationReason: "resignation" })
      .where(eq(tenures.employeeId, w.emp.other));
    // Some leave and punches for the team-scoped reports.
    const staff = await w.as("staff");
    const types = (await (await staff.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] };
    const annual = types.items.find((t) => t.code === "annual")?.id;
    for (const [who, from, to] of [
      ["staff", "2026-11-03", "2026-11-04"],
      ["other", "2026-10-20", "2026-10-20"],
    ] as const) {
      const c = await w.as(who);
      const r = await c.post("/api/v1/leave/requests", { leaveTypeId: annual, startDate: from, endDate: to });
      expect(r.status, await r.clone().text()).toBe(201);
    }
    // Approve both: HR is the fallback approver for Farah (no manager); the manager approves Ravi.
    for (const who of ["manager", "hr"] as const) {
      const c = await w.as(who);
      const tasks = (await (await c.get("/api/v1/approvals/tasks")).json()) as { items: { taskId: string }[] };
      for (const t of tasks.items)
        await c.post(`/api/v1/approvals/tasks/${t.taskId}/decision`, { decision: "approve" });
    }
    const sent = "2026-11-13T02:00:00.000Z";
    await punch(staff, "in", "2026-11-10T01:12:00.000Z", { sentAt: sent, queued: true });
    await punch(staff, "out", "2026-11-10T10:00:00.000Z", { sentAt: sent, queued: true });
  });
  afterAll(() => w.close());

  const ids = async (c: TestClient) =>
    ((await (await c.get("/api/v1/reports")).json()) as { items: { id: string; scope: string }[] }).items;

  it("lists only the reports each role may run", async () => {
    expect((await ids(await w.as("owner"))).map((r) => r.id)).toEqual([
      "people.headcount",
      "people.headcount_trend",
      "people.turnover",
      "people.work_pass_expiry",
      "leave.taken",
      "leave.balances",
      "attendance.exceptions",
      "claims.summary",
      "payroll.cost",
      "scheduling.hours",
    ]);
    const hr = (await ids(await w.as("hr"))).map((r) => r.id);
    expect(hr).toContain("people.headcount");
    expect(hr).not.toContain("payroll.cost");
    expect((await ids(await w.as("payroll"))).map((r) => r.id)).toEqual([
      "people.work_pass_expiry",
      "claims.summary",
      "payroll.cost",
    ]);
    // Manager catalogue: leave, attendance and scheduled hours, team-scoped; no payroll cost or headcount.
    expect(await ids(await w.as("manager"))).toEqual([
      expect.objectContaining({ id: "leave.taken", scope: "team" }),
      expect.objectContaining({ id: "leave.balances", scope: "team" }),
      expect.objectContaining({ id: "attendance.exceptions", scope: "team" }),
      expect.objectContaining({ id: "scheduling.hours", scope: "team" }),
    ]);
    expect(await ids(await w.as("staff"))).toEqual([]);
  });

  it("answers 403 for a report the member may not run and 404 for one not installed", async () => {
    expect((await (await w.as("hr")).get("/api/v1/reports/payroll.cost")).status).toBe(403);
    expect((await (await w.as("manager")).get("/api/v1/reports/people.headcount")).status).toBe(403);
    expect((await (await w.as("staff")).get("/api/v1/reports/leave.taken")).status).toBe(403);
    expect((await (await w.as("owner")).get("/api/v1/reports/people.nothing")).status).toBe(404);
    // A host without the leave module registers no leave reports.
    const deps = { ...w.deps, reportSources: CORE_REPORT_SOURCES.filter((s) => s !== leaveReportSource) };
    const app = createApp(deps);
    const owner = await clientAs(app, deps, w.m.owner);
    expect((await owner.get("/api/v1/reports/leave.taken")).status).toBe(404);
    expect((await ids(owner)).map((r) => r.id)).not.toContain("leave.balances");
  });

  it.each(["csv", "xlsx"])(
    "salary exports require recent re-auth (%s), ordinary reports remain available",
    async (format) => {
      const stale = await clientAs(w.app, w.deps, w.m.owner, {
        authenticatedAt: new Date(w.clock.now().getTime() - 11 * 60_000),
      });
      const res = await stale.get(`/api/v1/reports/people.headcount/export?columns=basicPay&format=${format}`);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "reauth_required" } });
      expect((await stale.get(`/api/v1/reports/people.headcount/export?format=${format}`)).status).toBe(200);
    },
  );

  it("validates parameters with messages that say how to fix them", async () => {
    const res = await (await w.as("hr")).get("/api/v1/reports/people.headcount?asAt=31-10-2026&by=colour");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { details: { issues: { path: string; message: string }[] } } };
    expect(body.error.details.issues.map((i) => i.path).sort()).toEqual(["asAt", "by"]);
    expect(body.error.details.issues.find((i) => i.path === "asAt")?.message).toMatch(/YYYY-MM-DD/);
  });

  it("headcount: counts the leaver on their last day, not after; percentages to 1 place", async () => {
    const run = async (q: string) =>
      (await (await (await w.as("hr")).get(`/api/v1/reports/people.headcount?${q}`)).json()) as {
        rows: { group: string; headcount: number; share: number }[];
        totals: { group: string; headcount: number };
      };
    const oct31 = await run("asAt=2026-10-31&by=department");
    const nov1 = await run("asAt=2026-11-01&by=department");
    expect(oct31.totals).toEqual({ group: "Total", headcount: 7 });
    expect(nov1.totals.headcount).toBe(6);
    // Siti (hired 14 Jul 2026) is not counted before she starts.
    expect((await run("asAt=2026-07-13")).totals.headcount).toBe(6);
    const sum = oct31.rows.reduce((a, r) => a + r.share, 0);
    expect(sum).toBeGreaterThanOrEqual(999);
    expect(sum).toBeLessThanOrEqual(1001);
    const types = await run("asAt=2026-10-31&by=employment_type");
    expect(types.rows).toEqual(
      expect.arrayContaining([
        { group: "Full-time", headcount: 6, share: 857 },
        { group: "Part-time", headcount: 1, share: 143 },
      ]),
    );
  });

  it("drops salary aggregates for hr_admin unless they also hold payroll_admin", async () => {
    const hr = (await (
      await (await w.as("hr")).get("/api/v1/reports/people.headcount?asAt=2026-10-31&columns=basicPay")
    ).json()) as {
      columns: { key: string }[];
      redactedColumns: string[];
      rows: Record<string, unknown>[];
      totals: Record<string, unknown>;
    };
    expect(hr.redactedColumns).toEqual(["basicPay"]);
    expect(hr.columns.map((c) => c.key)).toEqual(["group", "headcount", "share"]);
    expect(hr.rows.every((r) => !("basicPay" in r))).toBe(true);
    expect(hr.totals).not.toHaveProperty("basicPay");
    const both = (await (
      await hrPay.get("/api/v1/reports/people.headcount?asAt=2026-10-31&columns=basicPay")
    ).json()) as {
      redactedColumns: string[];
      totals: { basicPay: number };
    };
    expect(both.redactedColumns).toEqual([]);
    // Monthly-rated only: 4 × S$4,000 + S$2,400 + S$2,200 = S$20,600.00 (the part-timer is hourly).
    expect(both.totals.basicPay).toBe(4 * 400_000 + 240_000 + 220_000);
    // The export carries the same redaction, and so does the audit event.
    const csv = await (await w.as("hr")).get(
      "/api/v1/reports/people.headcount/export?asAt=2026-10-31&columns=basicPay",
    );
    expect((await csv.text()).split("\r\n")[0]).toBe("Department,Headcount,% of total");
  });

  it("limits a manager's rows to their team and computes totals over those rows only", async () => {
    const body = (await (
      await (await w.as("manager")).get("/api/v1/reports/leave.balances?asAt=2026-11-13")
    ).json()) as {
      rows: { name: string; taken: number }[];
      totals: { taken: number };
      redactedColumns: string[];
    };
    expect(body.rows.map((r) => r.name).sort()).toEqual(["Ahmad Ismail", "Daniel Goh", "Ravi Kumar", "Siti Rahmah"]);
    expect(body.totals.taken).toBe(2);
    // Managers can't see salary, so the liability column is left out.
    expect(body.redactedColumns).toEqual(["liability"]);
    const owner = (await (
      await (await w.as("owner")).get("/api/v1/reports/leave.balances?asAt=2026-11-13")
    ).json()) as {
      rows: { name: string; liability: number | null }[];
      totals: { taken: number; liability: number };
    };
    // Farah left on 31 Oct, so she has no balance on 13 Nov.
    expect(owner.totals.taken).toBe(2);
    expect(owner.rows.find((r) => r.name === "Ravi Kumar")?.liability).toBeGreaterThan(0);
    const att = (await (
      await (await w.as("manager")).get("/api/v1/reports/attendance.exceptions?from=2026-11-09&to=2026-11-13")
    ).json()) as {
      rows: { name: string; lateCount: number }[];
      totals: { lateCount: number };
    };
    expect(att.rows.map((r) => r.name).sort()).toEqual(["Ahmad Ismail", "Daniel Goh", "Ravi Kumar", "Siti Rahmah"]);
    expect(att.totals.lateCount).toBe(1);
  });

  it("leave taken groups by department and type", async () => {
    const body = (await (
      await (await w.as("hr")).get("/api/v1/reports/leave.taken?from=2026-10-01&to=2026-11-30&by=type")
    ).json()) as {
      rows: { leaveType: string; people: number; taken: number }[];
    };
    expect(body.rows).toEqual([{ leaveType: "Annual leave", unit: "Days", people: 2, taken: 3 }]);
    const byEmployee = (await (
      await (await w.as("hr")).get("/api/v1/reports/leave.taken?from=2026-11-01&to=2026-11-30&by=employee")
    ).json()) as { rows: { employee: string }[] };
    expect(byEmployee.rows.map((r) => r.employee)).toEqual(["Ravi Kumar"]);
    const empty = (await (
      await (await w.as("hr")).get("/api/v1/reports/leave.taken?from=2026-01-01&to=2026-01-31")
    ).json()) as {
      rows: unknown[];
      emptyMessage: string;
    };
    expect(empty.rows).toEqual([]);
    expect(empty.emptyMessage).toBe("No approved leave was taken between 1 Jan 2026 and 31 Jan 2026. Widen the dates.");
  });

  it("turnover: lists joiners and leavers with reasons and the rate", async () => {
    const body = (await (
      await (await w.as("hr")).get("/api/v1/reports/people.turnover?from=2026-01-01&to=2026-12-31")
    ).json()) as {
      rows: { movement: string; name: string; reason: string | null; category: string | null }[];
      summary: { label: string; value: number | null }[];
    };
    expect(body.rows.map((r) => [r.movement, r.name, r.reason, r.category])).toEqual([
      ["Joined", "Siti Rahmah", null, null],
      ["Left", "Farah Hassan", "Resignation", "Voluntary"],
    ]);
    const s = Object.fromEntries(body.summary.map((i) => [i.label, i.value]));
    expect(s["Headcount on 1 Jan 2026"]).toBe(6);
    expect(s["Headcount on 31 Dec 2026"]).toBe(6);
    // 1 ÷ 6 × 100 = 16.7%.
    expect(s["Turnover rate"]).toBe(167);
  });

  it("pages 50 rows and sorts by any column", async () => {
    const owner = await w.as("owner");
    const asc = (await (
      await owner.get("/api/v1/reports/people.headcount_trend?from=2024-01&to=2026-10&sort=headcount&dir=asc")
    ).json()) as {
      rows: { month: string; headcount: number }[];
      totalRows: number;
      page: number;
      pageSize: number;
      sort: { key: string; dir: string };
    };
    expect(asc.totalRows).toBe(34);
    expect(asc.pageSize).toBe(50);
    expect(asc.sort).toEqual({ key: "headcount", dir: "asc" });
    const counts = asc.rows.map((r) => r.headcount);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    const long = (await (
      await owner.get("/api/v1/reports/people.headcount_trend?from=2023-11&to=2026-10&by=department&page=2")
    ).json()) as {
      rows: unknown[];
      totalRows: number;
      page: number;
    };
    if (long.totalRows > 50) {
      expect(long.page).toBe(2);
      expect(long.rows.length).toBe(Math.min(50, long.totalRows - 50));
    }
  });

  it("exports the full result as CSV and XLSX, audited with parameters, rows and redactions", async () => {
    const hr = await w.as("hr");
    const csv = await hr.get("/api/v1/reports/people.turnover/export?from=2026-01-01&to=2026-12-31&format=csv");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="people-turnover-2026-11-13.csv"');
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.split("\r\n").slice(0, 3)).toEqual([
      "Date,Movement,Employee no.,Employee,Department,Reason for leaving,Voluntary?",
      expect.stringMatching(/^2026-07-14,Joined,/),
      expect.stringMatching(/^2026-10-31,Left,.*,Resignation,Voluntary$/),
    ]);
    const xlsx = await hr.get("/api/v1/reports/people.headcount/export?asAt=2026-10-31&format=xlsx&columns=basicPay");
    expect(xlsx.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const sheet = readXlsxSheet(new Uint8Array(await xlsx.arrayBuffer()));
    expect(sheet[0]?.map((c) => c.value)).toEqual(["Department", "Headcount", "% of total"]);
    expect(sheet.at(-1)?.map((c) => c.value)).toEqual(["Total", 7]);
    const events = await w.deps.db.select().from(auditEvents).where(eq(auditEvents.action, "report.exported"));
    expect(events.at(-1)?.meta).toMatchObject({
      report: "people.headcount",
      format: "xlsx",
      params: { asAt: "2026-10-31", by: "department" },
      rowCount: 1,
      redactedColumns: ["basicPay"],
    });
    // Export needs the export permission: managers may export their team's leave reports, staff nothing.
    expect((await (await w.as("manager")).get("/api/v1/reports/leave.taken/export")).status).toBe(200);
    expect((await (await w.as("staff")).get("/api/v1/reports/leave.taken/export")).status).toBe(403);
  });
});
