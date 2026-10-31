import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEzpayFile,
  EzpayError,
  type EzpayInput,
  employmentStatus,
  RECORD_LENGTH,
  sanitiseName,
} from "./cpf-ezpay.ts";

/**
 * Task 6.1. The first test reproduces the sample file printed on page 7 of CPF Board's "CPF EZPay
 * (FTP) File Specifications (effective from 16 January 2025)" record for record (the spec's comment
 * column removed; trailing spaces are not visible in the PDF, so each line is padded to 150).
 */

const SPEC_SAMPLE = [
  "F 234567891APTE01 0420180129183315FTP.DTL",
  "F0234567891APTE01 04201801010000005180000000000",
  "F0234567891APTE01 04201801020000000019500000001",
  "F0234567891APTE01 04201801030000000007000000001",
  "F0234567891APTE01 04201801040000000001000000001",
  "F0234567891APTE01 04201801050000000009000000001",
  "F0234567891APTE01 04201801100000000000000000000",
  "F0234567891APTE01 04201801110000000000000000000",
  "F1234567891APTE01 0420180101S1122334A00000011100000003000000000000000LMICKEY TAN AH TAN",
  "F1234567891APTE01 0420180104S1122334A00000000010000000000000000000000 MICKEY TAN AH TAN",
  "F1234567891APTE01 0420180101S2122334B00000011100000003000000000000000NJACKIE JACK",
  "F1234567891APTE01 0420180105S2122334B00000000090000000000000000000000 JACKIE JACK",
  "F1234567891APTE01 0420180101S3122334C00000014800000004000000000000000ERAVIDAVI SINGH S/O RAVIDAVI SINGH",
  "F1234567891APTE01 0420180103S3122334C00000000070000000000000000000000 RAVIDAVI SINGH S/O RAVIDAVI SINGH",
  "F1234567891APTE01 0420180101S4122334D00000014800000004000000000000000EMUHAMMED ALI BIN MUHAMMED ALI",
  "F1234567891APTE01 0420180102S4122334D00000000195000000000000000000000 MUHAMMED ALI BIN MUHAMMED ALI",
  "F9234567891APTE01 040000017000000000521650",
].map((l) => l.padEnd(RECORD_LENGTH, " "));

const sampleInput: EzpayInput = {
  csn: "234567891APTE01",
  adviceCode: "04",
  relevantMonth: "2018-01",
  createdAt: { date: "2018-01-29", time: "18:33:15" },
  sdlCents: 0,
  zeroSummaries: ["10", "11"],
  employees: [
    {
      accountNo: "S4122334D",
      name: "Muhammed Ali bin Muhammed Ali",
      status: "E",
      cpfCents: 148_000,
      owCents: 400_000,
      awCents: 0,
      shgCents: { MBMF: 1_950 },
    },
    {
      accountNo: "S1122334A",
      name: "Mickey Tan Ah Tan",
      status: "L",
      cpfCents: 111_000,
      owCents: 300_000,
      awCents: 0,
      shgCents: { CDAC: 100 },
    },
    {
      accountNo: "S3122334C",
      name: "Ravidavi Singh s/o Ravidavi Singh",
      status: "E",
      cpfCents: 148_000,
      owCents: 400_000,
      awCents: 0,
      shgCents: { SINDA: 700 },
    },
    {
      accountNo: "S2122334B",
      name: "Jackie Jack",
      status: "N",
      cpfCents: 111_000,
      owCents: 300_000,
      awCents: 0,
      shgCents: { ECF: 900 },
    },
  ],
};

