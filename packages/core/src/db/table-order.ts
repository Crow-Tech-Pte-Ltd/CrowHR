import { getTableColumns, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema/index.ts";

/**
 * Every table of the schema in foreign-key order (parents before children), derived from the
 * Drizzle definitions so a new table is picked up without a list to maintain. Used to copy one
 * organisation between databases (packages/demo sample company) and, in reverse, to delete one
 * (demo-company expiry, demo-companies/purge.ts).
 */

/** Install-wide tables that belong to no organisation. Never copied or deleted per organisation. */
export const INSTALL_TABLES: ReadonlySet<string> = new Set([
  "auth_throttle",
  "backup_runs",
  "secret_key_checks",
  "system_settings",
]);

export interface TableInfo {
  name: string;
  table: PgTable;
  columns: Record<string, ReturnType<typeof getTableColumns>[string]>;
  /** JS keys of columns that reference this same table. */
  selfRefs: string[];
  /** Names of the tables this one references (other than itself). */
  parents: Set<string>;
}

let cached: TableInfo[] | null = null;

export function tablesInDependencyOrder(): readonly TableInfo[] {
  if (cached) return cached;
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
  cached = ordered;
  return ordered;
}
