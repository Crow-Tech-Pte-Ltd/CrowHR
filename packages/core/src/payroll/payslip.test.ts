import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../crypto/tokens.ts";
import { item, payInput } from "../testing/payroll-input.ts";
import { computeEmployeePay } from "./engine/compute.ts";
import type { PayInput } from "./engine/types.ts";
import { buildPayslipView, MOM_PAYSLIP_ITEMS, missingPayslipItems } from "./payslip.ts";
import { renderPayslipPdf } from "./payslip-pdf.ts";

/** Task 4.1/4.2: payslip content (MOM itemised payslip items, research/sg-regulatory.md §7) and PDF. */

function view(input: PayInput, kind: "regular" | "adjustment" = "regular") {
  const result = computeEmployeePay(input);
  return buildPayslipView(
    {
      id: "0190f3c2-0000-7000-8000-00000000abcd",
      runId: input.run.id,
      input,
      result,
      releasedAt: new Date("2026-10-30T02:00:00Z"),
    },
    {
      kind,
      offCycleReason: null,
      adjustsRunId: kind === "adjustment" ? "0190f3c2-0000-7000-8000-00000000aaaa" : null,
      month: input.run.month,
    },
    "October 2026",
  );
}

const october = () =>
  payInput({
    run: { payDate: "2026-10-30" },
    compensation: [{ from: "2020-01-01", to: null, payBasis: "monthly", amountCents: 260_000 }],
    allowances: [
      {
        id: "a1",
        code: "TRANSPORT",
        name: "Transport allowance",
        amountCents: 20_000,
        from: "2020-01-01",
        to: null,
        cpfLiable: true,
        prorate: true,
      },
    ],
    items: [
      item({ kind: "overtime", label: "Overtime", minutes: 150, periodStart: "2026-09-21", periodEnd: "2026-10-20" }),
      item({ kind: "commission", label: "Sales commission", amountCents: 15_000, wageClass: "OW" }),
      item({ kind: "unpaid_leave", label: "No-pay leave", days: 1 }),
      item({ kind: "deduction", label: "Staff uniform", amountCents: 3_000, deductionCategory: "consented" }),
    ],
  });

describe("payslip content", () => {
  it("has every MOM itemised-payslip item", () => {
    const v = view(october());
    expect(MOM_PAYSLIP_ITEMS).toHaveLength(12);
    expect(v.employer.legalName).toBe("Kopi Kaki Pte. Ltd."); // 1 employer
    expect(v.employee.name).toBe("Tan Mei Ling"); // 2 employee
    expect(v.payDate).toBe("2026-10-30"); // 3 date of payment
    expect(v.basic?.amountCents).toBe(260_000); // 4 basic salary
    expect([v.periodStart, v.periodEnd]).toEqual(["2026-10-01", "2026-10-31"]); // 5 salary period
    expect(v.allowances.map((a) => [a.label, a.amountCents])).toEqual([["Transport allowance", 19_091]]); // 6 allowances (pro-rated 21/22)
    expect(v.additional.map((a) => a.label)).toEqual(["Sales commission"]); // 7 other additional payments
    expect(v.deductions.map((d) => [d.label, d.type])).toEqual([
      ["Employee CPF", "fixed"],
      ["CDAC contribution", "fixed"],
      ["No-pay leave (1 day)", "ad_hoc"],
      ["Staff uniform", "ad_hoc"],
    ]); // 8 deductions, fixed and ad hoc
    expect(v.overtime?.hours).toBe(2.5); // 9 OT hours
    expect(v.overtime?.payCents).toBe(5_100); // 10 OT pay: 13.60 × 1.5 × 2.5
    expect(v.overtime?.periods.map((p) => [p.periodStart, p.periodEnd, p.differsFromSalaryPeriod])).toEqual([
      ["2026-09-21", "2026-10-20", true],
    ]); // 11 OT period
    expect(v.netCents).toBeGreaterThan(0); // 12 net salary
    expect(v.grossCents - v.totalDeductionsCents).toBe(v.netCents);
    expect(missingPayslipItems(october(), computeEmployeePay(october()))).toEqual([]);
  });

  it("names the missing item when the employer's name is not set", () => {
    const input = payInput({ employer: { legalName: null } });
    expect(missingPayslipItems(input, computeEmployeePay(input))).toEqual(["Employer's full name"]);
  });

  it("shows hourly staff the rate and hours", () => {
    const v = view(
      payInput({
        compensation: [{ from: "2020-01-01", to: null, payBasis: "hourly", amountCents: 1_150 }],
        items: [item({ kind: "hours", minutes: 6_000 })],
      }),
    );
    expect(v.basic?.hourly).toEqual({ rateCents: 1_150, hours: 100 });
  });

  it("labels an adjustment's payslip as a revision", () => {
    const v = view(payInput({ run: { kind: "adjustment" } }), "adjustment");
    expect(v.title).toBe("Revised payslip, October 2026");
    expect(v.revision?.ofRunId).toBe("0190f3c2-0000-7000-8000-00000000aaaa");
  });
});

