import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import {
  type ChecklistAssigneeRole,
  type ChecklistKind,
  checklistItems,
  checklists,
  checklistTemplateItems,
  checklistTemplates,
  employees,
  employmentRecords,
  workPasses,
} from "../db/schema/employees.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps, IdGenerator } from "../deps.ts";
import { AppError } from "../errors.ts";
import { type Actor, assertCanRead, assertCanWrite, hasAnyRole } from "./access.ts";
import { recordAudit } from "./audit-helpers.ts";
import { addDays, displayDate, singaporeToday } from "./dates.ts";
import type { PeoplePorts } from "./ports.ts";
import { parseInput } from "./validation.ts";

const ROLES = ["hr_admin", "payroll_admin", "manager", "employee"] as const;

export const templateInput = z.object({
  kind: z.enum(["onboarding", "offboarding"]),
  name: z.string().trim().min(1, "Name the checklist, like Standard onboarding.").max(80),
  isDefault: z.boolean().optional(),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1, "Give the item a title.").max(160),
        assigneeRole: z.enum(ROLES),
        dueOffsetDays: z.number().int().min(-365).max(365),
      }),
    )
    .min(1, "Add at least one item.")
    .max(60),
});

/**
 * The offboarding item that only applies to someone holding a work pass. It is left off the
 * checklist of a leaver without one (the old title is still recognised in stored templates).
 */
export const WORK_PASS_ITEM = "Cancel work pass";
const WORK_PASS_ITEMS = new Set([WORK_PASS_ITEM, "Cancel work pass (foreign employees)"]);

/** Defaults offered on first use; HR edits them in Settings. Product defaults, not statutory. */
export const DEFAULT_TEMPLATES: z.input<typeof templateInput>[] = [
  {
    kind: "onboarding",
    name: "Standard onboarding",
    isDefault: true,
    items: [
      { title: "Issue KETs", assigneeRole: "hr_admin", dueOffsetDays: 14 },
      { title: "Add bank details", assigneeRole: "payroll_admin", dueOffsetDays: 0 },
      { title: "Set up workstation and accounts", assigneeRole: "manager", dueOffsetDays: 0 },
      { title: "Complete personal particulars", assigneeRole: "employee", dueOffsetDays: 3 },
    ],
  },
  {
    kind: "offboarding",
    name: "Standard offboarding",
    isDefault: true,
    items: [
      { title: "Collect company property", assigneeRole: "manager", dueOffsetDays: 0 },
      { title: "Prepare final pay and leave encashment", assigneeRole: "payroll_admin", dueOffsetDays: -3 },
      { title: WORK_PASS_ITEM, assigneeRole: "hr_admin", dueOffsetDays: 7 },
      { title: "Revoke system access", assigneeRole: "hr_admin", dueOffsetDays: 1 },
    ],
  },
];

export interface ChecklistTemplateView {
  id: string;
  kind: ChecklistKind;
  name: string;
  isDefault: boolean;
  items: { title: string; assigneeRole: ChecklistAssigneeRole; dueOffsetDays: number }[];
}

export async function listTemplates(deps: AppDeps, actor: Actor): Promise<ChecklistTemplateView[]> {
  const ts = await deps.db
    .select()
    .from(checklistTemplates)
    .where(actor.org.where(checklistTemplates))
    .orderBy(asc(checklistTemplates.kind), asc(checklistTemplates.name));
  const items = await deps.db
    .select()
    .from(checklistTemplateItems)
    .where(actor.org.where(checklistTemplateItems))
    .orderBy(asc(checklistTemplateItems.position));
  return ts
    .filter((t) => !t.archivedAt)
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      isDefault: t.isDefault,
      items: items
        .filter((i) => i.templateId === t.id)
        .map((i) => ({ title: i.title, assigneeRole: i.assigneeRole, dueOffsetDays: i.dueOffsetDays })),
    }));
}

