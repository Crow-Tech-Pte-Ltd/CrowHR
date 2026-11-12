import type { PayrollIssueDto, PayrollItemDto } from "@crowhr/core";

/** What the employee drawer should open with: a prefilled item form. */
export type DrawerTask =
  | { kind: "holiday"; holidayDate: string; holidayName: string }
  | { kind: "overtime"; overtimeSourceId: string }
  | { kind: "edit"; itemId: string }
  | { kind: "add"; itemKind: PayrollItemDto["kind"] };

/** One way to fix an issue: a page to open, or the employee's drawer with a task. */
export type IssueFix =
  | { kind: "allowances"; label: string; codes: string[] }
  | { kind: "company"; label: string }
  | { kind: "people"; label: string }
  | { kind: "person"; label: string; employeeId: string; tab?: "job" | "pay" }
  | { kind: "drawer"; label: string; employeeId: string; task?: DrawerTask };

const ITEM_ISSUES = new Set([
  "OT_HOURS_MISSING",
  "OT_PERIOD_INCOMPLETE",
  "AW_PAYABLE_DATE_MISSING",
  "AW_PAYABLE_OUTSIDE_PERIOD",
  "CPF_ARREARS_RECOVERY_BLOCKED",
]);
const DEDUCTION_ISSUES = new Set(["NET_NEGATIVE", "EA_DEDUCTION_CATEGORY_CAP", "CPF_RECOVERY_NOT_PERMITTED"]);
const PAY_RECORD_ISSUES = new Set(["NO_COMPENSATION", "PAY_BASIS_CHANGES_IN_PERIOD", "ROSTER_RATE_CHANGE_UNSUPPORTED"]);
const PROFILE_ISSUES = new Set(["PR_START_DATE_MISSING", "EA_BELOW_MINIMUM_AGE"]);

/**
 * Where each issue is fixed, most direct first. A blocking issue about an employee always offers at
 * least their drawer; run-level ones link to the page that holds the missing record. `employeeId` is the
 * employee the issue belongs to (the drawer passes its own).
 */
export function fixesFor(issue: PayrollIssueDto, employeeId: string | null): IssueFix[] {
  const ref = issue.ref ?? {};
  const out: IssueFix[] = [];
  if (issue.code === "ALLOWANCE_GROSS_RATE_UNSET" || (issue.code === "PH_GROSS_RATE_REQUIRED" && ref.allowanceCodes))
    out.push({ kind: "allowances", label: "Classify allowances", codes: ref.allowanceCodes ?? [] });
  if (issue.code === "COMPANY_PROFILE_INCOMPLETE") out.push({ kind: "company", label: "Complete the company profile" });
  if (issue.code === "NO_EMPLOYEES") out.push({ kind: "people", label: "Check hire dates in People" });
  if (!employeeId) return out;

  if (issue.code === "PH_GROSS_RATE_REQUIRED" && ref.holidayDate)
    out.push({
      kind: "drawer",
      label: "Enter holiday pay",
      employeeId,
      task: { kind: "holiday", holidayDate: ref.holidayDate, holidayName: ref.holidayName ?? "Public holiday" },
    });
  else if ((issue.code === "OT_NOT_STATUTORY" || issue.code === "OT_AMOUNT_REQUIRED") && ref.itemId)
    out.push(
      ref.itemId.startsWith("attendance:")
        ? {
            kind: "drawer",
            label: "Enter the overtime amount",
            employeeId,
            task: { kind: "overtime", overtimeSourceId: ref.itemId.slice("attendance:".length) },
          }
        : {
            kind: "drawer",
            label: "Enter the overtime amount",
            employeeId,
            task: { kind: "edit", itemId: ref.itemId },
          },
    );
  else if (ITEM_ISSUES.has(issue.code) && ref.itemId && !ref.itemId.includes(":"))
    out.push({ kind: "drawer", label: "Edit the item", employeeId, task: { kind: "edit", itemId: ref.itemId } });
  else if (issue.code === "HOURS_MISSING" || issue.code === "HOURLY_RATE_CHANGES_IN_PERIOD")
    out.push({ kind: "drawer", label: "Add hours worked", employeeId, task: { kind: "add", itemKind: "hours" } });
  else if (issue.code === "SCHEDULED_DAYS_REQUIRED")
    out.push({
      kind: "drawer",
      label: "Add scheduled days",
      employeeId,
      task: { kind: "add", itemKind: "scheduled_days" },
    });
  else if (DEDUCTION_ISSUES.has(issue.code)) out.push({ kind: "drawer", label: "Review the deductions", employeeId });
  else if (PAY_RECORD_ISSUES.has(issue.code))
    out.push({ kind: "person", label: "Open the Pay tab", employeeId, tab: "pay" });
  else if (PROFILE_ISSUES.has(issue.code)) out.push({ kind: "person", label: "Open the profile", employeeId });
  else if (issue.code === "NOT_EMPLOYED_IN_PERIOD")
    out.push({ kind: "person", label: "Check employment dates", employeeId, tab: "job" });

  if (issue.severity === "blocking" && !out.length) out.push({ kind: "drawer", label: "Open the working", employeeId });
  return out;
}
