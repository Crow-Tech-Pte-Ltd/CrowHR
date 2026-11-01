import { and, asc, eq, sql } from "drizzle-orm";
import type { AppContext } from "../context.ts";
import { sha256Hex } from "../crypto/tokens.ts";
import { memberships } from "../db/schema/access.ts";
import { auditEvents, auditHeads } from "../db/schema/audit.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";

/**
 * Append-only audit log (access-control spec "Audit events", "Audit log immutability").
 *
 *   await recordAudit(tx, auditContext(c), {
 *     action: "compensation.updated", targetType: "employee", targetId: employeeId,
 *     diff: diffFields(before, after, { sensitive: ["basicPayCents"] }),
 *   });
 *
 * Pass the transaction that makes the domain change: the event commits with it or not at all.
 * Events are chained per organisation (`hash = sha256(canonical(event) incl. prevHash)`) under a
 * row lock on `audit_heads`, and the database rejects UPDATE/DELETE.
 */

export type ActorType = "member" | "system" | "cli" | "anonymous";

export interface AuditContext {
  orgId: string;
  actorType: ActorType;
  actorMembershipId: string | null;
  actorLabel: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** `{ field: { from, to } }`, or `{ field: { changed: true } }` for sensitive fields. */
export type AuditDiff = Record<string, { from?: unknown; to?: unknown; changed?: true }>;

export interface AuditEventInput {
  action: string;
  targetType: string;
  targetId?: string | null;
  diff?: AuditDiff | null;
  /** Context such as a failure reason. Keys that look like secrets are dropped. */
  meta?: Record<string, unknown> | null;
  /** Override the organisation (e.g. a sign-in failure before any session exists). */
  orgId?: string;
}

/** Keys never written to `diff` values or `meta`: passwords, tokens, secrets, TOTP and recovery codes. */
const SECRET_KEY = /pass(word)?|token|secret|totp|otp|recovery|code_?verifier|private|jwks|cookie|^code$/i;

/** The client IP as seen by core. Hosts set `x-crowhr-client-ip` after applying TRUSTED_PROXIES. */
export function clientIp(c: AppContext): string | null {
  return c.req.header("x-crowhr-client-ip") ?? null;
}

/** Audit context for the current request: the signed-in member, or anonymous for public routes. */
export function auditContext(c: AppContext, orgId?: string): AuditContext {
  const auth = c.get("auth");
  const org = orgId ?? auth?.orgId;
  if (!org) throw new Error("auditContext needs an organisation: pass orgId for unauthenticated events.");
  return {
    orgId: org,
    actorType: auth ? "member" : "anonymous",
    actorMembershipId: auth?.membershipId ?? null,
    actorLabel: auth?.user.email ?? null,
    requestId: c.get("requestId") ?? null,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent")?.slice(0, 400) ?? null,
  };
}

/** Audit context for background jobs and the server CLI. */
export function systemAuditContext(orgId: string, actorType: "system" | "cli", label: string): AuditContext {
  return {
    orgId,
    actorType,
    actorMembershipId: null,
    actorLabel: label,
    requestId: null,
    ip: null,
    userAgent: null,
  };
}

/**
 * Field-level diff of two flat records. `sensitive` fields record only that they changed;
 * secret-looking fields are never recorded at all.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: Partial<T> | null,
  after: Partial<T> | null,
  options: { sensitive?: readonly (keyof T & string)[]; ignore?: readonly (keyof T & string)[] } = {},
): AuditDiff {
  const out: AuditDiff = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (options.ignore?.includes(key)) continue;
    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    out[key] = options.sensitive?.includes(key) || SECRET_KEY.test(key) ? { changed: true } : { from, to };
  }
  return out;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

function sanitizeDiff(diff: AuditDiff | null | undefined): AuditDiff | null {
  if (!diff) return null;
  const out: AuditDiff = {};
  for (const [k, v] of Object.entries(diff)) {
    out[k] = SECRET_KEY.test(k) ? { changed: true } : (sanitize(v) as AuditDiff[string]);
  }
  return out;
}

/** JSON with object keys sorted at every level: the hashed representation. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

interface HashedFields {
  id: string;
  orgId: string;
  seq: number;
  at: string;
  actorType: string;
  actorMembershipId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  diff: unknown;
  meta: unknown;
  prevHash: string;
}

export function hashEvent(fields: HashedFields): Promise<string> {
  return sha256Hex(canonicalJson(fields));
}

export const GENESIS_HASH = "0".repeat(64);

/** Records one audit event inside `db` (a transaction is opened if `db` is not already one). */
export async function recordAudit(
  db: Db,
  deps: Pick<AppDeps, "clock" | "ids">,
  ctx: AuditContext,
  input: AuditEventInput,
): Promise<{ id: string; seq: number; hash: string }> {
  const orgId = input.orgId ?? ctx.orgId;
  // Unauthenticated events about a membership (sign-in attempts, invitation acceptance): label
  // them with the account concerned so the log reads "who", while the actor type stays anonymous.
  if (ctx.actorType === "anonymous" && !ctx.actorLabel && input.targetType === "membership" && input.targetId) {
    const [row] = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, input.targetId), eq(memberships.orgId, orgId)));
    if (row) ctx = { ...ctx, actorLabel: row.email };
  }
  return db.transaction(async (tx) => {
    await tx.insert(auditHeads).values({ orgId, lastSeq: 0, lastHash: GENESIS_HASH }).onConflictDoNothing();
    const [head] = await tx.select().from(auditHeads).where(eq(auditHeads.orgId, orgId)).for("update");
    if (!head) throw new Error("audit head missing");
    const fields: HashedFields = {
      id: deps.ids.newId(),
      orgId,
      seq: head.lastSeq + 1,
      at: deps.clock.now().toISOString(),
      actorType: ctx.actorType,
      actorMembershipId: ctx.actorMembershipId,
      actorLabel: ctx.actorLabel,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      diff: sanitizeDiff(input.diff),
      meta: input.meta ? sanitize(input.meta) : null,
      prevHash: head.lastHash,
    };
    const hash = await hashEvent(fields);
    await tx.insert(auditEvents).values({ ...fields, actorType: ctx.actorType, at: new Date(fields.at), hash });
    await tx.update(auditHeads).set({ lastSeq: fields.seq, lastHash: hash }).where(eq(auditHeads.orgId, orgId));
    return { id: fields.id, seq: fields.seq, hash };
  });
}