describe("CPF EZPay (FTP) file", () => {
  it("reproduces CPF Board's specification sample record for record", () => {
    const f = buildEzpayFile(sampleInput, "JAN2018");
    expect(f.records).toEqual(SPEC_SAMPLE);
    expect(f.fileName).toBe("234567891APTE01JAN201804.DTL");
    expect(f.totalCents).toBe(521_650);
    expect(f.content.split("\r\n").slice(0, -1)).toEqual(SPEC_SAMPLE);
  });

  it("matches the committed golden file for the test company's October 2026", () => {
    const f = buildEzpayFile(
      {
        csn: "201912345KPTE01",
        adviceCode: "01",
        relevantMonth: "2026-10",
        createdAt: { date: "2026-10-30", time: "09:15:00" },
        sdlCents: 9_600,
        employees: [
          {
            accountNo: "S1234567D",
            name: "Aw Chee Keong",
            status: "E",
            cpfCents: 155_400,
            owCents: 420_000,
            awCents: 0,
            shgCents: { CDAC: 150 },
          },
          {
            accountNo: "T0012345J",
            name: "Isabel Tan",
            status: "N",
            cpfCents: 66_600,
            owCents: 180_000,
            awCents: 0,
            shgCents: { CDAC: 50 },
          },
          {
            accountNo: "S8800123C",
            name: "Jason Lim",
            status: "L",
            cpfCents: 81_400,
            owCents: 220_000,
            awCents: 0,
            shgCents: { CDAC: 100 },
          },
          {
            accountNo: "S8512345B",
            name: "Kavitha Raj",
            status: "E",
            cpfCents: 518_000,
            owCents: 800_000,
            awCents: 2_000_000,
            shgCents: {},
          },
          {
            accountNo: "S7012345A",
            name: "Daud bin Hassan",
            status: "E",
            cpfCents: 40_200,
            owCents: 243_776,
            awCents: 0,
            shgCents: { MBMF: 650 },
          },
        ],
      },
      "OCT2026",
    );
    const golden = new URL("./__golden__/201912345KPTE01OCT202601.DTL", import.meta.url);
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden, f.content);
    expect(f.fileName).toBe("201912345KPTE01OCT202601.DTL");
    expect(f.content).toBe(readFileSync(golden, "utf8"));
    for (const r of f.records) expect(r).toHaveLength(150);
    // Summary 01 = 1,554 + 666 + 814 + 5,180 + 402; SDL (11) $96; CDAC donors 3, MBMF 1.
    expect(f.records[1]?.slice(20, 47)).toBe(`202610${"01"}${"000000861600"}${"0000000"}`);
    expect(f.records.find((r) => r[1] === "0" && r.slice(26, 28) === "04")?.slice(28, 47)).toBe("0000000003000000003");
    expect(f.records.find((r) => r[1] === "0" && r.slice(26, 28) === "11")?.slice(28, 40)).toBe("000000009600");
  });

  it("refuses negative amounts, bad account numbers and a bad CSN, saying how to fix them", () => {
    const base = structuredClone(sampleInput);
    const neg = { ...base, employees: [{ ...base.employees[0], cpfCents: -100 } as (typeof base.employees)[number]] };
    expect(() => buildEzpayFile(neg, "JAN2018")).toThrow(/negative.*refund from CPF Board/);
    const fin = {
      ...base,
      employees: [{ ...base.employees[0], accountNo: "G1234567X" } as (typeof base.employees)[number]],
    };
    expect(() => buildEzpayFile(fin, "JAN2018")).toThrow(EzpayError);
    expect(() => buildEzpayFile({ ...base, csn: "123" }, "JAN2018")).toThrow(/Settings → Company/);
  });

  it("strips the characters the spec forbids", () => {
    expect(sanitiseName('Tan_Ah <Kow> "Ben" +$')).toBe("TANAH KOW BEN");
    expect(sanitiseName("Zoë Ng")).toBe("ZOE NG");
  });

  it("derives E/L/N/O from join and leave dates", () => {
    expect(employmentStatus("2020-01-01", null, "2026-10-01", "2026-10-31")).toBe("E");
    expect(employmentStatus("2026-10-16", null, "2026-10-01", "2026-10-31")).toBe("N");
    expect(employmentStatus("2020-01-01", "2026-10-15", "2026-10-01", "2026-10-31")).toBe("L");
    expect(employmentStatus("2026-10-05", "2026-10-20", "2026-10-01", "2026-10-31")).toBe("O");
  });
});
