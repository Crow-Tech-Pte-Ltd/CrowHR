import { and, eq, getTableColumns, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { AuthContext } from "../context.ts";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";

/**
 * Org-scoped data access (access-control spec "Organisation data isolation"). Every query on a
 * tenant table goes through one of these so `org_id = <caller's org>` is never forgotten:
 *
 *   const org = orgScope(deps.db, auth);              // or orgScope(db, orgId)
 *   const rows = await deps.db.select().from(teams).where(org.where(teams, eq(teams.status, "active")));
 *   const team = await org.findById(teams, id);       // null when it belongs to another org
 *   const team = await org.getById(teams, id, "team"); // 404 not_found instead of null
 *   await deps.db.insert(teams).values(org.values({ id, name }));
 *   await deps.db.update(teams).set({ name }).where(org.whereId(teams, id));
 *
 * A record of another organisation is indistinguishable from a missing one (404).
 */

export type TenantTable = PgTable & { orgId: AnyPgColumn; id: AnyPgColumn };

export interface OrgScope {
  readonly orgId: string;
  /** `org_id = $orgId AND ...conditions`. */
  where(table: PgTable & { orgId: AnyPgColumn }, ...conditions: (SQL | undefined)[]): SQL;
  /** `org_id = $orgId AND id = $id`. */
  whereId(table: TenantTable, id: string): SQL;
  /** Sets `orgId` on an insert payload (overriding any value passed in). */
  values<T extends object>(values: T): T & { orgId: string };
  findById<T extends TenantTable>(table: T, id: string): Promise<T["$inferSelect"] | null>;
  getById<T extends TenantTable>(table: T, id: string, what?: string): Promise<T["$inferSelect"]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orgScope(db: Db, orgOrAuth: string | Pick<AuthContext, "orgId">): OrgScope {
  const orgId = typeof orgOrAuth === "string" ? orgOrAuth : orgOrAuth.orgId;
  if (!UUID.test(orgId)) throw new Error("orgScope needs an organisation id.");
  const scope: OrgScope = {
    orgId,
    where: (table, ...conditions) => and(eq(table.orgId, orgId), ...conditions) as SQL,
    whereId: (table, id) => and(eq(table.orgId, orgId), eq(table.id, id)) as SQL,
    values: (values) => ({ ...values, orgId }),
    async findById(table, id) {
      if (!UUID.test(id)) return null;
      // biome-ignore lint/suspicious/noExplicitAny: generic over any tenant table.
      const rows = await (db as any).select().from(table).where(scope.whereId(table, id)).limit(1);
      return rows[0] ?? null;
    },
    async getById(table, id, what = "record") {
      const row = await scope.findById(table, id);
      if (!row) throw new AppError("not_found", `That ${what} doesn't exist or you can't see it.`);
      return row;
    },
  };
  return scope;
}

/** True when the table has a non-null `org_id` column (used by the schema guard test). */
export function isTenantTable(table: PgTable): boolean {
  const columns = getTableColumns(table) as Record<string, AnyPgColumn>;
  const org = Object.values(columns).find((c) => c.name === "org_id");
  return !!org && org.notNull;
}
