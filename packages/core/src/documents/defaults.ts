import { RECORD_RETENTION_RULES } from "@crowhr/sg-rules";
import { and, eq } from "drizzle-orm";
import { type DocumentCategoryKey, documentCategories, letterTemplates } from "../db/schema/documents.ts";
import type { Db } from "../db/types.ts";
import type { IdGenerator } from "../deps.ts";
import { DEFAULT_TEMPLATES, defaultCategoryKey } from "./templates.ts";

/**
 * Default document categories (add-documents spec "Document categories" table) and letter
 * templates, created the first time an organisation uses documents. Idempotent: rows are keyed by
 * `system_key` / template name, and an existing row is never changed.
 *
 * Retention: Employment Act records are kept 12 months after the employee leaves (MOM "Employment
 * records", sg-rules `RECORD_RETENTION_RULES`), so every category is flagged for review from then.
 */
const AFTER_EXIT = RECORD_RETENTION_RULES[RECORD_RETENTION_RULES.length - 1]?.afterLeavingMonths ?? 12;

export const DEFAULT_CATEGORIES: readonly {
  key: DocumentCategoryKey;
  name: string;
  sensitivity: "normal" | "medical";
  employeeVisible: boolean;
  managerVisible: boolean;
  employeeUploadable: boolean;
  auditViews: boolean;
}[] = [
  {
    key: "contract",
    name: "Contract & KETs",
    sensitivity: "normal",
    employeeVisible: true,
    managerVisible: false,
    employeeUploadable: false,
    auditViews: false,
  },
  {
    key: "identity",
    name: "Identity & work pass",
    sensitivity: "normal",
    employeeVisible: true,
    managerVisible: false,
    employeeUploadable: true,
    auditViews: true,
  },
  {
    key: "certificates",
    name: "Certificates & licences",
    sensitivity: "normal",
    employeeVisible: true,
    managerVisible: true,
    employeeUploadable: true,
    auditViews: false,
  },
  {
    key: "medical",
    name: "Medical",
    sensitivity: "medical",
    employeeVisible: true,
    managerVisible: false,
    employeeUploadable: true,
    auditViews: true,
  },
  {
    key: "letters",
    name: "Letters",
    sensitivity: "normal",
    employeeVisible: true,
    managerVisible: false,
    employeeUploadable: false,
    auditViews: false,
  },
  {
    key: "other",
    name: "Other",
    sensitivity: "normal",
    employeeVisible: false,
    managerVisible: false,
    employeeUploadable: false,
    auditViews: false,
  },
];

const done = new WeakMap<object, Set<string>>();

export async function ensureDocumentSetup(db: Db, ids: IdGenerator, orgId: string): Promise<void> {
  const seen = done.get(db) ?? new Set<string>();
  if (seen.has(orgId)) return;
  const existing = await db.select().from(documentCategories).where(eq(documentCategories.orgId, orgId));
  const byKey = new Map(existing.filter((c) => c.systemKey).map((c) => [c.systemKey, c]));
  let position = 0;
  for (const d of DEFAULT_CATEGORIES) {
    position += 10;
    if (byKey.has(d.key)) continue;
    const id = ids.newId();
    await db
      .insert(documentCategories)
      .values({
        id,
        orgId,
        systemKey: d.key,
        name: d.name,
        sensitivity: d.sensitivity,
        employeeVisible: d.employeeVisible,
        managerVisible: d.managerVisible,
        payrollVisible: false,
        employeeUploadable: d.employeeUploadable,
        auditViews: d.auditViews,
        retentionMonthsAfterExit: AFTER_EXIT,
        position,
      })
      .onConflictDoNothing();
    const [row] = await db
      .select()
      .from(documentCategories)
      .where(and(eq(documentCategories.orgId, orgId), eq(documentCategories.systemKey, d.key)));
    if (row) byKey.set(d.key, row);
  }
  const templates = await db
    .select({ name: letterTemplates.name })
    .from(letterTemplates)
    .where(eq(letterTemplates.orgId, orgId));
  const names = new Set(templates.map((t) => t.name));
  for (const t of DEFAULT_TEMPLATES) {
    if (names.has(t.name)) continue;
    const category = byKey.get(defaultCategoryKey(t.kind));
    if (!category) continue;
    await db
      .insert(letterTemplates)
      .values({ id: ids.newId(), orgId, kind: t.kind, name: t.name, bodyMd: t.body, targetCategoryId: category.id })
      .onConflictDoNothing();
  }
  seen.add(orgId);
  done.set(db, seen);
}
