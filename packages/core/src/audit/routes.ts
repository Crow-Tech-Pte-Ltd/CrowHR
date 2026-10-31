import { and, asc, desc, eq, gte, like, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { listQuery, pageOf, toLimitOffset } from "../http/list.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { auditCategorySql, auditContext, recordAudit } from "./audit.ts";

const event = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  at: z.iso.datetime(),
  actorType: z.enum(["member", "system", "cli", "anonymous"]),
  actorMembershipId: z.uuid().nullable(),
  actorLabel: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  requestId: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  diff: z.unknown().nullable(),
  meta: z.unknown().nullable(),
});

const filters = {
  actor: z.uuid().optional().meta({ description: "Actor membership ID." }),
  action: z
    .string()
    .trim()
    .max(100)
    .optional()
    .meta({ description: "Exact action, or a prefix ending in `.` (e.g. `auth.`)." }),
  targetType: z.string().trim().max(50).optional(),
  targetId: z.string().trim().max(100).optional(),
  from: z.iso.date({ error: "Use the date format YYYY-MM-DD, like 2026-10-01." }).optional(),
  to: z.iso.date({ error: "Use the date format YYYY-MM-DD, like 2026-10-31." }).optional(),
};

type Filters = { actor?: string; action?: string; targetType?: string; targetId?: string; from?: string; to?: string };

/** Read rules (spec "Audit log access"): owners all; hr_admin minus security and payroll; payroll_admin payroll only. */
function visibility(c: AppContext): SQL | undefined {
  const roles = c.get("auth")?.roles ?? [];
  if (roles.includes("owner")) return undefined;
  const parts: SQL[] = [];
  if (roles.includes("hr_admin"))
    parts.push(sql`not ${auditCategorySql("security")} and not ${auditCategorySql("payroll")}`);
  if (roles.includes("payroll_admin")) parts.push(auditCategorySql("payroll"));
  return parts.length ? (or(...parts) as SQL) : sql`false`;
}

/** Singapore calendar dates → UTC instants (UTC+8). */
const sgStart = (d: string) => new Date(`${d}T00:00:00+08:00`);
const sgNextDay = (d: string) => new Date(sgStart(d).getTime() + 86_400_000);

function where(c: AppContext, orgId: string, f: Filters): SQL {
  const conds: (SQL | undefined)[] = [eq(auditEvents.orgId, orgId), visibility(c)];
  if (f.actor) conds.push(eq(auditEvents.actorMembershipId, f.actor));
  if (f.action)
    conds.push(
      f.action.endsWith(".")
        ? like(auditEvents.action, `${f.action.replace(/[%_]/g, "")}%`)
        : eq(auditEvents.action, f.action),
    );
  if (f.targetType) conds.push(eq(auditEvents.targetType, f.targetType));
  if (f.targetId) conds.push(eq(auditEvents.targetId, f.targetId));
  if (f.from) conds.push(gte(auditEvents.at, sgStart(f.from)));
  if (f.to) conds.push(lt(auditEvents.at, sgNextDay(f.to)));
  return and(...conds) as SQL;
}

function toOut(r: typeof auditEvents.$inferSelect): z.input<typeof event> {
  return { ...r, at: r.at.toISOString(), diff: r.diff ?? null, meta: r.meta ?? null };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const auditModule = defineModule({
  name: "audit",
  basePath: "/audit-events",
  tag: "Audit log",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "Search the audit log",
      description:
        "hr_admins do not see security-settings, SSO or payroll events; payroll_admins see payroll, compensation and bank events only.",
      access: { permission: "audit_log:read" },
      request: { query: listQuery({ sort: ["at"], defaultSort: "-at", filters }) },
      responses: { 200: pageOf(event) },
      handler: async ({ c, deps, auth, query }) => {
        const w = where(c, auth.orgId, query);
        const [count] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(auditEvents).where(w);
        const rows = await deps.db
          .select()
          .from(auditEvents)
          .where(w)
          .orderBy(query.sort === "at" ? asc(auditEvents.seq) : desc(auditEvents.seq))
          .limit(toLimitOffset(query).limit)
          .offset(toLimitOffset(query).offset);
        return { items: rows.map(toOut), page: query.page, pageSize: query.pageSize, total: count?.n ?? 0 };
      },
    }),
    defineRoute({
      method: "get",
      path: "/export.csv",
      summary: "Export the audit log as CSV (same filters and visibility)",
      access: { permission: "audit_log:export" },
      request: { query: z.object(filters) },
      responses: { 200: { description: "CSV file.", contentType: "text/csv" } },
      handler: async ({ c, deps, auth, query }) => {
        const rows = await deps.db
          .select()
          .from(auditEvents)
          .where(where(c, auth.orgId, query))
          .orderBy(asc(auditEvents.seq))
          .limit(50_000);
        const header = [
          "seq",
          "at",
          "actor_type",
          "actor",
          "action",
          "target_type",
          "target_id",
          "ip",
          "request_id",
          "diff",
          "meta",
        ];
        const lines = [header.join(",")];
        for (const r of rows) {
          lines.push(
            [
              r.seq,
              r.at.toISOString(),
              r.actorType,
              r.actorLabel ?? r.actorMembershipId,
              r.action,
              r.targetType,
              r.targetId,
              r.ip,
              r.requestId,
              r.diff,
              r.meta,
            ]
              .map(csvCell)
              .join(","),
          );
        }
        await recordAudit(deps.db, deps, auditContext(c), {
          action: "audit_log.exported",
          targetType: "audit_log",
          targetId: null,
          meta: { rows: rows.length, filters: query },
        });
        return new Response(`${lines.join("\r\n")}\r\n`, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="crowhr-audit-${deps.clock.now().toISOString().slice(0, 10)}.csv"`,
            "cache-control": "no-store",
          },
        });
      },
    }),
  ],
});
