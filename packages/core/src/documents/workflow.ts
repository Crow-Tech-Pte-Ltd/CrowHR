import { employmentRecordRetention } from "@crowhr/sg-rules";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Role } from "../access/matrix.ts";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import {
  acknowledgementRequests,
  documentCategories,
  documentRequests,
  documentRetentionReviews,
  documents,
  documentVersions,
  letterTemplates,
} from "../db/schema/documents.ts";
import { employees, tenures } from "../db/schema/employees.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayDate } from "../employees/dates.ts";
import { displayName } from "../employees/records.ts";
import { AppError } from "../errors.ts";
import { approverDirectory } from "../workflows/directory.ts";
import type {
  DueReminder,
  InboxItem,
  ReminderSource,
  SubjectAdapter,
  Transition,
  WorkflowPlugin,
} from "../workflows/types.ts";
import type { DocActor } from "./access.ts";
import { ensureDocumentSetup } from "./defaults.ts";
import { addDaysIso, expiryThreshold } from "./expiry.ts";
import { fileGeneratedLetter, missingMessage, resolveLetter } from "./service.ts";

/**
 * Documents in workflows (add-documents specs "Expiry tracking", "Acknowledgements"; lead brief):
 * - reminders: expiry at 30 days, 7 days and on the day to hr_admins (and the employee when the
 *   category is visible to them); acknowledgement reminders after 3 and 7 days;
 * - Home: an employee's open acknowledgement requests;
 * - `document_request`: an employee asks for an employment letter, HR approves, and the letter is
 *   generated from the active "employment certificate" template in the approval's transaction;
 * - retention: the `tick` flags documents whose Employment Act keeping period has passed for HR to
 *   review. It never deletes anything.
 */

export const EXPIRY_THRESHOLDS = [30, 7, 0] as const;
export const ACK_REMINDER_DAYS = [3, 7] as const;

async function hrRecipients(db: Db, deps: AppDeps, orgId: string): Promise<string[]> {
  const dir = approverDirectory(deps);
  const active = async (role: "hr_admin" | "owner") =>
    (await dir.membersWithRole(db, orgId, role)).filter((m) => m.status === "active").map((m) => m.membershipId);
  const hr = await active("hr_admin");
  return hr.length ? hr : active("owner");
}

async function employeeMembers(db: Db, orgId: string, employeeId: string): Promise<string[]> {
  const rows = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.employeeId, employeeId), eq(memberships.status, "active")));
  return rows.map((r) => r.id);
}

/**
 * Current versions with an expiry date up to 30 days ahead (or past). A newer version, or a newer
 * document in the same category for the same employee with a later expiry, stops reminders for the
 * old one.
 */
