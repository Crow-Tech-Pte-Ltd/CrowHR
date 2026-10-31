import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, type TestClient, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { notifications } from "../db/schema/notifications.ts";
import { payrollPayslips, payrollRuns } from "../db/schema/payroll.ts";
import { applyEvent, ctxFor } from "../employees/lifecycle.ts";
import { readXlsxSheet } from "../export/xlsx-read.ts";
import { OWNER } from "../testing/people-harness.ts";
import { allocate } from "./reports.ts";

/**
 * Payroll cost report (add-reporting design decision 5): totals reconcile with payroll's own run
 * totals to the cent; drafts are excluded; owners and payroll admins only. Also: releasing payslips
 * notifies each employee.
 */
let t: TestDb;
let p: PayrollHttp<"A" | "B" | "C">;
let hr: TestClient;
let staffA: { membershipId: string };
const api = "/api/v1/payroll";

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(t, [
    {
      key: "A",
      name: "Aw Chee Keong",
      dob: "1990-04-12",
      residency: "citizen",
      hireDate: "2020-01-06",
      basicCents: 400_001,
    },
    {
      key: "B",
      name: "Bala Krishnan",
      dob: "1991-05-20",
      residency: "citizen",
      hireDate: "2020-03-02",
      basicCents: 333_333,
    },
    {
      key: "C",
      name: "Chua Li Ting",
      dob: "1975-08-09",
      residency: "pr",
      prStartDate: "2015-01-01",
      hireDate: "2021-06-01",
      basicCents: 512_345,
    },
  ]);
  // C moves to Operations from September, so the report has two departments.
  await applyEvent(ctxFor(p.co.h.deps, p.co.h.ports, p.co.h.actor(OWNER)), p.co.e.C, {
    type: "transfer",
    effectiveDate: "2026-08-01",
    changes: { departmentId: p.co.structure.departments.ops },
  });
  hr = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { roles: ["hr_admin"] }));
  staffA = await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A });
  await p.payRun({ kind: "regular", month: "2026-09" }, [], { release: true });
  await p.payRun({ kind: "regular", month: "2026-10" });
  const bonus = (employeeId: string, amountCents: number) => ({
    employeeId,
    kind: "bonus",
    label: "Performance bonus",
    amountCents,
    wageClass: "AW",
    awPayableDate: "2026-10-30",
  });
  await p.payRun(
    {
      kind: "off_cycle",
      month: "2026-10",
      offCycleReason: "bonus",
      employeeIds: [p.co.e.A, p.co.e.C],
      payDate: "2026-10-30",
    },
    [bonus(p.co.e.A, 123_457), bonus(p.co.e.C, 98_765)],
  );
  // November is still a draft.
  const nov = await p.ok<{ id: string }>(p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-11" }), 201);
  await p.ok(p.admin.post(`${api}/runs/${nov.id}/compute`));
}, 120_000);
afterAll(() => t.close());

type Report = {
  rows: Record<string, number | string>[];
  totals: Record<string, number | string> | null;
  summary: { label: string; value: string }[];
  emptyMessage: string | null;
};

