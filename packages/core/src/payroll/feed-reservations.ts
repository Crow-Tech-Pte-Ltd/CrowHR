import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { type PayrollRun, payrollFeedReservations, payrollPayslips, payrollRuns } from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";
import type { PayInput } from "./engine/types.ts";

export const isPayFeed = (id: string, kind: string) =>
  (kind === "overtime" && id.startsWith("attendance:")) || id.startsWith("holiday:") || id.startsWith("encashment:");

/** Includes legacy snapshots, so upgrading does not make previously paid OT payable again. */
export async function unavailableFeeds(db: Db, run: PayrollRun, chain: string[]): Promise<Set<string>> {
  const org = orgScope(db, run.orgId);
  const allowed = new Set([run.id, ...chain]);
  const rows = await db.select().from(payrollFeedReservations).where(org.where(payrollFeedReservations));
  const unavailable = new Set(rows.filter((r) => !allowed.has(r.runId)).map((r) => r.sourceId));
  const legacy = await db
    .select({ runId: payrollPayslips.runId, input: payrollPayslips.input })
    .from(payrollPayslips)
    .innerJoin(
      payrollRuns,
      and(eq(payrollRuns.orgId, payrollPayslips.orgId), eq(payrollRuns.id, payrollPayslips.runId)),
    )
    .where(
      org.where(
        payrollPayslips,
        isNull(payrollRuns.supersededByRunId),
        // Only payslips with a fed item (`isPayFeed`), rather than every snapshot ever computed.
        sql`exists (select 1 from jsonb_array_elements(${payrollPayslips.input}->'items') as item
                     where (item->>'kind' = 'overtime' and item->>'id' like 'attendance:%')
                        or item->>'id' like 'holiday:%' or item->>'id' like 'encashment:%')`,
      ),
    );
  for (const s of legacy)
    if (!allowed.has(s.runId))
      for (const item of s.input.items) if (isPayFeed(item.id, item.kind)) unavailable.add(item.id);
  return unavailable;
}

export async function reserveFeeds(tx: Db, run: PayrollRun, inputs: PayInput[], chain: string[]) {
  const org = orgScope(tx, run.orgId);
  const feeds = inputs.flatMap((i) =>
    i.items
      .filter((item) => isPayFeed(item.id, item.kind))
      .map((item) => ({ sourceId: item.id, employeeId: i.employee.id })),
  );
  await tx
    .delete(payrollFeedReservations)
    .where(org.where(payrollFeedReservations, eq(payrollFeedReservations.runId, run.id)));
  if (!feeds.length) return;
  // Deterministic lock order; a conflicting reservation makes the whole computation roll back.
  await tx
    .insert(payrollFeedReservations)
    .values(
      feeds
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
        .map((f) => ({ ...f, orgId: run.orgId, runId: run.id })),
    )
    .onConflictDoNothing();
  const holders = await tx
    .select()
    .from(payrollFeedReservations)
    .where(
      org.where(
        payrollFeedReservations,
        inArray(
          payrollFeedReservations.sourceId,
          feeds.map((f) => f.sourceId),
        ),
      ),
    );
  if (holders.length !== feeds.length || holders.some((r) => r.runId !== run.id && !chain.includes(r.runId))) {
    throw new AppError(
      "conflict",
      "Another payroll run reserved an earning while this run was computed. Recompute and review this run.",
    );
  }
}
