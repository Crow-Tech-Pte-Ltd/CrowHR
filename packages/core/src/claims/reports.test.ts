import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaimsWorld, createClaimsWorld, decide, json, line, managerOnlyPolicy } from "../../testing/claims.ts";
import { employees } from "../db/schema/employees.ts";

describe("claim reports and export", () => {
  let w: ClaimsWorld;
  let transport: string;
  let medical: string;
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-11-03T02:00:00.000Z" });
    await w.deps.db.update(employees).set({ preferredName: "Ravi" }).where(eq(employees.id, w.emp.staff));
    transport = await w.type({ code: "TRANSPORT", name: "Transport" });
    medical = await w.type({ code: "MEDICAL", name: "Medical", category: "medical" });
    await managerOnlyPolicy(w);
    const staff = await w.as("staff");
    const intern = await w.as("intern");
    const a = await json(
      await staff.post("/api/v1/claims", {
        lines: [
          line(transport, { amountMinor: 1090, gstCents: 90, expenseDate: "2026-10-05" }),
          line(medical, {
            amountMinor: 4000,
            expenseDate: "2026-10-06",
            merchant: "Raffles Medical",
            description: "Fever",
          }),
        ],
        submit: true,
      }),
    );
    await decide(w, "manager", a.id, "approve");
    await intern.post("/api/v1/claims", {
      lines: [line(transport, { amountMinor: 500, expenseDate: "2026-10-20" })],
      submit: true,
    });
    // November and draft lines are outside October / not reported.
    await staff.post("/api/v1/claims", {
      lines: [line(transport, { amountMinor: 700, expenseDate: "2026-11-02" })],
      submit: true,
    });
    await staff.post("/api/v1/claims", { lines: [line(transport, { amountMinor: 999, expenseDate: "2026-10-07" })] });
    await (await w.as("payroll")).post("/api/v1/claims/mark-paid", {
      claimIds: [a.id],
      paidOn: "2026-11-03",
      reference: "FAST 3 Nov",
    });
  });
  afterEach(() => w.t.close());

  it("claims by department for October: count, SGD total and GST total by status", async () => {
    const res = await (await w.as("hr")).get(
      "/api/v1/claims/reports/summary?by=department&from=2026-10-01&to=2026-10-31",
    );
    expect(res.status).toBe(200);
    expect((await json(res)).items).toEqual([
      {
        key: "Operations",
        label: "Operations",
        status: "submitted",
        claimCount: 1,
        lineCount: 1,
        totalCents: 500,
        gstCents: 0,
      },
      { key: "Sales", label: "Sales", status: "paid", claimCount: 1, lineCount: 2, totalCents: 5090, gstCents: 90 },
    ]);
  });

  it("by type, employee and month", async () => {
    const hr = await w.as("hr");
    const byType = (await json(await hr.get("/api/v1/claims/reports/summary?by=type&from=2026-10-01&to=2026-11-30")))
      .items;
    expect(
      byType.map((r: { key: string; status: string; totalCents: number }) => [r.key, r.status, r.totalCents]),
    ).toEqual([
      ["MEDICAL", "paid", 4000],
      ["TRANSPORT", "paid", 1090],
      ["TRANSPORT", "submitted", 1200],
    ]);
    const byEmployee = (
      await json(await hr.get("/api/v1/claims/reports/summary?by=employee&from=2026-10-01&to=2026-10-31"))
    ).items;
    expect(byEmployee.map((r: { label: string }) => r.label)).toEqual(["Lee Jun Jie", "Ravi Kumar"]);
    const byMonth = (await json(await hr.get("/api/v1/claims/reports/summary?by=month&from=2026-10-01&to=2026-11-30")))
      .items;
    expect(byMonth.map((r: { key: string; status: string }) => `${r.key}:${r.status}`)).toEqual([
      "2026-10:paid",
      "2026-10:submitted",
      "2026-11:submitted",
    ]);
    expect((await hr.get("/api/v1/claims/reports/summary?by=type&from=2026-11-01&to=2026-10-01")).status).toBe(400);
  });

  it("only owners, hr_admins and payroll_admins read reports", async () => {
    expect(
      (await (await w.as("payroll")).get("/api/v1/claims/reports/summary?from=2026-10-01&to=2026-10-31")).status,
    ).toBe(200);
    for (const who of ["manager", "staff"] as const) {
      expect((await (await w.as(who)).get("/api/v1/claims/reports/summary?from=2026-10-01&to=2026-10-31")).status).toBe(
        403,
      );
      expect((await (await w.as(who)).get("/api/v1/claims/reports/export?from=2026-10-01&to=2026-10-31")).status).toBe(
        403,
      );
    }
  });

  it("exports the line register as CSV; medical descriptions are left out for payroll_admin", async () => {
    const hrCsv = await (
      await (await w.as("hr")).get("/api/v1/claims/reports/export?report=lines&from=2026-10-01&to=2026-10-31")
    ).text();
    expect(hrCsv.split("\r\n")[0]).toMatch(/^Claim,Status,Employee no\.,Employee,Department,Type code/);
    expect(hrCsv).toContain("Ravi Kumar");
    expect(hrCsv).toContain("Raffles Medical");
    expect(hrCsv).toContain("10.90,0.90");
    const res = await (await w.as("payroll")).get(
      "/api/v1/claims/reports/export?report=lines&from=2026-10-01&to=2026-10-31",
    );
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="claims-lines-2026-10-01-to-2026-10-31.csv"',
    );
    const csv = await res.text();
    expect(csv).not.toContain("Raffles Medical");
    expect(csv).not.toContain("Fever");
    expect(csv).toContain("(medical, hidden)");
    expect(csv).toContain("40.00");
  });

  it("exports the payout register and the summary as XLSX", async () => {
    const hr = await w.as("hr");
    const payouts = await (
      await hr.get("/api/v1/claims/reports/export?report=payouts&from=2026-11-01&to=2026-11-30")
    ).text();
    expect(payouts).toContain("Ravi Kumar");
    expect(payouts).toContain("C-0001");
    expect(payouts).toContain("FAST 3 Nov");
    const x = await hr.get(
      "/api/v1/claims/reports/export?report=summary&by=type&format=xlsx&from=2026-10-01&to=2026-10-31",
    );
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const bytes = new Uint8Array(await x.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });
});