export type ChainVerification =
  | { ok: true; count: number }
  | { ok: false; count: number; brokenEventId: string; seq: number; reason: "hash_mismatch" | "broken_link" | "gap" };

/**
 * Recomputes every event's hash in sequence order and checks the links. Reports the first
 * broken event (used by `crowhr admin verify-audit`).
 */
export async function verifyChain(db: Db, orgId: string): Promise<ChainVerification> {
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId)).orderBy(asc(auditEvents.seq));
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    const fields: HashedFields = {
      id: row.id,
      orgId: row.orgId,
      seq: row.seq,
      at: row.at.toISOString(),
      actorType: row.actorType,
      actorMembershipId: row.actorMembershipId,
      actorLabel: row.actorLabel,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      requestId: row.requestId,
      ip: row.ip,
      userAgent: row.userAgent,
      diff: row.diff ?? null,
      meta: row.meta ?? null,
      prevHash: row.prevHash,
    };
    const fail = (reason: "hash_mismatch" | "broken_link" | "gap") =>
      ({ ok: false, count: rows.length, brokenEventId: row.id, seq: row.seq, reason }) as const;
    if (row.seq !== expectedSeq) return fail("gap");
    if (row.prevHash !== prev) return fail("broken_link");
    if ((await hashEvent(fields)) !== row.hash) return fail("hash_mismatch");
    prev = row.hash;
    expectedSeq++;
  }
  return { ok: true, count: rows.length };
}

/** Event families for read rules (spec "Audit log access"). */
export function auditCategory(action: string): "security" | "payroll" | "general" {
  if (/^(security_settings|sso)\./.test(action)) return "security";
  if (/^(payroll|payslip|compensation|bank|bank_account)\./.test(action)) return "payroll";
  return "general";
}

/** SQL fragment matching an action family (kept next to `auditCategory` so both agree). */
export function auditCategorySql(category: "security" | "payroll") {
  return category === "security"
    ? sql`(${auditEvents.action} like 'security_settings.%' or ${auditEvents.action} like 'sso.%')`
    : sql`(${auditEvents.action} like 'payroll.%' or ${auditEvents.action} like 'payslip.%' or ${auditEvents.action} like 'compensation.%' or ${auditEvents.action} like 'bank.%' or ${auditEvents.action} like 'bank!_account.%' escape '!')`;
}
