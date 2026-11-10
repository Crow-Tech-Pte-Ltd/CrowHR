import { type Db, schema } from "@crowhr/core";
import { and, count, eq, getTableColumns, inArray, is, type SQL, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

/**
 * Copies one organisation, and only that organisation, from a scratch database into another
 * database with the same schema, in one transaction: every tenant table filtered by `org_id`,
 * the organisation row, and the global `users` (and their `recovery_codes`) that the
 * organisation's memberships point to. Install-wide tables (settings, backups, throttling, the
 * key check) are never copied. Rows keep their IDs, so encrypted fields, file keys and the audit
 * hash chain stay valid. Nothing in the target is updated or deleted except the copied rows'
 * own self-references, which are filled in after their insert.
 *
 * Used by the sample-company seed (scripts/seed-sample-company.ts): the company's history is
 * produced in a scratch database, where the scheduled sweeps can run without touching anyone
 * else's data, and then lands in the server's database all at once or not at all.
 */

/** Install-wide tables that belong to no organisation and are never copied. */
const INSTALL_TABLES = new Set(["auth_throttle", "backup_runs", "secret_key_checks", "system_settings"]);

interface TableInfo {
  name: string;
  table: PgTable;
  columns: Record<string, ReturnType<typeof getTableColumns>[string]>;
  /** JS keys of columns that reference this same table (filled in after the insert). */
  selfRefs: string[];
  parents: Set<string>;
}

function tablesOf(): TableInfo[] {
  const infos = new Map<string, TableInfo>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    const columns = getTableColumns(value);
    const byDbName = new Map(Object.entries(columns).map(([key, col]) => [col.name, key]));
    const selfRefs = new Set<string>();
    const parents = new Set<string>();
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      const parent = getTableConfig(ref.foreignTable).name;
      if (parent === config.name) {
        for (const col of ref.columns) if (col.name !== "org_id") selfRefs.add(byDbName.get(col.name) as string);
      } else {
        parents.add(parent);
      }
    }
    infos.set(config.name, { name: config.name, table: value, columns, selfRefs: [...selfRefs], parents });
  }
  // Parents before children (the schema has no cycles apart from self-references).
  const ordered: TableInfo[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string) => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "visiting") throw new Error(`Foreign keys form a cycle through ${name}`);
    state.set(name, "visiting");
    const info = infos.get(name);
    if (!info) throw new Error(`Unknown table ${name}`);
    for (const parent of info.parents) visit(parent);
    state.set(name, "done");
    ordered.push(info);
  };
  for (const name of [...infos.keys()].sort()) visit(name);
  return ordered;
}

// biome-ignore lint/suspicious/noExplicitAny: drizzle columns of any table.
type AnyColumn = any;

/** Which rows of `info` belong to the organisation; null for install-wide tables. */
async function scopeOf(db: Db, info: TableInfo, orgId: string): Promise<SQL | null> {
  const col = (key: string) => info.columns[key] as AnyColumn;
  if (info.name === "organisations") return eq(col("id"), orgId);
  if (info.columns.orgId) return eq(col("orgId"), orgId);
  if (INSTALL_TABLES.has(info.name)) return null;
  const userIds = (
    await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(eq(schema.memberships.orgId, orgId))
  ).map((r) => r.userId);
  if (info.name === "users") return userIds.length ? inArray(col("id"), userIds) : sql`false`;
  if (info.name === "recovery_codes") return userIds.length ? inArray(col("userId"), userIds) : sql`false`;
  throw new Error(`Table ${info.name} has no org_id and is not handled by the organisation copy. Update it.`);
}

export class OrganisationCopyRefused extends Error {
  override name = "OrganisationCopyRefused";
}

/**
 * Refuses (throws OrganisationCopyRefused) when the target already has an organisation with this
 * slug or ID, or a user with one of the given emails: the copy only ever adds new rows.
 */
export async function assertOrganisationIsNew(
  target: Db,
  org: { id?: string; slug: string },
  emails: readonly string[],
): Promise<void> {
  const orgs = await target
    .select({ id: schema.organisations.id, slug: schema.organisations.slug })
    .from(schema.organisations);
  if (orgs.some((o) => o.slug === org.slug)) {
    throw new OrganisationCopyRefused(
      `An organisation with the slug "${org.slug}" already exists on this server. Nothing was changed.`,
    );
  }
  if (org.id && orgs.some((o) => o.id === org.id)) {
    throw new OrganisationCopyRefused(`Organisation ${org.id} already exists on this server. Nothing was changed.`);
  }
  const lower = emails.map((e) => e.toLowerCase());
  if (lower.length) {
    const taken = await target
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(inArray(sql`lower(${schema.users.email})`, lower));
    if (taken.length) {
      throw new OrganisationCopyRefused(
        `${taken.length} of the sample company's email addresses already belong to users on this server (${taken
          .map((t) => t.email)
          .join(", ")}). Nothing was changed.`,
      );
    }
  }
}