export async function createTemplate(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  raw: unknown,
): Promise<ChecklistTemplateView> {
  assertCanWrite(actor, "employment");
  const input = parseInput(templateInput, raw);
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    await insertTemplate(tx, deps.ids, actor.orgId, id, input);
    await recordAudit(tx, ports, actor, {
      action: "checklist_template.created",
      targetType: "checklist_template",
      targetId: id,
      meta: { kind: input.kind, name: input.name, items: input.items.length },
    });
  });
  const found = (await listTemplates(deps, actor)).find((t) => t.id === id);
  if (!found) throw new AppError("internal", "Template was not saved.");
  return found;
}

async function insertTemplate(
  tx: Db,
  ids: IdGenerator,
  orgId: string,
  id: string,
  input: z.output<typeof templateInput>,
): Promise<void> {
  const org = orgScope(tx, orgId);
  if (input.isDefault) {
    await tx
      .update(checklistTemplates)
      .set({ isDefault: false })
      .where(org.where(checklistTemplates, eq(checklistTemplates.kind, input.kind)));
  }
  await tx
    .insert(checklistTemplates)
    .values({ id, orgId, kind: input.kind, name: input.name, isDefault: input.isDefault ?? false });
  await tx.insert(checklistTemplateItems).values(
    input.items.map((item, position) => ({
      id: ids.newId(),
      orgId,
      templateId: id,
      title: item.title,
      assigneeRole: item.assigneeRole,
      dueOffsetDays: item.dueOffsetDays,
      position,
    })),
  );
}

/** Creates the default templates for an organisation that has none of that kind. */
export async function ensureDefaultTemplates(tx: Db, ids: IdGenerator, orgId: string): Promise<void> {
  const org = orgScope(tx, orgId);
  const existing = await tx
    .select({ kind: checklistTemplates.kind })
    .from(checklistTemplates)
    .where(org.where(checklistTemplates));
  for (const t of DEFAULT_TEMPLATES) {
    if (existing.some((e) => e.kind === t.kind)) continue;
    await insertTemplate(tx, ids, orgId, ids.newId(), templateInput.parse(t));
  }
}

/**
 * Instantiates the default template of `kind` for an event. Due dates are the
 * anchor (start date or last working day) plus each item's offset.
 */
export async function instantiateChecklist(
  tx: Db,
  ids: IdGenerator,
  input: { orgId: string; employeeId: string; eventId: string; kind: ChecklistKind; anchorDate: string },
): Promise<string | null> {
  await ensureDefaultTemplates(tx, ids, input.orgId);
  const org = orgScope(tx, input.orgId);
  const [template] = await tx
    .select()
    .from(checklistTemplates)
    .where(
      org.where(checklistTemplates, eq(checklistTemplates.kind, input.kind), eq(checklistTemplates.isDefault, true)),
    );
  if (!template) return null;
  const all = await tx
    .select()
    .from(checklistTemplateItems)
    .where(org.where(checklistTemplateItems, eq(checklistTemplateItems.templateId, template.id)))
    .orderBy(asc(checklistTemplateItems.position));
  // A leaver without a work pass (a citizen or PR) has no pass to cancel.
  const holdsPass =
    input.kind !== "offboarding" ||
    (
      await tx
        .select({ id: workPasses.id })
        .from(workPasses)
        .where(org.where(workPasses, eq(workPasses.employeeId, input.employeeId), isNull(workPasses.cancelledOn)))
        .limit(1)
    ).length > 0;
  const items = holdsPass ? all : all.filter((i) => !WORK_PASS_ITEMS.has(i.title));
  const id = ids.newId();
  await tx.insert(checklists).values({
    id,
    orgId: input.orgId,
    employeeId: input.employeeId,
    eventId: input.eventId,
    templateId: template.id,
    kind: input.kind,
    anchorDate: input.anchorDate,
  });
  if (items.length) {
    await tx.insert(checklistItems).values(
      items.map((i) => ({
        id: ids.newId(),
        orgId: input.orgId,
        checklistId: id,
        title: i.title,
        assigneeRole: i.assigneeRole,
        dueOn: addDays(input.anchorDate, i.dueOffsetDays),
        position: i.position,
      })),
    );
  }
  return id;
}

