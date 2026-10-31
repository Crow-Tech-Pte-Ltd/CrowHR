import { auditContext, recordAudit } from "../audit/audit.ts";
import { requireRecentAuth } from "../auth/guards.ts";
import { HOUR } from "../auth/settings.ts";
import { hitWindow, REVEAL_LIMIT_PER_HOUR } from "../auth/throttle.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { authorize } from "./authorize.ts";

/**
 * NRIC/FIN masking (access-control "NRIC/FIN masking and reveal"): first character, four
 * asterisks, last three digits and the check letter. `S1234567D` → `S****567D`.
 * Works for S, T, F, G and M prefixes. Anything that doesn't look like an NRIC/FIN is fully masked.
 */
export function maskNric(value: string): string {
  const v = value.trim().toUpperCase();
  if (!/^[STFGM]\d{7}[A-Z]$/.test(v)) return "*".repeat(Math.max(4, v.length));
  return `${v[0]}****${v.slice(5)}`;
}

/** Bank account numbers show only their last four digits: `****6789`. */
export function maskBankAccount(value: string): string {
  const digits = value.replace(/[^0-9A-Za-z]/g, "");
  return digits.length <= 4 ? "****" : `****${digits.slice(-4)}`;
}

export type RevealClass = "nric" | "bank";

/**
 * Reveal one full NRIC/FIN or bank account number (spec: re-auth within 10 minutes, at most 30
 * reveals per member per hour, audited `nric.revealed` / `bank.revealed` with the employee).
 * Module routes call this from a dedicated `POST …/reveal` endpoint; the value is never cached.
 */
export async function revealSensitive(
  c: AppContext,
  input: { cls: RevealClass; employeeId: string; load: () => Promise<string | null> },
): Promise<string> {
  const grant = await authorize(c, input.cls === "nric" ? "personal_details:read" : "bank_details:read");
  await grant.assertEmployee(input.employeeId, "employee");
  requireRecentAuth(c);
  const { db, clock } = c.var.deps;
  const auth = c.get("auth");
  const now = clock.now();
  const { count, resetsAt } = await hitWindow(db, `reveal:${auth?.membershipId}`, HOUR, now);
  if (count > REVEAL_LIMIT_PER_HOUR) {
    throw new AppError(
      "rate_limited",
      `You can reveal at most ${REVEAL_LIMIT_PER_HOUR} values an hour. Try again later.`,
      undefined,
      {
        headers: { "Retry-After": String(Math.ceil((resetsAt.getTime() - now.getTime()) / 1000)) },
      },
    );
  }
  const value = await input.load();
  if (value === null) throw new AppError("not_found", "There is no value to reveal.");
  await recordAudit(db, c.var.deps, auditContext(c), {
    action: input.cls === "nric" ? "nric.revealed" : "bank.revealed",
    targetType: "employee",
    targetId: input.employeeId,
  });
  c.header("cache-control", "no-store");
  return value;
}
