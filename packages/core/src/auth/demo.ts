import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { users } from "../db/schema/users.ts";
import { AppError } from "../errors.ts";
import { defineRoute } from "../http/route.ts";
import { audit, onlyOrganisation } from "./credentials.ts";
import { startBrowserSession } from "./sessions.ts";

/**
 * Demo mode only (auth spec "Demo-mode sign-in"): one-click persona selection over the seeded,
 * fictional accounts. Both routes answer 404 on a real server, so they cannot be used as a
 * backdoor even if called directly.
 */
const persona = z.object({
  membershipId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
});

export const demoRoutes = [
  defineRoute({
    method: "get",
    path: "/demo/personas",
    summary: "Demo personas (demo mode only)",
    access: "public",
    responses: { 200: z.object({ items: z.array(persona) }) },
    errors: ["not_found"],
    handler: async ({ deps }) => {
      if (!deps.demoMode) throw new AppError("not_found", "No API endpoint here.");
      const org = await onlyOrganisation(deps.db);
      if (!org) return { items: [] };
      const rows = await deps.db
        .select({ m: memberships, u: users })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, org.id), eq(memberships.status, "active")));
      const roles = rows.length
        ? await deps.db
            .select()
            .from(membershipRoles)
            .where(
              inArray(
                membershipRoles.membershipId,
                rows.map((r) => r.m.id),
              ),
            )
        : [];
      return {
        items: rows.map(({ m, u }) => ({
          membershipId: m.id,
          displayName: u.displayName,
          email: u.email,
          roles: roles.filter((r) => r.membershipId === m.id).map((r) => r.role),
        })),
      };
    },
  }),
  defineRoute({
    method: "post",
    path: "/demo/sign-in",
    summary: "Sign in as a demo persona (demo mode only)",
    access: "public",
    request: { body: z.object({ membershipId: z.uuid() }) },
    responses: { 204: null },
    errors: ["not_found"],
    handler: async ({ c, deps, body }) => {
      if (!deps.demoMode) throw new AppError("not_found", "No API endpoint here.");
      const [m] = await deps.db
        .select()
        .from(memberships)
        .where(and(eq(memberships.id, body.membershipId), eq(memberships.status, "active")));
      if (!m) throw new AppError("not_found", "That persona doesn't exist.");
      await startBrowserSession(c, {
        userId: m.userId,
        orgId: m.orgId,
        membershipId: m.id,
        authMethod: "password",
        mfaSatisfied: true,
      });
      await audit(
        c,
        { action: "auth.signed_in", targetType: "membership", targetId: m.id, meta: { method: "demo_persona" } },
        { orgId: m.orgId },
      );
      return undefined;
    },
  }),
];