async function publicTables(db: Db): Promise<string[]> {
  const res = (await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  )) as unknown as { rows: { table_name: string }[] };
  return res.rows.map((r) => r.table_name);
}

export interface CopyReport {
  /** Rows copied per table (tables with none are left out). */
  tables: Record<string, number>;
  total: number;
}

/**
 * Copies organisation `orgId` from `source` into `target` (same schema) in one transaction.
 * Throws, with the target unchanged, if anything fails or a refusal rule applies.
 */
export async function copyOrganisation(source: Db, target: Db, orgId: string): Promise<CopyReport> {
  const tables = tablesOf();
  const known = new Set(tables.map((t) => t.name));
  // A table outside the Drizzle schema would be silently skipped: refuse if it holds data.
  for (const name of await publicTables(source)) {
    if (known.has(name)) continue;
    const res = (await source.execute(
      sql.raw(`select count(*)::int as n from "${name.replace(/"/g, "")}"`),
    )) as unknown as {
      rows: { n: number }[];
    };
    if ((res.rows[0]?.n ?? 0) > 0) throw new Error(`Table ${name} is not in the schema the copy knows about.`);
  }

  const [org] = await source.select().from(schema.organisations).where(eq(schema.organisations.id, orgId));
  if (!org?.slug) throw new Error(`No organisation ${orgId} (with a slug) in the source database`);

  // Read everything first, so the target transaction is short.
  const plan: { info: TableInfo; rows: Record<string, unknown>[]; scope: SQL }[] = [];
  for (const info of tables) {
    const scope = await scopeOf(source, info, orgId);
    if (!scope) continue;
    const rows = (await source.select().from(info.table).where(scope)) as Record<string, unknown>[];
    plan.push({ info, rows, scope });
  }
  const emails = (plan.find((p) => p.info.name === "users")?.rows ?? []).map((u) => String(u.email));

  const report: CopyReport = { tables: {}, total: 0 };
  await target.transaction(async (tx) => {
    // Checked again inside the transaction; the unique constraints back this up.
    await assertOrganisationIsNew(tx as unknown as Db, { id: org.id, slug: org.slug as string }, emails);
    for (const { info, rows } of plan) {
      if (!rows.length) continue;
      const deferred: { id: unknown; values: Record<string, unknown> }[] = [];
      const insertRows = rows.map((row) => {
        if (!info.selfRefs.length) return row;
        const values: Record<string, unknown> = {};
        const copy = { ...row };
        for (const key of info.selfRefs) {
          if (copy[key] !== null && copy[key] !== undefined) values[key] = copy[key];
          copy[key] = null;
        }
        if (Object.keys(values).length) deferred.push({ id: row.id, values });
        return copy;
      });
      // Stay well under Postgres's 65 535 bind parameters per statement.
      const batch = Math.max(1, Math.floor(30_000 / Math.max(1, Object.keys(info.columns).length)));
      for (let i = 0; i < insertRows.length; i += batch) {
        // biome-ignore lint/suspicious/noExplicitAny: rows read from the same table definition.
        await tx.insert(info.table).values(insertRows.slice(i, i + batch) as any);
      }
      for (const d of deferred) {
        await tx
          .update(info.table)
          // biome-ignore lint/suspicious/noExplicitAny: self-reference columns of this table.
          .set(d.values as any)
          .where(and(eq(info.columns.id as AnyColumn, d.id), eq(info.columns.orgId as AnyColumn, orgId)));
      }
      report.tables[info.name] = rows.length;
      report.total += rows.length;
    }
    // Every table now holds exactly the source's rows for this organisation.
    for (const { info, rows, scope } of plan) {
      const [row] = await tx.select({ n: count() }).from(info.table).where(scope);
      if ((row?.n ?? 0) !== rows.length) {
        throw new Error(`Copy check failed for ${info.name}: ${row?.n} rows, expected ${rows.length}`);
      }
    }
  });
  return report;
}
