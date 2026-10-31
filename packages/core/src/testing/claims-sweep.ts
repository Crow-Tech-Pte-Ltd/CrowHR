import { eq } from "drizzle-orm";
import { claimLineFiles, claimLines, claimSettings, claims, claimTypes } from "../db/schema/claims.ts";
import { employees } from "../db/schema/employees.ts";
import { files, orgCounters } from "../db/schema/files.ts";
import type { AppDeps } from "../deps.ts";

/**
 * One row in each claims table for `orgId` (cross-org sweep, access/cross-org.test.ts). Needs at
 * least one employee in the organisation. Returns the IDs it created.
 */
export async function seedClaimsOnePerTable(deps: AppDeps, orgId: string, membershipId: string) {
  const [employee] = await deps.db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .limit(1);
  if (!employee) throw new Error("seedClaimsOnePerTable needs an employee in the organisation");
  const now = deps.clock.now();
  const typeId = deps.ids.newId();
  const claimId = deps.ids.newId();
  const draftId = deps.ids.newId();
  const lineId = deps.ids.newId();
  const fileId = deps.ids.newId();
  await deps.db.insert(claimTypes).values({
    id: typeId,
    orgId,
    code: "TRANSPORT",
    name: "Transport",
    category: "transport",
    receiptRule: "never",
    capPeriod: "none",
  });
  await deps.db.insert(claimSettings).values({ orgId, submissionWindowDays: 90 });
  await deps.db.insert(orgCounters).values({ orgId, name: "claim_number", nextValue: 2 });
  for (const [id, status, number] of [
    [claimId, "submitted", "C-0001"],
    [draftId, "draft", null],
  ] as const) {
    await deps.db.insert(claims).values({
      id,
      orgId,
      employeeId: employee.id,
      claimNumber: number,
      status,
      totalCents: 1850,
      createdByMembershipId: membershipId,
      submittedAt: status === "submitted" ? now : null,
    });
  }
  await deps.db.insert(claimLines).values({
    id: lineId,
    orgId,
    claimId,
    position: 1,
    claimTypeId: typeId,
    expenseDate: "2026-10-30",
    merchant: "Grab",
    description: "B's taxi",
    currency: "SGD",
    currencyExponent: 2,
    amountMinor: 1850,
    sgdCents: 1850,
  });
  const storageKey = `org/${orgId}/files/${fileId}.png`;
  await deps.fileStore.put(storageKey, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
    contentType: "image/png",
  });
  await deps.db.insert(files).values({
    id: fileId,
    orgId,
    purpose: "claim_receipt",
    sha256: "0".repeat(64),
    mime: "image/png",
    sizeBytes: 8,
    storageKey,
    originalName: "b.png",
    scanStatus: "unscanned",
    ownerEmployeeId: employee.id,
    uploadedByMembershipId: membershipId,
  });
  await deps.db.insert(claimLineFiles).values({ orgId, claimLineId: lineId, fileId, position: 1 });
  return { typeId, claimId, draftId, lineId, fileId };
}
