import { describe, expect, it } from "vitest";
import { buildPain001, Pain001Error, xmlEscape } from "./pain001.ts";

/** Task 6.2: generic ISO 20022 pain.001.001.03 (not a bank-specific format). */

const input = {
  messageId: "CROWHR-202610-ABCD1234",
  createdAt: "2026-10-30T09:00:00+08:00",
  initiatingParty: "Kopi Kaki Pte. Ltd.",
  requestedExecutionDate: "2026-10-30",
  debtor: { name: "Kopi Kaki Pte. Ltd.", bic: "DBSSSGSG", account: "0720123456" },
  payments: [
    {
      endToEndId: "202610-E0001",
      amountCents: 335_850,
      creditorName: "Aw Chee Keong",
      creditorBic: "DBSSSGSG",
      creditorAccount: "1000097531",
      remittance: "Salary October 2026",
    },
    {
      endToEndId: "202610-E0002",
      amountCents: 286_905,
      creditorName: "O'Neil & Sons <Ltd>",
      creditorBic: "OCBCSGSG",
      creditorAccount: "1000195062",
      remittance: "Salary October 2026",
    },
  ],
};

describe("pain.001.001.03", () => {
  it.each(["王小明", "Lim 王", "ரவி", ""])(
    "blocks a creditor name requiring a bank-compatible spelling: %s",
    (creditorName) => {
      expect(() =>
        buildPain001({
          ...input,
          payments: [{ ...(input.payments[0] as (typeof input.payments)[number]), creditorName }],
        }),
      ).toThrow(/Latin|bank-compatible/);
    },
  );

  it("has the ISO 20022 structure, counts and control sum", () => {
    const xml = buildPain001(input);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<NbOfTxs>2</NbOfTxs>");
    expect(xml.match(/<CtrlSum>6227\.55<\/CtrlSum>/g)).toHaveLength(2);
    expect(xml).toContain('<InstdAmt Ccy="SGD">3358.50</InstdAmt>');
    expect(xml).toContain("<CtgyPurp>\n          <Cd>SALA</Cd>");
    // Tags are balanced and properly nested.
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>/g)) {
      if (m[3]) continue;
      if (m[1]) expect(stack.pop()).toBe(m[2]);
      else stack.push(m[2] as string);
    }
    expect(stack).toEqual([]);
  });

  it("escapes and restricts names to the ISO 20022 Latin character set", () => {
    const xml = buildPain001(input);
    expect(xml).toContain("<Nm>O&apos;Neil Sons Ltd</Nm>");
    expect(xmlEscape(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  });

  it("refuses an empty file, a missing debit account and non-positive amounts", () => {
    expect(() => buildPain001({ ...input, payments: [] })).toThrow(Pain001Error);
    expect(() => buildPain001({ ...input, debtor: { ...input.debtor, bic: "" } })).toThrow(/Payroll settings/);
    expect(() =>
      buildPain001({
        ...input,
        payments: [{ ...input.payments[0], amountCents: 0 } as (typeof input.payments)[number]],
      }),
    ).toThrow(/positive/);
  });
});