export function documentExpiryReminderSource(deps: AppDeps): ReminderSource {
  return {
    id: "document_expiry",
    async due(db, { today }) {
      const rows = await db
        .select({ v: documentVersions, d: documents, c: documentCategories, e: employees })
        .from(documentVersions)
        .innerJoin(
          documents,
          and(eq(documents.orgId, documentVersions.orgId), eq(documents.currentVersionId, documentVersions.id)),
        )
        .innerJoin(
          documentCategories,
          and(eq(documentCategories.orgId, documents.orgId), eq(documentCategories.id, documents.categoryId)),
        )
        .innerJoin(employees, and(eq(employees.orgId, documents.orgId), eq(employees.id, documents.employeeId)))
        .where(
          and(
            isNull(documents.deletedAt),
            isNull(documents.purgedAt),
            sql`${documentVersions.expiresOn} is not null`,
            lte(documentVersions.expiresOn, addDaysIso(today, Math.max(...EXPIRY_THRESHOLDS))),
          ),
        );
      // A newer document (added later) for the same employee and category with a later expiry is a
      // renewal and stops the old document's reminders; an older one with a later expiry does not
      // (a long-valid certificate must not silence another one that is about to lapse).
      const employeeIds = [...new Set(rows.map((r) => r.d.employeeId))];
      const others = employeeIds.length
        ? await db
            .select({
              id: documents.id,
              orgId: documents.orgId,
              employeeId: documents.employeeId,
              categoryId: documents.categoryId,
              createdAt: documents.createdAt,
              expiresOn: sql<string | null>`${documentVersions.expiresOn}::text`,
            })
            .from(documents)
            .innerJoin(
              documentVersions,
              and(eq(documentVersions.orgId, documents.orgId), eq(documentVersions.id, documents.currentVersionId)),
            )
            .where(
              and(
                inArray(documents.employeeId, employeeIds),
                isNull(documents.deletedAt),
                isNull(documents.purgedAt),
                sql`${documentVersions.expiresOn} is not null`,
              ),
            )
        : [];
      const renewed = (r: (typeof rows)[number], expiresOn: string) =>
        others.some(
          (o) =>
            o.id !== r.d.id &&
            o.orgId === r.d.orgId &&
            o.employeeId === r.d.employeeId &&
            o.categoryId === r.d.categoryId &&
            o.createdAt > r.d.createdAt &&
            (o.expiresOn ?? "") > expiresOn,
        );
      const hrByOrg = new Map<string, string[]>();
      const out: DueReminder[] = [];
      for (const r of rows) {
        const expiresOn = r.v.expiresOn as string;
        if (renewed(r, expiresOn)) continue;
        const threshold = expiryThreshold(today, expiresOn, EXPIRY_THRESHOLDS);
        if (threshold === null) continue;
        let hr = hrByOrg.get(r.d.orgId);
        if (!hr) {
          hr = await hrRecipients(db, deps, r.d.orgId);
          hrByOrg.set(r.d.orgId, hr);
        }
        const recipients = new Set(hr);
        if (r.c.employeeVisible)
          for (const m of await employeeMembers(db, r.d.orgId, r.d.employeeId)) recipients.add(m);
        const name = displayName(r.e);
        out.push({
          orgId: r.d.orgId,
          subjectKey: r.v.id,
          threshold: `d${threshold}`,
          dueOn: expiresOn,
          recipients: [...recipients],
          kind: "document_expiry",
          title: `${name}'s ${r.d.title} ${threshold === 0 ? "expires today" : `expires on ${displayDate(expiresOn)}`}`,
          link: `/documents?open=${r.d.id}`,
          concerns: name,
        });
      }
      return out;
    },
  };
}

export function acknowledgementReminderSource(): ReminderSource {
  return {
    id: "document_acknowledgement",
    async due(db, { today }) {
      const rows = await db
        .select({ r: acknowledgementRequests, d: documents })
        .from(acknowledgementRequests)
        .innerJoin(
          documents,
          and(eq(documents.orgId, acknowledgementRequests.orgId), eq(documents.id, acknowledgementRequests.documentId)),
        )
        .where(
          and(
            isNull(acknowledgementRequests.acknowledgedAt),
            isNull(documents.deletedAt),
            eq(documents.currentVersionId, acknowledgementRequests.documentVersionId),
          ),
        );
      const out: DueReminder[] = [];
      for (const { r, d } of rows) {
        const requested = singaporeDate(r.requestedAt);
        const reached = ACK_REMINDER_DAYS.filter((n) => addDaysIso(requested, n) <= today);
        if (!reached.length) continue;
        const days = Math.max(...reached);
        out.push({
          orgId: r.orgId,
          subjectKey: r.id,
          threshold: `d${days}`,
          dueOn: addDaysIso(requested, days),
          recipients: await employeeMembers(db, r.orgId, r.employeeId),
          kind: "acknowledgement_requested",
          title: `Reminder: please read and acknowledge ${d.title}`,
          link: `/documents?open=${d.id}`,
          concerns: null,
        });
      }
      return out;
    },
  };
}

/** Home: the employee's documents waiting for acknowledgement. */
export const acknowledgementInbox = {
  id: "document_acknowledgements",
  label: "Documents to acknowledge",
  status: async () => "ready" as const,
  async list(db: Db, ctx: { orgId: string; employeeId: string | null; now: Date }): Promise<InboxItem[]> {
    if (!ctx.employeeId) return [];
    const rows = await db
      .select({ r: acknowledgementRequests, d: documents })
      .from(acknowledgementRequests)
      .innerJoin(
        documents,
        and(eq(documents.orgId, acknowledgementRequests.orgId), eq(documents.id, acknowledgementRequests.documentId)),
      )
      .where(
        and(
          eq(acknowledgementRequests.orgId, ctx.orgId),
          eq(acknowledgementRequests.employeeId, ctx.employeeId),
          isNull(acknowledgementRequests.acknowledgedAt),
          isNull(documents.deletedAt),
          eq(documents.currentVersionId, acknowledgementRequests.documentVersionId),
        ),
      )
      .orderBy(asc(acknowledgementRequests.requestedAt));
    return rows.map(({ r, d }) => ({
      id: `acknowledgement:${r.id}`,
      source: "document_acknowledgements",
      kind: "acknowledgement",
      title: `Read and acknowledge: ${d.title}`,
      concerns: null,
      detail: `Requested ${displayDate(singaporeDate(r.requestedAt))}`,
      dueOn: null,
      createdAt: r.requestedAt.toISOString(),
      href: `/documents?open=${d.id}`,
      actionLabel: "Open and acknowledge",
      task: null,
    }));
  },
};

