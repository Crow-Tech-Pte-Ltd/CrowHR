import type { Db } from "../db/types.ts";
import type { ApprovedOvertime, OvertimeSource, PayableClaim, ReimbursementSource } from "../payroll/ports.ts";

/** Test doubles for the payroll ports (runtime-agnostic, so the demo can reuse them). */
export function createMemoryReimbursements(claims: PayableClaim[] = []): ReimbursementSource & {
  claims: PayableClaim[];
  reserved: Map<string, string>;
  paid: Map<string, string>;
} {
  const reserved = new Map<string, string>();
  const paid = new Map<string, string>();
  return {
    claims,
    reserved,
    paid,
    listPayable: async () => claims.filter((c) => !paid.has(c.claimId)),
    async reserve(_tx: Db, _orgId, runId, claimIds) {
      for (const id of claimIds) {
        const holder = reserved.get(id);
        if ((holder && holder !== runId) || paid.has(id)) throw new Error(`claim ${id} is already reserved or paid`);
      }
      for (const id of claimIds) reserved.set(id, runId);
    },
    async release(_tx: Db, _orgId, runId) {
      for (const [id, r] of [...reserved]) if (r === runId) reserved.delete(id);
    },
    async markPaid(_tx: Db, _orgId, runId, paymentDate) {
      for (const [id, r] of [...reserved]) if (r === runId) paid.set(id, paymentDate);
    },
  };
}

export function createMemoryOvertime(
  entries: ApprovedOvertime[] = [],
): OvertimeSource & { entries: ApprovedOvertime[] } {
  return {
    entries,
    listApproved: async (_orgId, from, to) => entries.filter((e) => e.periodEnd >= from && e.periodStart <= to),
  };
}
