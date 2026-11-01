import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PayLine, RunItemInput } from "../engine/types.ts";
import {
  aggregateIr8a,
  buildIr8aCsv,
  columnIndex,
  deductionDollars,
  IR8A_HEADERS,
  IR8A_MAX_RECORDS,
  type Ir8aRecord,
  type Ir8aSlip,
  incomeDollars,
  ir8aRow,
} from "./ir8a.ts";

/**
 * Task 6.3. Column layout: row 5 of the IR8A sheet of IRAS's IR8A Import Template, version 1.0
 * (https://go.gov.sg/ir8a-import-template, fetched 31 Oct 2026): 44 columns A–AR, rows 6–205 for
 * at most 200 records. Rounding: the template's "Instructions (Read Me)" item 6.
 */

const line = (category: PayLine["category"], amountCents: number, extra: Partial<PayLine> = {}): PayLine => ({
  code: category.toUpperCase(),
  kind: category === "cpf_employee" || category === "shg" || category === "deduction" ? "deduction" : "earning",
  category,
  label: category,
  amountCents,
  wageClass: null,
  cpfLiable: true,
  detail: null,
  itemId: null,
  ...extra,
});
const item = (id: string, kind: RunItemInput["kind"]) => ({ id, kind }) as RunItemInput;

const base: Ir8aRecord = {
  idType: "NRIC",
  idNumber: "S1122334A",
  name: "Mickey Tan Ah Tan",
  sex: "Male",
  dateOfBirth: "1986-02-14",
  designation: "Barista",
  commencedOn: null,
  ceasedOn: null,
  bank: "DBS/POSB",
  grossSalaryCents: 7_800_099,
  bonusCents: 7_000_050,
  bonusPaidOn: "2026-12-28",
  allowancesCents: 240_000,
  commissionCents: 0,
  employeeCpfCents: 2_160_001,
  donationsCents: 3_600,
  mbmfCents: 0,
};

describe("IR8A import template rows", () => {
  it("includes taxable cash reimbursements in d1 without making business reimbursements income", () => {
    const slips = [
      {
        payDate: "2026-10-31",
        input: {
          items: [],
          reimbursements: [
            { claimId: "a", typeName: "Private benefit", amountCents: 12345, taxable: true },
            { claimId: "b", typeName: "Business travel", amountCents: 9999, taxable: false },
          ],
        },
        result: { lines: [] },
      },
    ];
    expect(aggregateIr8a(slips, null, new Set()).amounts.allowancesCents).toBe(12345);
  });
  it("has the template's 44 columns, A to AR", () => {
    expect(IR8A_HEADERS).toHaveLength(44);
    expect(columnIndex("A")).toBe(0);
    expect(columnIndex("AR")).toBe(43);
    expect(IR8A_HEADERS[columnIndex("O")]).toBe("a) Gross Salary");
    expect(IR8A_HEADERS[columnIndex("AO")]).toBe("Employee's compulsory CPF contribution");
  });

  it("drops the cents of income and rounds deductions up (template instruction 6)", () => {
    expect([incomeDollars(7_800_099), incomeDollars(99), incomeDollars(-500)]).toEqual([78_000, 0, 0]);
    expect([deductionDollars(2_160_001), deductionDollars(2_160_000), deductionDollars(0)]).toEqual([
      21_601, 21_600, 0,
    ]);
    const row = ir8aRow(base, 1);
    expect([row[columnIndex("O")], row[columnIndex("P")], row[columnIndex("U")], row[columnIndex("AO")]]).toEqual([
      "78000",
      "70000",
      "2400",
      "21601",
    ]);
    expect(row[columnIndex("AP")]).toBe("36");
    expect(row[columnIndex("Q")]).toBe("2026-12-28");
    expect(row[columnIndex("V")]).toBe("");
  });

  it("matches the committed golden file", () => {
    const records: Ir8aRecord[] = [
      base,
      {
        ...base,
        idType: "FIN",
        idNumber: "G1234567X",
        name: "Ravidavi Singh s/o Ravidavi Singh",
        designation: "Cook, line",
        commencedOn: "2026-11-02",
        ceasedOn: "2026-12-15",
        bank: "OTHERS",
        grossSalaryCents: 640_000,
        bonusCents: 0,
        bonusPaidOn: null,
        allowancesCents: 0,
        commissionCents: 12_345,
        employeeCpfCents: 0,
        donationsCents: 0,
        mbmfCents: 550,
      },
      { ...base, idNumber: "T0123456B", name: "=Formula Name", sex: "Female", designation: null },
    ];
    const [part] = buildIr8aCsv(records);
    const golden = new URL("./__golden__/ir8a-2026-part1.csv", import.meta.url);
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden, part?.csv ?? "");
    expect(part?.csv).toBe(readFileSync(golden, "utf8"));
    // Quoted where needed; a leading "=" is neutralised against spreadsheet formula injection.
    expect(part?.csv).toContain(`"Cook, line"`);
    expect(part?.csv).toContain(`,'=Formula Name,`);
    expect(part?.csv.startsWith("﻿*Record No.,")).toBe(true);
  });

  it("splits more than 200 records into parts, record numbers restarting at 1", () => {
    const many = Array.from({ length: IR8A_MAX_RECORDS + 1 }, (_, i) => ({
      ...base,
      idNumber: `S${String(i).padStart(7, "0")}A`,
    }));
    const parts = buildIr8aCsv(many);
    expect(parts.map((p) => p.records)).toEqual([200, 1]);
    const second = parts[1]?.csv.trimEnd().split("\r\n") ?? [];
    expect(second).toHaveLength(2);
    expect(second[1]?.startsWith("1,NRIC,S0000200A,")).toBe(true);
  });
});

