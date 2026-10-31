import { ASSIGNED_ROLES, type AssignedRole, cellFor, type Permission, type Role } from "../access/matrix.ts";
import { type OrgScope, orgScope } from "../access/org-scope.ts";
import { singaporeDate, teamOf } from "../access/scope.ts";
import { type AuditContext, auditContext } from "../audit/audit.ts";
import { type AppContext, requireAuth } from "../context.ts";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";
import { type PeoplePorts, peoplePorts } from "./ports.ts";
import { createReportingScopeResolver } from "./reports/reporting-scope.ts";

/**
 * Who is acting, and what they may do with people data, evaluated against the
 * permission matrix in `access/matrix.ts` (single source of truth). Routes
 * check the coarse permission through `defineRoute({ access })`; services call
 * these helpers so every entry point (HTTP, import, jobs, demo seeding) gets
 * the same per-record and per-section answer.
 *
 * Built on identity's primitives, not beside them: tenancy is `actor.org`
 * (an `orgScope()`), the team comes from `access/scope.ts` `teamOf()` for
 * HTTP requests (the same per-request memo `authorize()` uses), and cells
 * come from `cellFor()`. What this layer adds is per-section scope: one
 * employee record spans several matrix rows (directory, personal, bank…).
 */
export type { AssignedRole };

export interface Actor {
  orgId: string;
  /** Org-scoped data access for `orgId`: use it for every people query (`actor.org.where(table, …)`). */
  org: OrgScope;
  userId: string | null;
  requestId: string | null;
  /** Assigned roles (owner, hr_admin, payroll_admin). Empty for former members. */
  roles: ReadonlySet<AssignedRole>;
  /** The actor's own employee record (implicit `employee` role), if linked. */
  employeeId: string | null;
  /** Direct and indirect reports as at today (derived `manager` role when non-empty). Lazy, per request. */
  team(): Promise<ReadonlySet<string>>;
  /** Who to record in the audit log. */
  auditCtx: AuditContext;
}

/** Data sections of an employee record, each mapped to a matrix row. */
export type Section =
  | "directory"
  | "employment"
  | "personal"
  | "emergency"
  | "work_pass"
  | "compensation"
  | "bank"
  | "checklists";

const READ: Record<Section, Permission> = {
  directory: "directory:read",
  employment: "employment:read",
  personal: "personal_details:read",
  emergency: "emergency_contacts:read",
  work_pass: "work_pass:read",
  compensation: "compensation:read",
  bank: "bank_details:read",
  checklists: "employment:read",
};

/** Direct (administrative) writes. Own-record writes go through self-service and change requests. */
const WRITE = {
  structure: "org_structure:update",
  employment: "employment:update",
  personal: "personal_details:update",
  emergency: "emergency_contacts:update",
  work_pass: "work_pass:update",
  compensation: "compensation:update",
  bank: "bank_details:update",
} as const satisfies Record<string, Permission>;

export type WriteArea = keyof typeof WRITE;

async function effectiveRoles(actor: Actor): Promise<Set<Role>> {
  const roles = new Set<Role>(actor.roles);
  if (actor.employeeId) {
    roles.add("employee");
    if ((await actor.team()).size > 0) roles.add("manager");
  }
  return roles;
}

export function hasAnyRole(actor: Actor, roles: readonly AssignedRole[]): boolean {
  return roles.some((r) => actor.roles.has(r));
}

/** Can the actor read `section` of `targetEmployeeId`? */
export async function canRead(actor: Actor, section: Section, targetEmployeeId: string): Promise<boolean> {
  const permission = READ[section];
  for (const role of await effectiveRoles(actor)) {
    const scope = cellFor(permission, role);
    if (scope === "all") return true;
    if (scope === "own" && actor.employeeId === targetEmployeeId) return true;
    if (scope === "team" && (await actor.team()).has(targetEmployeeId)) return true;
  }
  return false;
}

