import { and, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { memberships } from "../db/schema/access.ts";
import { recoveryCodes } from "../db/schema/auth.ts";
import { employees } from "../db/schema/employees.ts";
import { files } from "../db/schema/files.ts";
import { companyProfiles } from "../db/schema/organisation.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import { INSTALL_TABLES, tablesInDependencyOrder } from "../db/table-order.ts";
import type { AppDeps } from "../deps.ts";

/**
 * Deletes one expired demo company with everything in it (design decision 8): every
 * organisation-scoped row (children first: the copy's table order, reversed), its memberships,
 * the users who belong to no other organisation, its device sessions and audit events, then its
 * files under `org/<orgId>/`. One transaction; the files go after it commits.
 *
 * The transaction names the organisation with `SET LOCAL crowhr.purge_demo_org`, the only way the
 * audit trigger lets audit events be deleted, and only while that organisation's demo expiry is
 * set and past. An organisation without a demo expiry is never touched: the function re-reads the
 * row under a lock and returns null.
 */
export async function purgeDemoCompany(
  deps: Pick<AppDeps, "db" | "fileStore" | "logger">,
  orgId: string,
  now: Date,
): Promise<{ rows: number; files: number } | null> {
  const fileKeys = new Set<string>();
  const rows = await deps.db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organisations.id, expiresAt: organisations.demoExpiresAt })
      .from(organisations)
      .where(eq(organisations.id, orgId))
      .for("update");
    if (!org?.expiresAt || org.expiresAt > now) return null;
    await tx.execute(sql`select set_config('crowhr.purge_demo_org', ${orgId}, true)`);

    for (const f of await tx.select({ key: files.storageKey }).from(files).where(eq(files.orgId, orgId))) {
      fileKeys.add(f.key);
    }
    for (const p of await tx
      .select({ key: companyProfiles.logoFileKey })
      .from(companyProfiles)
      .where(and(eq(companyProfiles.orgId, orgId), isNotNull(companyProfiles.logoFileKey)))) {
      if (p.key) fileKeys.add(p.key);
    }
    for (const e of await tx
      .select({ key: employees.photoFileKey })
      .from(employees)
      .where(and(eq(employees.orgId, orgId), isNotNull(employees.photoFileKey)))) {
      if (e.key) fileKeys.add(e.key);
    }
    const userIds = (
      await tx.select({ id: memberships.userId }).from(memberships).where(eq(memberships.orgId, orgId))
    ).map((r) => r.id);

    let total = 0;
    for (const info of [...tablesInDependencyOrder()].reverse()) {
      if (info.name === "organisations" || info.name === "users" || info.name === "recovery_codes") continue;
      if (INSTALL_TABLES.has(info.name)) continue;
      const orgColumn = info.columns.orgId;
      if (!orgColumn) {
        throw new Error(`Table ${info.name} has no org_id, so the demo-company purge can't clear it. Update purge.ts.`);
      }
      const deleted = await tx
        .delete(info.table)
        // biome-ignore lint/suspicious/noExplicitAny: the org_id column of any tenant table.
        .where(eq(orgColumn as any, orgId))
        .returning({ one: sql`1` });
      total += deleted.length;
    }
    // People of this demo company only: nobody else can be a member of one (invitations are
    // refused there), but a user with another membership is kept all the same.
    if (userIds.length) {
      const orphans = (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              inArray(users.id, userIds),
              notExists(tx.select({ one: sql`1` }).from(memberships).where(eq(memberships.userId, users.id))),
            ),
          )
      ).map((u) => u.id);
      if (orphans.length) {
        await tx.delete(recoveryCodes).where(inArray(recoveryCodes.userId, orphans));
        total += (await tx.delete(users).where(inArray(users.id, orphans)).returning({ id: users.id })).length;
      }
    }
    await tx.delete(organisations).where(eq(organisations.id, orgId));
    return total + 1;
  });
  if (rows === null) return null;
  for (const key of fileKeys) {
    if (!key.startsWith(`org/${orgId}/`)) continue;
    await deps.fileStore.delete(key).catch((err: unknown) => {
      deps.logger.warn("Could not delete a demo company's file", { orgId, key, error: String(err) });
    });
  }
  await deps.fileStore.deletePrefix?.(`org/${orgId}/`).catch((err: unknown) => {
    deps.logger.warn("Could not delete a demo company's files", { orgId, error: String(err) });
  });
  return { rows, files: [...fileKeys].filter((k) => k.startsWith(`org/${orgId}/`)).length };
}