/** Cancelling the triggering event cancels its checklist and its open items. */
export async function cancelChecklistsForEvent(tx: Db, orgId: string, eventId: string): Promise<void> {
  const org = orgScope(tx, orgId);
  const lists = await tx
    .select({ id: checklists.id })
    .from(checklists)
    .where(org.where(checklists, eq(checklists.eventId, eventId)));
  if (!lists.length) return;
  const ids = lists.map((l) => l.id);
  await tx.update(checklists).set({ status: "cancelled" }).where(inArray(checklists.id, ids));
  await tx
    .update(checklistItems)
    .set({ status: "cancelled" })
    .where(and(inArray(checklistItems.checklistId, ids), eq(checklistItems.status, "open")));
}

export interface ChecklistView {
  id: string;
  kind: ChecklistKind;
  status: "open" | "cancelled";
  anchorDate: string;
  items: {
    id: string;
    title: string;
    assigneeRole: ChecklistAssigneeRole;
    dueOn: string;
    status: "open" | "done" | "skipped" | "cancelled";
    skipReason: string | null;
    doneAt: string | null;
  }[];
}

export async function employeeChecklists(deps: AppDeps, actor: Actor, employeeId: string): Promise<ChecklistView[]> {
  await assertCanRead(actor, "checklists", employeeId);
  const lists = await deps.db
    .select()
    .from(checklists)
    .where(actor.org.where(checklists, eq(checklists.employeeId, employeeId)))
    .orderBy(asc(checklists.createdAt));
  if (!lists.length) return [];
  const items = await deps.db
    .select()
    .from(checklistItems)
    .where(
      actor.org.where(
        checklistItems,
        inArray(
          checklistItems.checklistId,
          lists.map((l) => l.id),
        ),
      ),
    )
    .orderBy(asc(checklistItems.position));
  return lists.map((l) => ({
    id: l.id,
    kind: l.kind,
    status: l.status,
    anchorDate: l.anchorDate,
    items: items
      .filter((i) => i.checklistId === l.id)
      .map((i) => ({
        id: i.id,
        title: i.title,
        assigneeRole: i.assigneeRole,
        dueOn: i.dueOn,
        status: i.status,
        skipReason: i.skipReason,
        doneAt: i.doneAt ? i.doneAt.toISOString() : null,
      })),
  }));
}

/** Whether the actor holds the item's assignee role for this employee. Owners can act on any item. */
async function holdsAssigneeRole(actor: Actor, role: ChecklistAssigneeRole, employeeId: string): Promise<boolean> {
  if (actor.roles.has("owner")) return true;
  if (role === "hr_admin" || role === "payroll_admin") return actor.roles.has(role);
  if (role === "employee") return actor.employeeId === employeeId;
  return actor.employeeId !== null && (await actor.team()).has(employeeId);
}

export const completeItemInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done") }),
  z.object({ action: z.literal("skip"), reason: z.string().trim().min(1, "Say why this item is skipped.").max(300) }),
  z.object({ action: z.literal("reopen") }),
]);

