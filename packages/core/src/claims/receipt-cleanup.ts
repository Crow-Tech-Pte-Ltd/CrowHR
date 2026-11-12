import { and, asc, eq, inArray, lt, type SQL, sql } from "drizzle-orm";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { files } from "../db/schema/files.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { RECEIPT_PURPOSE } from "./service.ts";

/**
 * Cleanup of receipts uploaded but never attached (close-claims-gaps "Unattached receipt
 * cleanup"), run by `tick` as the `claim_receipt_cleanup` transition. A claim receipt that is on
 * no claim line (of any claim, drafts included) and was uploaded more than 7 days ago is deleted:
 * its row, an audit event in its organisation, then its bytes. Other upload purposes are never
 * touched.
 *
 * Safe with concurrent ticks and with a receipt being attached at the same moment: candidates are
 * claimed with `FOR UPDATE SKIP LOCKED` (a line being attached holds a key-share lock on the file
 * row, so it is skipped, and the row lock stops new attachments while we hold it), and the delete
 * re-checks the attachment in a fresh statement. Bytes are removed after the commit: if that
 * fails the bytes stay behind without a row, unreachable, which is the same trade-off as uploads.
 */

/** Unattached receipts older than this many days are deleted. */
export const UNATTACHED_RECEIPT_DAYS = 7;
const DAY_MS = 86_400_000;
const BATCH = 200;

const unattached: SQL = sql`not exists (select 1 from claim_line_files f where f.org_id = ${files.orgId} and f.file_id = ${files.id})`;

export async function sweepUnattachedReceipts(
  db: Db,
  deps: Pick<AppDeps, "clock" | "ids" | "fileStore" | "logger">,
  input: { now: Date; audit: (orgId: string) => AuditContext; limit?: number },
): Promise<number> {
  const cutoff = new Date(input.now.getTime() - UNATTACHED_RECEIPT_DAYS * DAY_MS);
  const removed = await db.transaction(async (tx) => {
    const claimed = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.purpose, RECEIPT_PURPOSE), lt(files.createdAt, cutoff), unattached))
      .orderBy(asc(files.createdAt))
      .limit(input.limit ?? BATCH)
      .for("update", { skipLocked: true });
    if (!claimed.length) return [];
    const deleted = await tx
      .delete(files)
      .where(
        and(
          inArray(
            files.id,
            claimed.map((f) => f.id),
          ),
          eq(files.purpose, RECEIPT_PURPOSE),
          unattached,
        ),
      )
      .returning({ id: files.id, orgId: files.orgId, storageKey: files.storageKey, createdAt: files.createdAt });
    for (const f of deleted) {
      await recordAudit(tx, deps, input.audit(f.orgId), {
        action: "file.unattached_removed",
        targetType: "file",
        targetId: f.id,
        meta: { purpose: RECEIPT_PURPOSE, uploadedAt: f.createdAt.toISOString(), afterDays: UNATTACHED_RECEIPT_DAYS },
      });
    }
    return deleted;
  });
  for (const f of removed) {
    try {
      await deps.fileStore.delete(f.storageKey);
    } catch (err) {
      deps.logger.warn("Unattached receipt row deleted but its bytes were not", { fileId: f.id, error: String(err) });
    }
  }
  return removed.length;
}
