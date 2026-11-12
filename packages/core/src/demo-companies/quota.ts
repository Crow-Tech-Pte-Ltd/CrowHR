import { and, eq, isNull, sql } from "drizzle-orm";
import { files } from "../db/schema/files.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { DEMO_COMPANY_DEFAULTS } from "./config.ts";

const MB = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

/**
 * Demo companies hold at most `uploadQuotaBytes` of uploads (receipts, documents, letters; design
 * decision 7). Real organisations are not limited here. Runs inside the upload's transaction.
 */
export async function assertDemoUploadQuota(
  deps: Pick<AppDeps, "demoCompanies">,
  db: Db,
  orgId: string,
  bytes: number,
) {
  const [org] = await db
    .select({ demo: organisations.demoExpiresAt })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  if (!org?.demo) return;
  const quota = deps.demoCompanies?.uploadQuotaBytes ?? DEMO_COMPANY_DEFAULTS.uploadQuotaBytes;
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` })
    .from(files)
    .where(and(eq(files.orgId, orgId), isNull(files.deletedAt)));
  const used = Number(row?.used ?? 0);
  if (used + bytes > quota) {
    throw new AppError(
      "file_too_large",
      `A demo company can hold ${MB(quota)} of uploads and this one already has ${MB(used)}, so this file doesn't fit. Delete a receipt or document you added, or start a new demo company.`,
      { quotaBytes: quota, usedBytes: used },
    );
  }
}