describe("payslip PDF", () => {
  it("renders a valid one-page A4 PDF, byte-identical on re-render", async () => {
    const v = view(october());
    const a = await renderPayslipPdf(v, { createdAt: new Date("2026-10-30T02:00:00Z") });
    const b = await renderPayslipPdf(structuredClone(v), { createdAt: new Date("2026-10-30T02:00:00Z") });
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe("%PDF-");
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    const doc = await PDFDocument.load(a);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Payslip, October 2026: Tan Mei Ling");
    // Fonts are embedded (self-hosted), never referenced from the network.
    const raw = new TextDecoder("latin1").decode(a);
    expect(raw).toContain("/FontFile2");
    expect(raw).toContain("CrowHR-AzeretMono");
    expect(raw).not.toMatch(/https?:\/\/fonts\./);
  });

  it("contains the payslip text (checked with pdftotext when installed)", async (ctx) => {
    let hasPdftotext = true;
    try {
      execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    } catch {
      hasPdftotext = false;
    }
    if (!hasPdftotext) ctx.skip();
    const v = view(october());
    const dir = mkdtempSync(join(tmpdir(), "payslip-"));
    try {
      writeFileSync(join(dir, "p.pdf"), await renderPayslipPdf(v, { createdAt: new Date("2026-10-30T02:00:00Z") }));
      const text = execFileSync("pdftotext", ["-layout", join(dir, "p.pdf"), "-"]).toString();
      for (const s of [
        "Kopi Kaki Pte. Ltd.",
        "Tan Mei Ling",
        "S****567D",
        "30 Oct 2026",
        "Basic salary",
        "Overtime pay",
        "2.5 h worked",
        "NET PAY",
        "No-pay leave (1 day)",
      ]) {
        expect(text).toContain(s);
      }
      expect(text).toContain(`S$${(v.netCents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("payslip PDF completeness (payroll-choices.md §5)", () => {
  it("keeps a long full name, every OT period and long line lists, over several pages", async (ctx) => {
    let hasPdftotext = true;
    try {
      execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    } catch {
      hasPdftotext = false;
    }
    const longName = "Muhammad Abdul Rahman bin Abdullah Ibrahim Ismail";
    const items = [
      item({
        kind: "overtime",
        label: "Overtime (September)",
        minutes: 120,
        amountCents: 6_000,
        periodStart: "2026-09-21",
        periodEnd: "2026-09-30",
      }),
      item({
        kind: "overtime",
        label: "Overtime (October)",
        minutes: 90,
        amountCents: 4_500,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-20",
      }),
      ...Array.from({ length: 40 }, (_, i) =>
        item({
          kind: "deduction",
          label: `Staff purchase ${String(i + 1).padStart(2, "0")}`,
          amountCents: 100,
          deductionCategory: "consented",
        }),
      ),
    ];
    const input = payInput({ run: { payDate: "2026-10-30" }, employee: { legalName: longName }, items });
    const result = computeEmployeePay(input);
    expect(missingPayslipItems(input, result)).toEqual([]);
    const v = view(input);
    expect(v.overtime?.periods).toHaveLength(2);
    const pdf = await renderPayslipPdf(v, { createdAt: new Date("2026-10-30T02:00:00Z") });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    if (!hasPdftotext) ctx.skip();
    const dir = mkdtempSync(join(tmpdir(), "payslip-long-"));
    try {
      writeFileSync(join(dir, "p.pdf"), pdf);
      const text = execFileSync("pdftotext", [join(dir, "p.pdf"), "-"])
        .toString()
        .replace(/\s+/g, " ");
      for (const word of longName.split(" ")) expect(text).toContain(word);
      expect(text).toContain("Muhammad Abdul Rahman bin Abdullah Ibrahim");
      expect(text).toContain("21 Sep 2026 – 30 Sep 2026");
      expect(text).toContain("1 Oct 2026 – 20 Oct 2026");
      for (let i = 1; i <= 40; i++) expect(text).toContain(`Staff purchase ${String(i).padStart(2, "0")}`);
      expect(text).toContain("NET PAY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a payslip whose OT period has only one end", () => {
    const input = payInput({
      items: [item({ kind: "overtime", minutes: 60, amountCents: 3_000, periodEnd: "2026-10-15" })],
    });
    expect(missingPayslipItems(input, computeEmployeePay(input))).toEqual(["Overtime period"]);
  });
});
