import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";

/**
 * Segregation of duties (access-control "Self-service and segregation of duties"): nobody
 * changes their own compensation or bank details directly, even as payroll_admin or owner.
 * Call before applying such a change; the client then offers a change request instead.
 */
export function assertNotSelfChange(c: AppContext, targetEmployeeId: string, what: "compensation" | "bank_details") {
  const auth = c.get("auth");
  if (auth?.employeeId && auth.employeeId === targetEmployeeId) {
    throw new AppError(
      "self_change_requires_approval",
      what === "compensation"
        ? "You can't change your own pay directly. Submit a change request so another admin can approve it."
        : "You can't change your own bank details directly. Submit a change request so another admin can approve it.",
      { changeRequestRequired: true, field: what },
    );
  }
}

/**
 * Whether a member may decide their own request. Only an owner, and only when no other
 * eligible member exists; the decision must then be stored as `self_approved`.
 */
export function selfApproval(
  auth: { roles: readonly string[] },
  otherEligibleDeciders: number,
): { allowed: true; flag: "self_approved" } | { allowed: false } {
  return auth.roles.includes("owner") && otherEligibleDeciders === 0
    ? { allowed: true, flag: "self_approved" }
    : { allowed: false };
}
