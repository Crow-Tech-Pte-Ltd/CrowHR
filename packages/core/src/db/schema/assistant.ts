import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { memberships } from "./access.ts";
import { organisations } from "./organisations.ts";

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" });
const time = (name: string) => timestamp(name, { withTimezone: true });

export const orgAssistantSettings = pgTable("org_assistant_settings", {
  orgId: orgId().primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
});

export const assistantGrants = pgTable(
  "assistant_grants",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    resource: text("resource").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    challenge: text("challenge").notNull(),
    codeHash: text("code_hash"),
    accessHash: text("access_hash"),
    accessExpiresAt: time("access_expires_at"),
    refreshHash: text("refresh_hash"),
    priorRefreshHash: text("prior_refresh_hash"),
    connectedAt: time("connected_at"),
    expiresAt: time("expires_at").notNull(),
    authenticatedAt: time("authenticated_at").notNull(),
    authMethod: text("auth_method").notNull(),
    mfaSatisfied: boolean("mfa_satisfied").notNull(),
  },
  (t) => [
    uniqueIndex("assistant_grants_code").on(t.codeHash),
    uniqueIndex("assistant_grants_access").on(t.accessHash),
    uniqueIndex("assistant_grants_refresh").on(t.refreshHash),
    index("assistant_grants_prior_refresh").on(t.priorRefreshHash),
    index("assistant_grants_member").on(t.orgId, t.membershipId),
  ],
);