describe("payroll cost report", () => {
  it("splits SDL with largest remainders so the parts add up exactly", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(1999, [3, 7]).reduce((a, b) => a + b, 0)).toBe(1999);
  });

  it("reconciles to the cent with the finalised runs' own totals", async () => {
    const report = await p.ok<Report>(p.admin.get("/api/v1/reports/payroll.cost?from=2026-01&to=2026-12"));
    const runs = await t.db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.orgId, p.co.h.orgId), inArray(payrollRuns.status, ["approved", "paid"])));
    expect(runs).toHaveLength(3);
    const sum = (
      k: "grossCents" | "cpfEmployerCents" | "sdlChargedCents" | "fwlCents" | "cpfEmployeeCents" | "shgCents",
    ) => runs.reduce((a, r) => a + (r.totals?.[k] ?? 0), 0);
    const totals = report.totals as Record<string, number>;
    expect(totals.grossCents).toBe(sum("grossCents"));
    expect(totals.employerCpfCents).toBe(sum("cpfEmployerCents"));
    expect(totals.sdlCents).toBe(sum("sdlChargedCents"));
    expect(totals.fwlCents).toBe(sum("fwlCents"));
    expect(totals.employeeCpfCents).toBe(sum("cpfEmployeeCents"));
    expect(totals.shgCents).toBe(sum("shgCents"));
    expect(totals.employerTotalCents).toBe(
      sum("grossCents") +
        sum("cpfEmployerCents") +
        runs.reduce((a, r) => a + (r.totals?.cpfEmployeeShareAbsorbedCents ?? 0), 0) +
        sum("sdlChargedCents") +
        sum("fwlCents"),
    );
    // Per month, the departments add up to the runs of that month.
    for (const m of ["2026-09", "2026-10"]) {
      const inMonth = runs.filter((r) => r.month === m);
      const rows = report.rows.filter((r) => r.month === m);
      expect(rows.map((r) => r.department).sort()).toEqual(["Operations", "Sales"]);
      expect(rows.reduce((a, r) => a + Number(r.sdlCents), 0)).toBe(
        inMonth.reduce((a, r) => a + (r.totals?.sdlChargedCents ?? 0), 0),
      );
      expect(rows.reduce((a, r) => a + Number(r.grossCents), 0)).toBe(
        inMonth.reduce((a, r) => a + (r.totals?.grossCents ?? 0), 0),
      );
    }
    // Every payslip of the finalised runs is in exactly one row.
    const slips = await t.db
      .select()
      .from(payrollPayslips)
      .where(
        inArray(
          payrollPayslips.runId,
          runs.map((r) => r.id),
        ),
      );
    expect(totals.grossCents).toBe(slips.reduce((a, s) => a + s.grossCents, 0));
    // Drafts are excluded, and named.
    expect(report.rows.some((r) => r.month === "2026-11")).toBe(false);
    expect(report.summary).toEqual([
      expect.objectContaining({ label: "No finalised payroll", value: "Nov 2026" }),
      { label: "Months with no payroll run", value: 9, type: "integer" },
    ]);
  });

  it("shows a note for a month with only a draft run", async () => {
    const report = await p.ok<Report>(p.admin.get("/api/v1/reports/payroll.cost?from=2026-11&to=2026-11"));
    expect(report.rows).toEqual([]);
    expect(report.emptyMessage).toBe("No finalised payroll for Nov 2026. Approve the run, or pick another month.");
  });

  it("exports XLSX with the same totals", async () => {
    const report = await p.ok<Report>(p.admin.get("/api/v1/reports/payroll.cost?from=2026-01&to=2026-12&by=month"));
    expect(report.rows.map((r) => r.month)).toEqual(["2026-09", "2026-10"]);
    const res = await p.admin.get("/api/v1/reports/payroll.cost/export?from=2026-01&to=2026-12&by=month&format=xlsx");
    expect(res.status).toBe(200);
    const sheet = readXlsxSheet(new Uint8Array(await res.arrayBuffer()));
    const header = sheet[0] ?? [];
    const last = sheet.at(-1) ?? [];
    expect(last[0]?.value).toBe("Total");
    // Cells are matched by column letter (empty total cells are not written).
    const letter = (ref: string) => ref.replace(/\d+$/, "");
    const col = (title: string) => {
      const h = header.find((c) => c.value === title);
      return last.find((c) => h && letter(c.ref) === letter(h.ref))?.value;
    };
    const totals = report.totals as Record<string, number>;
    expect(col("Gross pay (S$)")).toBe(Number(totals.grossCents) / 100);
    expect(Math.round(Number(col("Employer total (S$)")) * 100)).toBe(totals.employerTotalCents);
    expect(Math.round(Number(col("SDL (S$)")) * 100)).toBe(totals.sdlCents);
  });

  it("is for owners and payroll admins only; hr_admin gets 403", async () => {
    expect((await p.owner.get("/api/v1/reports/payroll.cost")).status).toBe(200);
    expect((await hr.get("/api/v1/reports/payroll.cost")).status).toBe(403);
    expect((await hr.get("/api/v1/reports/payroll.cost/export?format=xlsx")).status).toBe(403);
  });
});

describe("payslip release", () => {
  it("notifies each employee with a membership that their payslip is ready, without amounts", async () => {
    const rows = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.orgId, p.co.h.orgId), eq(notifications.kind, "payslip_released")));
    // Only September was released, and only A has a membership.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientMembershipId: staffA.membershipId,
      title: "Your payslip for September 2026 is ready",
      subjectType: "payslip",
    });
    expect(rows[0]?.link).toMatch(/^\/me\/payslips\/[0-9a-f-]{36}$/);
    expect(`${rows[0]?.title} ${rows[0]?.body}`).not.toMatch(/S\$|\d+\.\d\d/);
  });
});
