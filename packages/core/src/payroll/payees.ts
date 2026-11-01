import { bankAccounts } from "../db/schema/employees.ts";
import type { PayeeSnapshot } from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import { asAtMany } from "../employees/effective.ts";

/**
 * Payee bank accounts for a run (review finding #10). Compute stores each employee's account as at
 * the pay date on the payslip; the run's input hash covers it, so a bank change before approval makes
 * the run stale, and approval and the bank file refuse a run whose payees changed after compute.
 * Without this, a bank change dated back into an approved period silently redirected net pay.
 */

export type BankAccountRow = typeof bankAccounts.$inferSelect;

export function toPayee(row: BankAccountRow | undefined): PayeeSnapshot | null {
  if (!row) return null;
  return {
    bankAccountId: row.id,
    bankCode: row.bankCode,
    holderName: row.holderName,
    accountLast4: row.accountLast4,
    accountNumberHmac: row.accountNumberHmac,
  };
}

export function samePayee(a: PayeeSnapshot | null | undefined, b: PayeeSnapshot | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.bankAccountId === b.bankAccountId &&
    a.bankCode === b.bankCode &&
    a.holderName === b.holderName &&
    a.accountNumberHmac === b.accountNumberHmac
  );
}

/** The current account rows (as at `payDate`) for `employeeIds`. */
export async function liveAccounts(db: Db, orgId: string, employeeIds: readonly string[], payDate: string) {
  return asAtMany(db, bankAccounts, orgId, employeeIds, payDate);
}

/** Employees whose snapshot no longer matches the live account (names for the message). */
export async function changedPayees(
  db: Db,
  orgId: string,
  payDate: string,
  slips: { employeeId: string; employeeName: string; payee: PayeeSnapshot | null }[],
): Promise<string[]> {
  const live = await liveAccounts(
    db,
    orgId,
    slips.map((s) => s.employeeId),
    payDate,
  );
  return slips.filter((s) => !samePayee(s.payee, toPayee(live.get(s.employeeId)))).map((s) => s.employeeName);
}

export function changedPayeesMessage(names: string[], when: "approval" | "file"): string {
  const who = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return when === "approval"
    ? `Bank details changed after this run was computed (${who}). Withdraw it, recompute, check the new accounts with the employees, then submit again.`
    : `Bank details changed after this run was computed (${who}). Crow HR won't produce a bank file that pays an account the approver didn't see. Return the run to draft, recompute, check the new accounts with the employees and approve it again.`;
}
