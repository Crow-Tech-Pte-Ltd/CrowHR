import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organisations } from "./organisations.ts";

export const orgAppearance = pgTable("org_appearance", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organisations.id, { onDelete: "cascade" }),
  accent: text("accent"),
  logoBase64: text("logo_base64"),
  useDocumentLogo: boolean("use_document_logo").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
