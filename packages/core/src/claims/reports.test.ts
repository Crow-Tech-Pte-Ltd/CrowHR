import { and, eq, ne } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaimsWorld, createClaimsWorld, decide, json, line, managerOnlyPolicy } from "../../testing/claims.ts";
import { claims } from "../db/schema/claims.ts";
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

  describe("registered with reporting", () => {
    type Report = {
      rows: Record<string, unknown>[];
      totals: Record<string, unknown> | null;
      summary: { label: string; value: unknown }[];
      columns: { key: string }[];
      notes: string[];
    };
    const run = async (who: "hr" | "payroll" | "owner", id: string, query = ""): Promise<Report> => {
      const res = await (await w.as(who)).get(`/api/v1/reports/${id}${query}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as Report;
    };

    it("lists the claim reports for owners, hr_admins and payroll_admins only", async () => {
      const claimIds = async (who: keyof ClaimsWorld["m"]) =>
        ((await json(await (await w.as(who)).get("/api/v1/reports"))).items as { id: string; module: string }[])
          .filter((r) => r.module === "claims")
          .map((r) => r.id);
      const all = ["claims.summary", "claims.ageing", "claims.cap_usage", "claims.payouts", "claims.lines"];
      for (const who of ["owner", "hr", "payroll"] as const) expect(await claimIds(who)).toEqual(all);
      for (const who of ["manager", "staff"] as const) {
        expect(await claimIds(who)).toEqual([]);
        expect((await (await w.as(who)).get("/api/v1/reports/claims.lines")).status).toBe(403);
      }
    });

    it("claims by department for October totals the SGD amount and GST", async () => {
      const r = await run("hr", "claims.summary", "?by=department&from=2026-10-01&to=2026-10-31");
      expect(r.rows.map((x) => [x.group, x.status, x.totalCents, x.gstCents])).toEqual([
        ["Sales", "Paid", 5090, 90],
        ["Operations", "Waiting for approval", 500, 0],
      ]);
      expect(r.totals).toMatchObject({ claims: 2, totalCents: 5590, gstCents: 90 });
    });

    it("status ageing: waiting claims with their age, more than 7 days flagged", async () => {
      const other = await json(
        await (await w.as("other")).post("/api/v1/claims", {
          lines: [line(transport, { amountMinor: 300, expenseDate: "2026-11-01" })],
          submit: true,
        }),
      );
      // Now is 3 Nov 2026 10:00 SGT: the two claims submitted earlier waited 9 days, Siti's 2.
      await w.deps.db
        .update(claims)
        .set({ submittedAt: new Date("2026-10-25T01:00:00.000Z") })
        .where(and(eq(claims.orgId, w.orgId), eq(claims.status, "submitted"), ne(claims.id, other.id)));
      await w.deps.db
        .update(claims)
        .set({ submittedAt: new Date("2026-11-01T01:00:00.000Z") })
        .where(eq(claims.id, other.id));
      const r = await run("hr", "claims.ageing");
      expect(r.rows.map((x) => [x.employee, x.status, x.daysWaiting, x.overSevenDays, x.totalCents]).sort()).toEqual([
        ["Lee Jun Jie", "Waiting for approval", 9, true, 500],
        ["Ravi Kumar", "Waiting for approval", 9, true, 700],
        ["Siti Rahmah", "Waiting for approval", 2, false, 300],
      ]);
      expect(r.summary).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Waiting for approval", value: 3 }),
          expect.objectContaining({ label: "Waiting more than 7 days", value: 2 }),
        ]),
      );
      // Paid, rejected and withdrawn claims are not waiting.
      expect(r.rows.map((x) => x.claim)).not.toContain("C-0001");
    });

    it("cap usage per employee for a month: cap, used, pending and remaining", async () => {
      const meals = await w.type({ code: "MEALS", name: "Overtime meals", capPeriod: "monthly", capCents: 5000 });
      const phone = await w.type({ code: "PHONE", name: "Phone", capPeriod: "yearly", capCents: 60000 });
      const staff = await w.as("staff");
      const approved = await json(
        await staff.post("/api/v1/claims", {
          lines: [
            line(meals, { amountMinor: 1500, expenseDate: "2026-10-10" }),
            line(phone, { amountMinor: 4800, expenseDate: "2026-09-10" }),
          ],
          submit: true,
        }),
      );
      await decide(w, "manager", approved.id, "approve");
      await staff.post("/api/v1/claims", {
        lines: [line(meals, { amountMinor: 1000, expenseDate: "2026-10-12" })],
        submit: true,
      });
      // September meals are another period.
      await staff.post("/api/v1/claims", {
        lines: [line(meals, { amountMinor: 900, expenseDate: "2026-09-12" })],
        submit: true,
      });
      const r = await run("payroll", "claims.cap_usage", "?month=2026-10");
      expect(
        r.rows.map((x) => [x.employee, x.type, x.period, x.capCents, x.usedCents, x.pendingCents, x.remainingCents]),
      ).toEqual([
        ["Ravi Kumar", "Overtime meals", "October 2026", 5000, 1500, 1000, 2500],
        ["Ravi Kumar", "Phone", "2026", 60000, 4800, 0, 55200],
      ]);
      expect(r.rows[0]?.usedPercent).toBe(500);
      expect((await (await w.as("hr")).get("/api/v1/reports/claims.cap_usage?month=10-2026")).status).toBe(400);
    });

    it("payout register: paid claims with method, date and reference", async () => {
      const r = await run("payroll", "claims.payouts", "?from=2026-11-01&to=2026-11-30");
      expect(r.rows).toEqual([
        expect.objectContaining({
          claim: "C-0001",
          employee: "Ravi Kumar",
          paidOn: "2026-11-03",
          paidVia: "Outside payroll",
          reference: "FAST 3 Nov",
          totalCents: 5090,
        }),
      ]);
      expect(r.totals).toMatchObject({ totalCents: 5090 });
    });

    it("line register: medical merchants, descriptions and receipts are omitted without medical access", async () => {
      const hr = await run("hr", "claims.lines", "?from=2026-10-01&to=2026-10-31");
      const hrMedical = hr.rows.find((x) => x.type === "Medical");
      expect(hrMedical).toMatchObject({ merchant: "Raffles Medical", description: "Fever", receipts: 0 });
      const pay = await run("payroll", "claims.lines", "?from=2026-10-01&to=2026-10-31");
      const medicalLine = pay.rows.find((x) => x.type === "Medical");
      expect(medicalLine).toMatchObject({
        merchant: null,
        description: "Medical, hidden",
        receipts: null,
        sgdCents: 4000,
      });
      expect(pay.rows.find((x) => x.type === "Transport" && x.employee === "Ravi Kumar")).toMatchObject({
        merchant: "Grab",
        description: "Taxi to client meeting",
        gstCents: 90,
      });
      // Medical amounts still count in the totals.
      expect(pay.totals).toMatchObject({ sgdCents: 5590, gstCents: 90 });
      expect(pay.notes.join(" ")).toMatch(/medical/i);
      const csv = await (
        await (await w.as("payroll")).get("/api/v1/reports/claims.lines/export?from=2026-10-01&to=2026-10-31")
      ).text();
      expect(csv).toContain("Taxi to client meeting");
      expect(csv).not.toContain("Raffles Medical");
      expect(csv).not.toContain("Fever");
    });
  });
});
