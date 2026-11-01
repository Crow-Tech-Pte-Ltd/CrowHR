import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { claimLines, claims, claimTypes } from "../db/schema/claims.ts";
import type { Db } from "../db/types.ts";

/** Cash taxable reimbursements: IRAS Tax Principles and Flexible Benefits, research/sg-regulatory.md §8. */
export async function taxableCashClaims(db: Db, orgId: string, year: number, legacyPayrollClaimIds: string[]) {
  return db
    .select({ employeeId: claims.employeeId, cents: sql<string>`sum(${claimLines.sgdCents})::text` })
    .from(claims)
    .innerJoin(claimLines, and(eq(claimLines.orgId, claims.orgId), eq(claimLines.claimId, claims.id)))
    .innerJoin(claimTypes, and(eq(claimTypes.orgId, claimLines.orgId), eq(claimTypes.id, claimLines.claimTypeId)))
    .where(
      orgScope(db, orgId).where(
        claims,
        eq(claimTypes.taxable, true),
        or(
          and(
            eq(claims.status, "paid"),
            eq(claims.paidVia, "outside"),
            gte(claims.paidOn, `${year}-01-01`),
            lte(claims.paidOn, `${year}-12-31`),
          ),
          legacyPayrollClaimIds.length ? inArray(claims.id, legacyPayrollClaimIds) : undefined,
        ),
      ),
    )
    .groupBy(claims.employeeId);
}
