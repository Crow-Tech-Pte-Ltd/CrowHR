import type { PayrollIssueDto } from "@crowhr/core";
import { describe, expect, it } from "vitest";
import { fixesFor } from "./fixes.ts";

const issue = (code: string, ref?: PayrollIssueDto["ref"], severity: PayrollIssueDto["severity"] = "blocking") => ({
  code,
  severity,
  message: "",
  source: null,
  ...(ref ? { ref } : {}),
});
const kinds = (fixes: ReturnType<typeof fixesFor>) => fixes.map((f) => [f.kind, f.label]);

describe("where each payroll issue is fixed", () => {
  it("an unclassified allowance links to allowance treatment, run-level or per employee", () => {
    expect(fixesFor(issue("ALLOWANCE_GROSS_RATE_UNSET", { allowanceCodes: ["SHIFT"] }, "warning"), null)).toEqual([
      { kind: "allowances", label: "Classify allowances", codes: ["SHIFT"] },
    ]);
    const ph = fixesFor(
      issue("PH_GROSS_RATE_REQUIRED", {
        holidayDate: "2027-02-06",
        holidayName: "Chinese New Year",
        allowanceCodes: ["SHIFT", "TRANSPORT"],
      }),
      "e1",
    );
    expect(ph).toEqual([
      { kind: "allowances", label: "Classify allowances", codes: ["SHIFT", "TRANSPORT"] },
      {
        kind: "drawer",
        label: "Enter holiday pay",
        employeeId: "e1",
        task: { kind: "holiday", holidayDate: "2027-02-06", holidayName: "Chinese New Year" },
      },
    ]);
  });

  it("holiday pay for hourly or rostered staff opens the drawer with the holiday", () => {
    expect(
      fixesFor(issue("PH_GROSS_RATE_REQUIRED", { holidayDate: "2027-05-01", holidayName: "Labour Day" }), "e1"),
    ).toEqual([
      {
        kind: "drawer",
        label: "Enter holiday pay",
        employeeId: "e1",
        task: { kind: "holiday", holidayDate: "2027-05-01", holidayName: "Labour Day" },
      },
    ]);
  });

  it("fed overtime is priced against its claim; a manual overtime item is edited", () => {
    expect(fixesFor(issue("OT_NOT_STATUTORY", { itemId: "attendance:c1" }), "e1")).toEqual([
      {
        kind: "drawer",
        label: "Enter the overtime amount",
        employeeId: "e1",
        task: { kind: "overtime", overtimeSourceId: "c1" },
      },
    ]);
    expect(fixesFor(issue("OT_AMOUNT_REQUIRED", { itemId: "i1" }), "e1")).toEqual([
      { kind: "drawer", label: "Enter the overtime amount", employeeId: "e1", task: { kind: "edit", itemId: "i1" } },
    ]);
  });

  it("a manual item's issue edits that item; a fed item's falls back to the working", () => {
    expect(kinds(fixesFor(issue("AW_PAYABLE_OUTSIDE_PERIOD", { itemId: "i1" }), "e1"))).toEqual([
      ["drawer", "Edit the item"],
    ]);
    expect(kinds(fixesFor(issue("OT_PERIOD_INCOMPLETE", { itemId: "attendance:c1" }), "e1"))).toEqual([
      ["drawer", "Open the working"],
    ]);
  });

  it("missing records link to where they are kept", () => {
    expect(kinds(fixesFor(issue("COMPANY_PROFILE_INCOMPLETE"), null))).toEqual([
      ["company", "Complete the company profile"],
    ]);
    expect(kinds(fixesFor(issue("NO_EMPLOYEES"), null))).toEqual([["people", "Check hire dates in People"]]);
    expect(fixesFor(issue("NO_COMPENSATION"), "e1")).toEqual([
      { kind: "person", label: "Open the Pay tab", employeeId: "e1", tab: "pay" },
    ]);
    expect(kinds(fixesFor(issue("HOURS_MISSING"), "e1"))).toEqual([["drawer", "Add hours worked"]]);
    expect(kinds(fixesFor(issue("SCHEDULED_DAYS_REQUIRED"), "e1"))).toEqual([["drawer", "Add scheduled days"]]);
  });

  it("every blocking issue about an employee offers at least their working; warnings need not", () => {
    expect(kinds(fixesFor(issue("CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED"), "e1"))).toEqual([
      ["drawer", "Open the working"],
    ]);
    expect(fixesFor(issue("EA_OT_PAID_LATE", { itemId: "i1" }, "warning"), "e1")).toEqual([]);
  });
});
