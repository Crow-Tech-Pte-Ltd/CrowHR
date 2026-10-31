import { describe, expect, it } from "vitest";
import { ACTION_OPTIONS, actionFilterValue, actionLabel, humaniseKey, targetTypeLabel } from "./audit-labels.ts";

describe("audit labels", () => {
  it("labels known actions, including generated ones", () => {
    expect(actionLabel("auth.signed_in")).toBe("Signed in");
    expect(actionLabel("department.archived")).toBe("Department archived");
    expect(actionLabel("lifecycle.salary_change")).toBe("Salary change recorded");
    expect(actionLabel("import.ytd.committed")).toBe("Year-to-date balances imported");
  });

  it("humanises unknown actions and target types instead of showing nothing", () => {
    expect(actionLabel("payroll.run_reopened")).toBe("Payroll run reopened");
    expect(humaniseKey("")).toBe("");
    expect(targetTypeLabel("membership")).toBe("Member");
    expect(targetTypeLabel("leave_request")).toBe("Leave request");
  });

  it("every label is unique, so a typed label maps back to exactly one key", () => {
    const labels = ACTION_OPTIONS.map((o) => o.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("filters by key: labels map to keys, keys and prefixes pass through", () => {
    expect(actionFilterValue(" signed in ")).toBe("auth.signed_in");
    expect(actionFilterValue("auth.")).toBe("auth.");
    expect(actionFilterValue("member.invited")).toBe("member.invited");
    expect(actionFilterValue("")).toBe("");
  });
});