describe("IR8A items from a year of payslips", () => {
  it("maps payslip lines: salary, OT, back pay and NPL to (a); bonus to (b); commission (d2); allowances (d1)", () => {
    const slips: Ir8aSlip[] = [
      {
        payDate: "2026-03-28",
        input: { items: [item("b1", "bonus"), item("c1", "commission"), item("bp", "backpay")] },
        result: {
          lines: [
            line("basic", 600_000),
            line("npl", 27_273),
            line("overtime", 12_345),
            line("allowance", 20_000),
            line("additional", 300_000, { itemId: "b1" }),
            line("additional", 50_000, { itemId: "c1" }),
            line("additional", 10_000, { itemId: "bp" }),
            line("claim", 8_800),
            line("cpf_employee", 120_000),
            line("deduction", 4_000, { code: "CPF_AW_RECOVERY" }),
            line("deduction", 9_999, { code: "DED_LOAN" }),
            line("shg", 300, { code: "SHG_CDAC" }),
            line("cpf_employer", 102_000),
          ],
        },
      },
      {
        payDate: "2026-12-24",
        input: { items: [item("b2", "bonus")] },
        result: { lines: [line("additional", 100_000, { itemId: "b2" }), line("shg", 250, { code: "SHG_MBMF" })] },
      },
    ];
    const { amounts, notes } = aggregateIr8a(slips, null, new Set(["CDAC"]));
    expect(amounts).toEqual({
      grossSalaryCents: 600_000 - 27_273 + 12_345 + 10_000,
      bonusCents: 400_000,
      bonusPaidOn: "2026-12-24",
      allowancesCents: 20_000,
      commissionCents: 50_000,
      employeeCpfCents: 124_000,
      donationsCents: 300,
      mbmfCents: 250,
    });
    expect(notes.map((n) => n.code)).toEqual(["IR8A_BACKPAY"]);
  });

  it("adds the YTD opening balance from the previous payroll system and says so", () => {
    const { amounts, notes } = aggregateIr8a(
      [],
      { throughMonth: 6, owCents: 3_600_000, awCents: 500_000, cpfEeCents: 820_000, shgCents: 1_800 },
      new Set(["MBMF"]),
    );
    expect([amounts.grossSalaryCents, amounts.bonusCents, amounts.employeeCpfCents, amounts.mbmfCents]).toEqual([
      3_600_000, 500_000, 820_000, 1_800,
    ]);
    expect(notes[0]?.code).toBe("IR8A_OPENING_BALANCE");
  });
});