const requestAttributes = z.object({ typeCode: z.literal("employment_certificate") });

function documentRequestAdapter(deps: AppDeps): SubjectAdapter<z.output<typeof requestAttributes>> {
  const load = async (db: Db, orgId: string, id: string) => {
    const [row] = await db
      .select()
      .from(documentRequests)
      .where(and(eq(documentRequests.orgId, orgId), eq(documentRequests.id, id)));
    if (!row) throw new AppError("not_found", "That document request no longer exists.");
    return row;
  };
  return {
    type: "document_request",
    label: "Employment letter",
    attributes: requestAttributes,
    defaultSteps: [{ approverRule: "role:hr_admin", escalateAfterDays: 3 }],
    inlineDecision: true,
    async summary(db, ref) {
      const req = await load(db, ref.orgId, ref.subjectId);
      const [emp] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.orgId, ref.orgId), eq(employees.id, req.employeeId)));
      return {
        title: "Employment letter request",
        lines: [
          { label: "For", value: emp ? displayName(emp) : "" },
          { label: "Purpose", value: req.purpose ?? "Not given" },
        ],
        context: [
          {
            label: "What happens next",
            value: "Approving generates the letter from the employment certificate template.",
          },
        ],
      };
    },
    async onApproved(db, ref, decision) {
      const req = await load(db, ref.orgId, ref.subjectId);
      await ensureDocumentSetup(db, deps.ids, ref.orgId);
      const [template] = await db
        .select()
        .from(letterTemplates)
        .where(
          and(
            eq(letterTemplates.orgId, ref.orgId),
            eq(letterTemplates.kind, "employment_certificate"),
            eq(letterTemplates.active, true),
          ),
        )
        .orderBy(asc(letterTemplates.createdAt))
        .limit(1);
      if (!template)
        throw new AppError(
          "conflict",
          "There is no active employment certificate template. Add one in Settings → Documents.",
        );
      const [decider] = await db
        .select({ name: users.displayName, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, ref.orgId), eq(memberships.id, decision.decidedByMembershipId)));
      const roleRows = await db
        .select({ role: membershipRoles.role })
        .from(membershipRoles)
        .where(
          and(eq(membershipRoles.orgId, ref.orgId), eq(membershipRoles.membershipId, decision.decidedByMembershipId)),
        );
      const roles = new Set<Role>(roleRows.map((r) => r.role));
      const audit = {
        ...systemAuditContext(ref.orgId, "system", "document request"),
        actorType: "member" as const,
        actorMembershipId: decision.decidedByMembershipId,
      };
      const actor: DocActor & { canReadSalary(id: string): Promise<boolean> } = {
        orgId: ref.orgId,
        org: orgScope(db, ref.orgId),
        userId: "",
        membershipId: decision.decidedByMembershipId,
        employeeId: null,
        displayName: decider?.name || decider?.email || "HR",
        roles,
        team: async () => new Set(),
        audit,
        ip: null,
        userAgent: null,
        canReadSalary: async () => roles.has("owner") || roles.has("payroll_admin"),
      };
      const input = {
        templateId: template.id,
        employeeId: req.employeeId,
        overrides: {
          "terms.purpose": req.purpose ?? "general reference",
          "signatory.title": "for and on behalf of the employer",
        },
        requestAcknowledgement: false,
        dryRun: false,
      };
      const r = await resolveLetter(deps, actor, db, input);
      if (r.missing.length) throw new AppError("missing_fields", missingMessage(r.missing), { missing: r.missing });
      const documentId = await fileGeneratedLetter(db, deps, actor, r, input);
      await db
        .update(documentRequests)
        .set({ status: "approved", decidedAt: decision.decidedAt, documentId })
        .where(and(eq(documentRequests.orgId, ref.orgId), eq(documentRequests.id, req.id)));
    },
    async onRejected(db, ref, decision) {
      await db
        .update(documentRequests)
        .set({ status: "rejected", decidedAt: decision.decidedAt })
        .where(and(eq(documentRequests.orgId, ref.orgId), eq(documentRequests.id, ref.subjectId)));
    },
    async onWithdrawn(db, ref) {
      await db
        .update(documentRequests)
        .set({ status: "withdrawn" })
        .where(and(eq(documentRequests.orgId, ref.orgId), eq(documentRequests.id, ref.subjectId)));
    },
    async canRead(_db, viewer) {
      return viewer.roles.includes("owner") || viewer.roles.includes("hr_admin");
    },
    link: () => "/documents",
  };
}

