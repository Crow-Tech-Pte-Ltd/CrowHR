import type { Actor } from "./access.ts";
import type { AuditDiff } from "../audit/audit.ts";
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

export async function recordAudit(ports: PeoplePorts, actor: Actor, event: AuditEventInput): Promise<void> {
  await ports.audit.record(actor.auditCtx, event);
}
