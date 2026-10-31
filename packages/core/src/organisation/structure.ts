import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { employmentRecords } from "../db/schema/employees.ts";
import { costCentres, departments, locations, teams } from "../db/schema/organisation.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { type Actor, assertCanWrite } from "../employees/access.ts";
import { diffOf, recordAudit } from "../employees/audit-helpers.ts";
import { singaporeToday } from "../employees/dates.ts";
import type { PeoplePorts } from "../employees/ports.ts";
import { fieldError, isUniqueViolation, parseInput } from "../employees/validation.ts";
import { AppError } from "../errors.ts";

export const STRUCTURE_KINDS = ["departments", "teams", "locations", "cost-centres"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

const name = z.string().trim().min(1, "Enter a name.").max(120);
const nullableText = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullish();

const inputs = {
  departments: z.object({ name, code: nullableText }),
  teams: z.object({ name, departmentId: z.uuid().nullish() }),
  locations: z.object({
    name,
    address: nullableText,
    postalCode: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || /^\d{6}$/.test(v), { message: "Enter a 6-digit Singapore postal code." })
      .nullish(),
  }),
  "cost-centres": z.object({ name, code: z.string().trim().min(1, "Enter a cost centre code, like CC-100.").max(30) }),
} as const;

const tables = {
  departments,
  teams,
  locations,
  "cost-centres": costCentres,
} as const;

const labels: Record<StructureKind, { one: string; column: keyof typeof employmentRecords.$inferSelect }> = {
  departments: { one: "department", column: "departmentId" },
  teams: { one: "team", column: "teamId" },
  locations: { one: "location", column: "locationId" },
  "cost-centres": { one: "cost centre", column: "costCentreId" },
};

export interface StructureItem {
  id: string;
  name: string;
  code?: string | null;
  departmentId?: string | null;
  address?: string | null;
  postalCode?: string | null;
  archived: boolean;
  archivedAt: string | null;
  /** Employees whose current or scheduled employment record uses this entry. */
  employeeCount: number;
}

type AnyRow = { id: string; name: string; archivedAt: Date | null } & Record<string, unknown>;

function toItem(kind: StructureKind, row: AnyRow, employeeCount: number): StructureItem {
  const base: StructureItem = {
    id: row.id,
    name: row.name,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    employeeCount,
  };
  if (kind === "departments" || kind === "cost-centres") base.code = (row.code as string | null) ?? null;
  if (kind === "teams") base.departmentId = (row.departmentId as string | null) ?? null;
  if (kind === "locations") {
    base.address = (row.address as string | null) ?? null;
    base.postalCode = (row.postalCode as string | null) ?? null;
  }
  return base;
}

/** Employees (distinct) whose employment record in force today or later references the entry. */
async function usageCounts(db: Db, orgId: string, kind: StructureKind, today: string): Promise<Map<string, number>> {
  const col = employmentRecords[labels[kind].column] as typeof employmentRecords.departmentId;
  const rows = await db
    .select({ id: col, n: sql<number>`count(distinct ${employmentRecords.employeeId})::int` })
    .from(employmentRecords)
    .where(
      and(
        eq(employmentRecords.orgId, orgId),
        or(isNull(employmentRecords.effectiveTo), gt(employmentRecords.effectiveTo, today)),
      ),
    )
    .groupBy(col);
  return new Map(rows.filter((r) => r.id).map((r) => [r.id as string, Number(r.n)]));
}

export async function listStructure(deps: AppDeps, actor: Actor, kind: StructureKind): Promise<StructureItem[]> {
  const table = tables[kind];
  const rows = (await deps.db
    .select()
    .from(table)
    .where(eq(table.orgId, actor.orgId))
    .orderBy(asc(table.name))) as AnyRow[];
  const counts = await usageCounts(deps.db, actor.orgId, kind, singaporeToday(deps.clock.now()));
  return rows.map((r) => toItem(kind, r, counts.get(r.id) ?? 0));
}

async function findRow(db: Db, kind: StructureKind, orgId: string, id: string): Promise<AnyRow> {
  const table = tables[kind];
  const [row] = (await db
    .select()
    .from(table)
    .where(and(eq(table.orgId, orgId), eq(table.id, id)))) as AnyRow[];
  if (!row) throw new AppError("not_found", `No such ${labels[kind].one}.`);
  return row;
}

function nameTaken(kind: StructureKind, err: unknown): never {
  if (isUniqueViolation(err)) {
    const codeClash = String((err as { cause?: { constraint?: string } })?.cause?.constraint ?? "").includes("code");
    throw new AppError(
      "conflict",
      codeClash
        ? `Another active ${labels[kind].one} already uses this code. Choose a different code.`
        : `Another active ${labels[kind].one} already has this name. Choose a different name.`,
      { reason: "name_taken" },
    );
  }
  throw err;
}