/**
 * Retention review (research/sg-regulatory.md §7, §11.2): documents of ex-employees are flagged once
 * the category's months after the last working day have passed (Employment Act: 12). One open flag
 * per document; a "keep" decision flags it again from its keep-until date. Flags only.
 */
export function retentionTransition(deps: AppDeps): Transition {
  return {
    id: "documents.retention_review",
    async run(db, { now }) {
      const today = singaporeDate(now);
      const rows = await db
        .select({
          d: documents,
          c: documentCategories,
          lwd: sql<string | null>`max(${tenures.lastWorkingDay})::text`,
          current: sql<number>`count(*) filter (where ${tenures.lastWorkingDay} is null or ${tenures.lastWorkingDay} >= ${today})::int`,
        })
        .from(documents)
        .innerJoin(
          documentCategories,
          and(eq(documentCategories.orgId, documents.orgId), eq(documentCategories.id, documents.categoryId)),
        )
        .innerJoin(tenures, and(eq(tenures.orgId, documents.orgId), eq(tenures.employeeId, documents.employeeId)))
        .where(
          and(
            isNull(documents.deletedAt),
            isNull(documents.purgedAt),
            sql`${documentCategories.retentionMonthsAfterExit} is not null`,
          ),
        )
        .groupBy(documents.id, documentCategories.id);
      let flagged = 0;
      for (const { d, c, lwd, current } of rows) {
        if (Number(current) > 0 || !lwd) continue;
        const months = c.retentionMonthsAfterExit as number;
        const base = employmentRecordRetention({ asAt: today, lastWorkingDay: lwd });
        // Categories may keep longer than the statutory 12 months (e.g. tax records).
        const reviewFrom = months === base.afterLeavingMonths ? (base.reviewFrom as string) : addMonthsIso(lwd, months);
        if (reviewFrom > today) continue;
        const [lastKeep] = await db
          .select({
            keepUntil: documentRetentionReviews.keepUntil,
            open: sql<number>`count(*) filter (where ${documentRetentionReviews.resolvedAt} is null)::int`,
          })
          .from(documentRetentionReviews)
          .where(and(eq(documentRetentionReviews.orgId, d.orgId), eq(documentRetentionReviews.documentId, d.id)))
          .groupBy(documentRetentionReviews.keepUntil)
          .orderBy(sql`${documentRetentionReviews.keepUntil} desc nulls last`)
          .limit(1);
        if (lastKeep && (Number(lastKeep.open) > 0 || !lastKeep.keepUntil || lastKeep.keepUntil > today)) continue;
        const inserted = await db.transaction(async (tx) => {
          const res = await tx
            .insert(documentRetentionReviews)
            .values({
              id: deps.ids.newId(),
              orgId: d.orgId,
              documentId: d.id,
              reason: `Employee left on ${displayDate(lwd)}; the ${months}-month keeping period after leaving has passed.`,
              reviewFrom,
              flaggedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (res.length) {
            await recordAudit(tx, deps, systemAuditContext(d.orgId, "system", "retention review"), {
              action: "document.retention_flagged",
              targetType: "document",
              targetId: d.id,
              meta: { reviewFrom },
            });
          }
          return res.length;
        });
        flagged += inserted;
      }
      return flagged;
    },
  };
}

function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function documentsWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return {
    name: "documents",
    subjects: [documentRequestAdapter(deps)],
    inbox: [acknowledgementInbox],
    reminders: [documentExpiryReminderSource(deps), acknowledgementReminderSource()],
    transitions: [retentionTransition(deps)],
  };
}
