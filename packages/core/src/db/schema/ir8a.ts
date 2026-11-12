import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AppendixEntryDetails, AppendixEntryKind } from "../../payroll/files/ir8a-appendix-input.ts";
import { employees } from "./employees.ts";
import { organisations } from "./organisations.ts";

/**
 * IR8A Appendix 8A (benefits-in-kind) and Appendix 8B (share-plan gains) inputs, one row per entry
 * (add-ir8a-appendix-8a-8b design decision 1). `details` holds the entered values only, validated by
 * `ir8a-appendix-input.ts` on every write and read; computed values come from `@crowhr/sg-rules` on
 * read. Conventions as in `payroll.ts`: org_id, `unique (org_id, id)`, composite foreign keys.
 */
export const payrollIr8aAppendixEntries = pgTable(
  "payroll_ir8a_appendix_entries",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),
    /** Income year (Year of Assessment − 1). */
    year: integer("year").notNull(),
    kind: text("kind").$type<AppendixEntryKind>().notNull(),
    details: jsonb("details").$type<AppendixEntryDetails>().notNull(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payroll_ir8a_appendix_entries_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "payroll_ir8a_appendix_entries_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete("cascade"),
    index("payroll_ir8a_appendix_entries_year").on(t.orgId, t.year, t.employeeId),
  ],
);

export type PayrollIr8aAppendixEntry = typeof payrollIr8aAppendixEntries.$inferSelect;
