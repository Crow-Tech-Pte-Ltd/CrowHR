import { eq } from "drizzle-orm";
import {
  acknowledgementRequests,
  documentCategories,
  documentRequests,
  documentRetentionReviews,
  documents,
  documentVersions,
  documentViews,
  letterTemplates,
} from "../db/schema/documents.ts";
import { employees } from "../db/schema/employees.ts";
import { files } from "../db/schema/files.ts";
import type { AppDeps } from "../deps.ts";

/**
 * One row in every documents table for `orgId` (cross-org sweep, access/cross-org.test.ts): the
 * default categories and templates, a document with a version and its file, a view, an
 * acknowledgement request, a letter request and a retention review. Needs an employee.
 */
export async function seedDocumentsOnePerTable(deps: AppDeps, orgId: string, membershipId: string) {
  const [employee] = await deps.db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .limit(1);
  if (!employee) throw new Error("seedDocumentsOnePerTable needs an employee in the organisation");
  // One category and one template (not the full defaults): every ID here multiplies the sweep.
  const category = { id: deps.ids.newId() };
  const template = { id: deps.ids.newId() };
  await deps.db
    .insert(documentCategories)
    .values({ id: category.id, orgId, systemKey: "letters", name: "Letters", employeeVisible: true });
  await deps.db
    .insert(letterTemplates)
    .values({ id: template.id, orgId, kind: "custom", name: "Sweep", bodyMd: "Hello", targetCategoryId: category.id });
  const now = deps.clock.now();
  const fileId = deps.ids.newId();
  const documentId = deps.ids.newId();
  const versionId = deps.ids.newId();
  await deps.db.insert(files).values({
    id: fileId,
    orgId,
    purpose: "document",
    sha256: "c".repeat(64),
    mime: "application/pdf",
    sizeBytes: 10,
    storageKey: `org/${orgId}/files/${fileId}.pdf`,
    originalName: "letter.pdf",
    scanStatus: "unscanned",
    ownerEmployeeId: employee.id,
    uploadedByMembershipId: membershipId,
    createdAt: now,
  });
  await deps.db.insert(documents).values({
    id: documentId,
    orgId,
    employeeId: employee.id,
    categoryId: category.id,
    title: "Sweep letter",
    createdByMembershipId: membershipId,
  });
  await deps.db.insert(documentVersions).values({
    id: versionId,
    orgId,
    documentId,
    version: 1,
    fileId,
    fileSha256: "c".repeat(64),
    source: "generated",
    templateId: template.id,
    templateVersion: 1,
    uploadedByMembershipId: membershipId,
  });
  await deps.db.update(documents).set({ currentVersionId: versionId }).where(eq(documents.id, documentId));
  await deps.db.insert(documentViews).values({ orgId, documentVersionId: versionId, membershipId, firstViewedAt: now });
  await deps.db.insert(acknowledgementRequests).values({
    id: deps.ids.newId(),
    orgId,
    documentId,
    documentVersionId: versionId,
    employeeId: employee.id,
    requestedByMembershipId: membershipId,
    requestedAt: now,
  });
  await deps.db.insert(documentRequests).values({
    id: deps.ids.newId(),
    orgId,
    employeeId: employee.id,
    kind: "employment_certificate",
    purpose: "Sweep",
    requestedByMembershipId: membershipId,
  });
  await deps.db.insert(documentRetentionReviews).values({
    id: deps.ids.newId(),
    orgId,
    documentId,
    reason: "Sweep",
    reviewFrom: "2026-01-01",
    flaggedAt: now,
  });
}