export async function updateChecklistItem(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  itemId: string,
  raw: unknown,
) {
  const input = parseInput(completeItemInput, raw);
  const [row] = await deps.db
    .select({ item: checklistItems, employeeId: checklists.employeeId })
    .from(checklistItems)
    .innerJoin(
      checklists,
      and(eq(checklists.orgId, checklistItems.orgId), eq(checklists.id, checklistItems.checklistId)),
    )
    .where(actor.org.whereId(checklistItems, itemId));
  if (!row) throw new AppError("not_found", "No such checklist item.");
  await assertCanRead(actor, "checklists", row.employeeId);
  if (!(await holdsAssigneeRole(actor, row.item.assigneeRole, row.employeeId))) {
    throw new AppError(
      "forbidden",
      `Only the assigned ${row.item.assigneeRole.replace("_", " ")} can update this item.`,
    );
  }
  if (row.item.status === "cancelled") throw new AppError("conflict", "This checklist was cancelled with its event.");
  const now = deps.clock.now();
  const set =
    input.action === "done"
      ? { status: "done" as const, doneBy: actor.userId, doneAt: now, skipReason: null }
      : input.action === "skip"
        ? { status: "skipped" as const, doneBy: actor.userId, doneAt: now, skipReason: input.reason }
        : { status: "open" as const, doneBy: null, doneAt: null, skipReason: null };
  await deps.db.transaction(async (tx) => {
    await tx.update(checklistItems).set(set).where(eq(checklistItems.id, itemId));
    await recordAudit(tx, ports, actor, {
      action: `checklist_item.${input.action === "done" ? "completed" : input.action === "skip" ? "skipped" : "reopened"}`,
      targetType: "checklist_item",
      targetId: itemId,
      meta: input.action === "skip" ? { reason: input.reason } : undefined,
    });
  });
}

export interface ChecklistInboxItem {
  itemId: string;
  employeeId: string;
  title: string;
  dueOn: string;
  kind: ChecklistKind;
}

/**
 * Open checklist items assigned to the actor, as Home inbox items
 * ("Issue KETs: Tan Mei Ling", due 15 Dec 2026). Shaped for the workflows
 * `InboxSource` interface once it lands (WS3).
 */
export async function checklistInbox(deps: AppDeps, actor: Actor): Promise<ChecklistInboxItem[]> {
  // The team as at today, plus future starters whose upcoming record names the actor as manager.
  const team = new Set(await actor.team());
  if (actor.employeeId) {
    const upcoming = await deps.db
      .select({ id: employmentRecords.employeeId })
      .from(employmentRecords)
      .where(
        actor.org.where(
          employmentRecords,
          eq(employmentRecords.managerEmployeeId, actor.employeeId),
          or(
            isNull(employmentRecords.effectiveTo),
            gt(employmentRecords.effectiveTo, singaporeToday(deps.clock.now())),
          ),
        ),
      );
    for (const u of upcoming) team.add(u.id);
  }
  // Only the items this member acts on are loaded: every open item of the organisation grows with
  // each hire and leaver, and this runs on every Home load.
  const assigned = [
    hasAnyRole(actor, ["hr_admin"]) ? eq(checklistItems.assigneeRole, "hr_admin") : undefined,
    hasAnyRole(actor, ["payroll_admin"]) ? eq(checklistItems.assigneeRole, "payroll_admin") : undefined,
    actor.employeeId
      ? and(eq(checklistItems.assigneeRole, "employee"), eq(checklists.employeeId, actor.employeeId))
      : undefined,
    team.size > 0
      ? and(eq(checklistItems.assigneeRole, "manager"), inArray(checklists.employeeId, [...team]))
      : undefined,
  ].filter((c) => c !== undefined);
  if (assigned.length === 0) return [];
  const rows = await deps.db
    .select({
      itemId: checklistItems.id,
      title: checklistItems.title,
      dueOn: checklistItems.dueOn,
      employeeId: checklists.employeeId,
      kind: checklists.kind,
      name: employees.legalName,
    })
    .from(checklistItems)
    .innerJoin(
      checklists,
      and(eq(checklists.orgId, checklistItems.orgId), eq(checklists.id, checklistItems.checklistId)),
    )
    .innerJoin(employees, and(eq(employees.orgId, checklists.orgId), eq(employees.id, checklists.employeeId)))
    .where(actor.org.where(checklistItems, eq(checklistItems.status, "open"), or(...assigned)))
    .orderBy(asc(checklistItems.dueOn), asc(employees.legalName), asc(checklistItems.position), asc(checklistItems.id));
  return rows.map((r) => ({
    itemId: r.itemId,
    employeeId: r.employeeId,
    title: `${r.title}: ${r.name}`,
    dueOn: r.dueOn,
    kind: r.kind,
  }));
}

export function describeDue(dueOn: string): string {
  return `due ${displayDate(dueOn)}`;
}