async function assertDepartmentSelectable(db: Db, orgId: string, departmentId: string | null | undefined) {
  if (!departmentId) return;
  const [d] = await db
    .select({ archivedAt: departments.archivedAt })
    .from(departments)
    .where(and(eq(departments.orgId, orgId), eq(departments.id, departmentId)));
  if (!d) throw fieldError("departmentId", "Choose an existing department.");
  if (d.archivedAt) throw fieldError("departmentId", "That department is archived. Choose an active one.");
}

export async function createStructure(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  kind: StructureKind,
  raw: unknown,
): Promise<StructureItem> {
  assertCanWrite(actor, "structure");
  const input = parseInput(inputs[kind], raw) as Record<string, unknown>;
  if (kind === "teams") await assertDepartmentSelectable(deps.db, actor.orgId, input.departmentId as string | null);
  const table = tables[kind];
  const id = deps.ids.newId();
  const row = await deps.db.transaction(async (tx) => {
    const [inserted] = (await tx
      .insert(table)
      // biome-ignore lint/suspicious/noExplicitAny: kind-specific insert shape validated by `inputs[kind]`.
      .values({ id, orgId: actor.orgId, ...input } as any)
      .returning()
      .catch((err: unknown) => nameTaken(kind, err))) as AnyRow[];
    await recordAudit(tx, ports, actor, {
      action: `${labels[kind].one.replace(" ", "_")}.created`,
      targetType: labels[kind].one.replace(" ", "_"),
      targetId: id,
      diff: diffOf(null, input),
    });
    return inserted;
  });
  return toItem(kind, row as AnyRow, 0);
}

export async function updateStructure(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  kind: StructureKind,
  id: string,
  raw: unknown,
): Promise<StructureItem> {
  assertCanWrite(actor, "structure");
  const before = await findRow(deps.db, kind, actor.orgId, id);
  const input = parseInput(inputs[kind].partial(), raw) as Record<string, unknown>;
  if (kind === "teams" && "departmentId" in input) {
    await assertDepartmentSelectable(deps.db, actor.orgId, input.departmentId as string | null);
  }
  const table = tables[kind];
  const row = await deps.db.transaction(async (tx) => {
    const [updated] = (await tx
      .update(table)
      // biome-ignore lint/suspicious/noExplicitAny: kind-specific update shape validated by `inputs[kind]`.
      .set({ ...input, updatedAt: deps.clock.now() } as any)
      .where(and(eq(table.orgId, actor.orgId), eq(table.id, id)))
      .returning()
      .catch((err: unknown) => nameTaken(kind, err))) as AnyRow[];
    await recordAudit(tx, ports, actor, {
      action: `${labels[kind].one.replace(" ", "_")}.updated`,
      targetType: labels[kind].one.replace(" ", "_"),
      targetId: id,
      diff: diffOf(before, input),
    });
    return updated;
  });
  const counts = await usageCounts(deps.db, actor.orgId, kind, singaporeToday(deps.clock.now()));
  return toItem(kind, row as AnyRow, counts.get(id) ?? 0);
}

export async function archiveStructure(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  kind: StructureKind,
  id: string,
  archived: boolean,
): Promise<StructureItem> {
  assertCanWrite(actor, "structure");
  await findRow(deps.db, kind, actor.orgId, id);
  const counts = await usageCounts(deps.db, actor.orgId, kind, singaporeToday(deps.clock.now()));
  const count = counts.get(id) ?? 0;
  if (archived && count > 0) {
    throw new AppError(
      "in_use",
      `${count} current employee${count === 1 ? " uses" : "s use"} this ${labels[kind].one}. Move them first, then archive it.`,
      {
        count,
        link: `/people?${labels[kind].column.replace("Id", "")}=${id}`,
      },
    );
  }
  const table = tables[kind];
  const row = await deps.db.transaction(async (tx) => {
    const [updated] = (await tx
      .update(table)
      .set({ archivedAt: archived ? deps.clock.now() : null, updatedAt: deps.clock.now() })
      .where(and(eq(table.orgId, actor.orgId), eq(table.id, id)))
      .returning()
      .catch((err: unknown) => nameTaken(kind, err))) as AnyRow[];
    await recordAudit(tx, ports, actor, {
      action: `${labels[kind].one.replace(" ", "_")}.${archived ? "archived" : "restored"}`,
      targetType: labels[kind].one.replace(" ", "_"),
      targetId: id,
    });
    return updated;
  });
  return toItem(kind, row as AnyRow, count);
}

/**
 * For employment records: the referenced entry exists in this organisation
 * and is not archived. Returns a field-level validation error otherwise.
 */
export async function assertSelectable(
  db: Db,
  orgId: string,
  kind: StructureKind,
  id: string | null | undefined,
  field: string,
): Promise<void> {
  if (!id) return;
  const table = tables[kind];
  const [row] = (await db
    .select({ archivedAt: table.archivedAt })
    .from(table)
    .where(and(eq(table.orgId, orgId), eq(table.id, id)))) as { archivedAt: Date | null }[];
  if (!row) throw fieldError(field, `Choose an existing ${labels[kind].one}.`);
  if (row.archivedAt) throw fieldError(field, `That ${labels[kind].one} is archived. Choose an active one.`);
}