/** Scope for list endpoints: everyone, or an explicit set of employee ids (possibly empty). */
export async function listScope(actor: Actor, section: Section): Promise<"all" | Set<string>> {
  const permission = READ[section];
  const ids = new Set<string>();
  for (const role of await effectiveRoles(actor)) {
    const scope = cellFor(permission, role);
    if (scope === "all") return "all";
    if (scope === "own" && actor.employeeId) ids.add(actor.employeeId);
    if (scope === "team") for (const id of await actor.team()) ids.add(id);
  }
  return ids;
}

export async function readableSections(actor: Actor, targetEmployeeId: string): Promise<Set<Section>> {
  const out = new Set<Section>();
  for (const s of Object.keys(READ) as Section[]) if (await canRead(actor, s, targetEmployeeId)) out.add(s);
  return out;
}

/** 404 rather than 403 when reading out of scope: the response must not reveal the record. */
export async function assertCanRead(actor: Actor, section: Section, targetEmployeeId: string): Promise<void> {
  if (!(await canRead(actor, section, targetEmployeeId))) {
    throw new AppError("not_found", "That employee record doesn't exist or you can't see it.");
  }
}

/** Administrative write: an assigned role with `all` scope for the area. */
export function canWrite(actor: Actor, area: WriteArea): boolean {
  return [...actor.roles].some((role) => cellFor(WRITE[area], role) === "all");
}

export function assertCanWrite(actor: Actor, area: WriteArea): void {
  if (!canWrite(actor, area)) {
    throw new AppError("forbidden", "Your role does not allow this change. Ask an owner or the right administrator.", {
      area,
    });
  }
}

/**
 * Segregation of duties: nobody changes their own pay or bank details
 * directly, whatever their role (access-control "Self-service and
 * segregation of duties").
 */
export function assertNotSelfChange(actor: Actor, area: "compensation" | "bank", targetEmployeeId: string): void {
  if (actor.employeeId && actor.employeeId === targetEmployeeId) {
    throw new AppError(
      "self_change_requires_approval",
      area === "compensation"
        ? "You cannot change your own pay. Submit a change request for another administrator to approve."
        : "You cannot change your own bank details directly. Submit a change request instead.",
      { area },
    );
  }
}

export function buildActor(input: {
  db: Db;
  orgId: string;
  userId: string | null;
  requestId: string | null;
  roles: readonly string[];
  employeeId: string | null;
  today: string;
  /** Override team resolution (HTTP requests share the per-request memo of `access/scope.ts`). */
  team?: () => Promise<ReadonlySet<string>>;
  auditCtx?: AuditContext;
}): Actor {
  const resolver = createReportingScopeResolver(input.db);
  let team: Promise<ReadonlySet<string>> | null = null;
  return {
    orgId: input.orgId,
    org: orgScope(input.db, input.orgId),
    userId: input.userId,
    requestId: input.requestId,
    roles: new Set(input.roles.filter((r): r is AssignedRole => (ASSIGNED_ROLES as readonly string[]).includes(r))),
    employeeId: input.employeeId,
    auditCtx: input.auditCtx ?? {
      orgId: input.orgId,
      actorType: "system",
      actorMembershipId: null,
      actorLabel: input.userId ? `user:${input.userId}` : "people",
      requestId: input.requestId,
      ip: null,
      userAgent: null,
    },
    team() {
      if (input.team) return input.team();
      if (!input.employeeId) return Promise.resolve(new Set<string>());
      team ??= resolver.teamOf(input.orgId, input.employeeId, input.today);
      return team;
    },
  };
}

/** Resolves the actor for a request (401 when signed out). Former members act with no roles. */
export function actorFrom(c: AppContext): { actor: Actor; ports: PeoplePorts } {
  const auth = requireAuth(c);
  const deps = c.get("deps");
  const active = auth.membershipStatus === "active";
  const actor = buildActor({
    db: deps.db,
    orgId: auth.orgId,
    userId: auth.user.id,
    requestId: c.get("requestId"),
    roles: active ? auth.roles : [],
    employeeId: active ? auth.employeeId : null,
    today: singaporeDate(deps.clock.now()),
    team: () => teamOf(c),
    auditCtx: auditContext(c),
  });
  return { actor, ports: peoplePorts(deps) };
}
