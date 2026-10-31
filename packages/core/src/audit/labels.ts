import { eq, inArray } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { orgScope } from "../access/org-scope.ts";
import { memberships } from "../db/schema/access.ts";
import { ssoProviders } from "../db/schema/auth.ts";
import { allowanceTypes, checklistTemplates, employees } from "../db/schema/employees.ts";
import { costCentres, departments, locations, teams, workSchedules } from "../db/schema/organisation.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Named = PgTable & { orgId: AnyPgColumn; id: AnyPgColumn; name: AnyPgColumn };

/** Tenant tables whose rows carry a plain `name`, keyed by audit `target_type`. */
const NAMED: Record<string, Named> = {
  department: departments,
  team: teams,
  location: locations,
  cost_centre: costCentres,
  work_schedule: workSchedules,
  allowance_type: allowanceTypes,
  checklist_template: checklistTemplates,
};

/** One batched, org-scoped lookup per target type: id → label. */
type Resolver = (db: Db, orgId: string, ids: string[]) => Promise<[string, string][]>;

const RESOLVERS: Record<string, Resolver> = {
  membership: async (db, orgId, ids) => {
    const rows = await db
      .select({ id: memberships.id, name: users.displayName, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(orgScope(db, orgId).where(memberships, inArray(memberships.id, ids)));
    return rows.map((r) => [r.id, r.name || r.email]);
  },
  // Users are global: only label those who belong to this organisation.
  user: async (db, orgId, ids) => {
    const rows = await db
      .selectDistinct({ id: users.id, name: users.displayName, email: users.email })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(orgScope(db, orgId).where(memberships, inArray(users.id, ids)));
    return rows.map((r) => [r.id, r.name || r.email]);
  },
  employee: async (db, orgId, ids) => {
    const rows = await db
      .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
      .from(employees)
      .where(orgScope(db, orgId).where(employees, inArray(employees.id, ids)));
    return rows.map((r) => [r.id, r.preferredName || r.legalName]);
  },
  sso_provider: async (db, orgId, ids) => {
    const rows = await db
      .select({ id: ssoProviders.id, name: ssoProviders.displayName })
      .from(ssoProviders)
      .where(orgScope(db, orgId).where(ssoProviders, inArray(ssoProviders.id, ids)));
    return rows.map((r) => [r.id, r.name]);
  },
  organisation: async (db, orgId, ids) => {
    if (!ids.includes(orgId)) return [];
    const rows = await db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(eq(organisations.id, orgId));
    return rows.map((r) => [r.id, r.name]);
  },
  ...Object.fromEntries(
    Object.entries(NAMED).map(([type, table]): [string, Resolver] => [
      type,
      async (db, orgId, ids) => {
        const rows = (await db
          .select({ id: table.id, name: table.name })
          .from(table)
          .where(orgScope(db, orgId).where(table, inArray(table.id, ids)))) as { id: string; name: string }[];
        return rows.map((r) => [r.id, r.name]);
      },
    ]),
  ),
};

/**
 * Human labels for audit targets (member name, employee name, department name…), resolved with
 * one org-scoped query per target type present in `rows`. Targets that no longer exist, belong to
 * another organisation, or have no cheap name map to nothing; callers fall back to the type.
 */
export async function resolveTargetLabels(
  db: Db,
  orgId: string,
  rows: readonly { targetType: string; targetId: string | null }[],
): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.targetId || !UUID.test(r.targetId) || !RESOLVERS[r.targetType]) continue;
    const ids = byType.get(r.targetType) ?? new Set<string>();
    ids.add(r.targetId);
    byType.set(r.targetType, ids);
  }
  const labels = new Map<string, string>();
  const results = await Promise.all(
    [...byType].map(async ([type, ids]) => {
      const pairs = await (RESOLVERS[type] as Resolver)(db, orgId, [...ids]);
      return pairs.map(([id, label]) => [targetKey(type, id), label] as const);
    }),
  );
  for (const pairs of results) for (const [k, v] of pairs) labels.set(k, v);
  return labels;
}

export const targetKey = (type: string, id: string) => `${type}:${id.toLowerCase()}`;
