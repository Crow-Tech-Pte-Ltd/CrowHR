import { and, eq, isNull, sql } from "drizzle-orm";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { files } from "../db/schema/files.ts";
import type { AppDeps } from "../deps.ts";
import { notify } from "../notifications/notify.ts";

/**
 * Optional virus-scan hook (add-claims design decision 4). The default is no scanner: uploads
 * are stored as `unscanned` and usable at once, and owners see "scanning is off" in Settings.
 * With a scanner (e.g. the server's ClamAV adapter behind CLAMAV_HOST), uploads are stored as
 * `pending_scan` and the `tick` sweep scans them, so uploads stay fast and core stays
 * runtime-agnostic. `error` retries up to MAX_SCAN_ATTEMPTS, then the file is `scan_failed`.
 */
export interface FileScanner {
  scan(data: Uint8Array, meta: { fileId: string; mime: string }): Promise<"clean" | "infected" | "error">;
}

/** Hosts pass the scanner as `deps.fileScanner` (an optional extension of AppDeps, like payroll's ports). */
export type FilesAppDeps = AppDeps & { fileScanner?: FileScanner };

export function fileScannerOf(deps: AppDeps): FileScanner | null {
  return (deps as FilesAppDeps).fileScanner ?? null;
}

export const MAX_SCAN_ATTEMPTS = 3;

/** A no-op scanner that passes everything: an explicit "clean" for hosts that want the flow without ClamAV. */
export const passThroughScanner: FileScanner = { scan: async () => "clean" };

/**
 * Scans up to `limit` pending files. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two
 * replicas never scan the same file. Returns the number of files whose status changed.
 */
export async function runScanSweep(deps: AppDeps, opts: { limit?: number } = {}): Promise<number> {
  const scanner = fileScannerOf(deps);
  if (!scanner) return 0;
  return deps.db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(files)
      .where(and(eq(files.scanStatus, "pending_scan"), isNull(files.deletedAt)))
      .orderBy(files.createdAt)
      .limit(opts.limit ?? 20)
      .for("update", { skipLocked: true });
    let changed = 0;
    for (const f of pending) {
      const stored = await deps.fileStore.get(f.storageKey);
      let verdict: "clean" | "infected" | "error" = "error";
      if (stored) {
        try {
          verdict = await scanner.scan(stored.data, { fileId: f.id, mime: f.mime });
        } catch {
          verdict = "error";
        }
      }
      const now = deps.clock.now();
      if (verdict === "clean") {
        await tx.update(files).set({ scanStatus: "clean", scannedAt: now }).where(eq(files.id, f.id));
        changed++;
      } else if (verdict === "infected") {
        await deps.fileStore.delete(f.storageKey);
        await tx
          .update(files)
          .set({ scanStatus: "infected", scannedAt: now, deletedAt: now })
          .where(eq(files.id, f.id));
        await recordAudit(tx, deps, systemAuditContext(f.orgId, "system", "file-scanner"), {
          action: "file.infected_removed",
          targetType: "file",
          targetId: f.id,
          meta: { purpose: f.purpose },
        });
        await notify(tx, deps, {
          orgId: f.orgId,
          recipients: [f.uploadedByMembershipId],
          kind: "security_notice",
          title: "A receipt you uploaded was removed",
          body: `The virus scanner flagged ${f.originalName}. Upload a different file.`,
          link: "/claims",
        });
        changed++;
      } else {
        const attempts = f.scanAttempts + 1;
        await tx
          .update(files)
          .set({
            scanAttempts: sql`${files.scanAttempts} + 1`,
            ...(attempts >= MAX_SCAN_ATTEMPTS ? { scanStatus: "scan_failed" as const, scannedAt: now } : {}),
          })
          .where(eq(files.id, f.id));
        if (attempts >= MAX_SCAN_ATTEMPTS) changed++;
      }
    }
    return changed;
  });
}
