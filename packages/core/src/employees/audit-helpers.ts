import type { AuditDiff } from "../audit/audit.ts";
import type { Db } from "../db/types.ts";
import type { Actor } from "./access.ts";
import type { AuditEventInput, PeoplePorts } from "./ports.ts";

/** Fields whose values never enter the audit log (sensitivity classes salary, nric, bank). */
export const SENSITIVE_AUDIT_FIELDS = new Set([
  "idNumber",
  "accountNumber",
  "passNumber",
  "amountCents",
  "basicPayCents",
  "race",
  "raceSecondary",
  "religion",
  "holderName",
]);

/**
 * Field-level diff of two plain objects. Sensitive fields record only that
 * they changed (access-control "Audit events").
 */
export function diffOf(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  sensitive: ReadonlySet<string> = SENSITIVE_AUDIT_FIELDS,
): AuditDiff {
  const out: AuditDiff = {};
  for (const [key, to] of Object.entries(after)) {
    if (to === undefined) continue;
    const from = before ? before[key] : undefined;
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    out[key] = sensitive.has(key) ? { changed: true } : { from: from ?? null, to: to ?? null };
  }
  return out;
}

/**
 * Records `event` inside `tx`, the transaction that makes the change, so a
 * failed audit write rolls the change back (architecture "Write + audit in one
 * transaction").
 */
export async function recordAudit(tx: Db, ports: PeoplePorts, actor: Actor, event: AuditEventInput): Promise<void> {
  await ports.audit.record(tx, actor.auditCtx, event);
}
