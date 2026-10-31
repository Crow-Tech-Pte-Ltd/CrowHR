import { inArray, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { type AppContext, requireAuth } from "../context.ts";
import { AppError } from "../errors.ts";
import { cellFor, FORMER_MEMBER_PERMISSIONS, type Permission, ROLES, type Role, type Scope } from "./matrix.ts";
import { effectiveRoles, teamOf } from "./scope.ts";

/**
 * The result of a successful `authorize()`: which scopes the caller holds for one permission.
 * Handlers use it to narrow item access (`assertEmployee`) and list queries (`employeeFilter`).
 */
export interface Grant {
  permission: Permission;
  /** Union over the caller's effective roles. */
  scopes: ReadonlySet<Scope>;
  /** Roles that contributed a scope. */
  roles: ReadonlySet<Role>;
  /** True when any role grants `all`: no per-record narrowing needed. */
  readonly all: boolean;
  /** Employees the caller may act on when not `all`: team ∪ self (for `own`). */
  employeeIds(): Promise<ReadonlySet<string>>;
  canAccessEmployee(employeeId: string): Promise<boolean>;
  /**
   * Throws 404 `not_found` when the employee is out of scope, so the caller cannot tell
   * whether the record exists (spec "Permission matrix" scenario).
   */
  assertEmployee(employeeId: string, what?: string): Promise<void>;
  /**
   * A Drizzle `where` fragment restricting `column` (an employee-id column) to the scope:
   * `undefined` for `all`, otherwise `column in (…)` (or `false` when the set is empty).
   * List endpoints use it so out-of-scope rows are never loaded.
   */
  employeeFilter(column: PgColumn | SQL): Promise<SQL | undefined>;
}

/**
 * Checks `permission` against the matrix for the caller's effective roles.
 * - unauthenticated → 401
 * - no role grants the permission at all → 403 `forbidden`
 * - otherwise returns a Grant; per-record checks (404 when out of scope) use the Grant.
 *
 * Call it from route definitions (`access: { permission }`) — `defineRoute` does so before the
 * handler runs — or from services that are reached by several routes.
 */
export async function authorize(c: AppContext, permission: Permission): Promise<Grant> {
  const auth = requireAuth(c);
  const scopes = new Set<Scope>();
  const granting = new Set<Role>();
  if (auth.membershipStatus === "former") {
    if (FORMER_MEMBER_PERMISSIONS.has(permission) && auth.employeeId) {
      scopes.add("own");
    }
  } else {
    const roles = await effectiveRoles(c);
    for (const role of ROLES) {
      if (!roles.has(role)) continue;
      const scope = cellFor(permission, role);
      if (scope) {
        scopes.add(scope);
        granting.add(role);
      }
    }
  }
  if (scopes.size === 0) {
    throw new AppError("forbidden", "You don't have permission to do this. Ask an owner if you need access.", {
      permission,
    });
  }

  const all = scopes.has("all");
  const employeeIds = async (): Promise<ReadonlySet<string>> => {
    const ids = new Set<string>();
    if (scopes.has("team")) for (const id of await teamOf(c)) ids.add(id);
    if (scopes.has("own") && auth.employeeId) ids.add(auth.employeeId);
    return ids;
  };
  const canAccessEmployee = async (employeeId: string) => all || (await employeeIds()).has(employeeId);
  return {
    permission,
    scopes,
    roles: granting,
    all,
    employeeIds,
    canAccessEmployee,
    async assertEmployee(employeeId, what = "record") {
      if (!(await canAccessEmployee(employeeId))) {
        throw new AppError("not_found", `That ${what} doesn't exist or you can't see it.`);
      }
    },
    async employeeFilter(column) {
      if (all) return undefined;
      const ids = [...(await employeeIds())];
      return ids.length ? inArray(column as PgColumn, ids) : sql`false`;
    },
  };
}

/** Like `authorize` but returns false instead of throwing 403 (e.g. to decide what to include). */
export async function can(c: AppContext, permission: Permission): Promise<boolean> {
  try {
    await authorize(c, permission);
    return true;
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return false;
    throw err;
  }
}
