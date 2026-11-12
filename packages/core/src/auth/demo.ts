import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import { isLiveDemoCompany } from "../demo-companies/config.ts";
import { findSignInOrg } from "../demo-companies/service.ts";
import { AppError } from "../errors.ts";
import { defineRoute, reply } from "../http/route.ts";
import { audit, onlyOrganisation } from "./credentials.ts";
import { completeNativeSignIn } from "./native/complete.ts";
import { startBrowserSession } from "./sessions.ts";

/**
 * Persona sign-in: one click signs in as a person of a fictional company, with no password.
 *
 * - Browser demo (`deps.demoMode`, auth spec "Demo-mode sign-in"): the seeded accounts of the
 *   only organisation, as before.
 * - Demo companies (`deps.demoCompanies`, demo-companies "Persona sign-in for a demo company"):
 *   the people of one live demo company, named by its slug, in the browser or for the mobile
 *   apps' native sign-in (`native`: returns the app redirect with a one-time code).
 *
 * Anything else answers 404 (a real server, a real organisation on a demo-companies server, an
 * expired or unclaimed copy), so these routes cannot be used as a backdoor even if called directly.
 */
const persona = z.object({
  membershipId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  /** Demo companies: the sample company's featured people (label, one line, order). */
  persona: z.object({ key: z.string(), label: z.string(), blurb: z.string(), order: z.number().int() }).optional(),
});

const NO_ENDPOINT = () => new AppError("not_found", "No API endpoint here.");
const NO_PERSONA = () => new AppError("not_found", "That persona doesn't exist.");

async function activePeople(db: Db, orgId: string) {
  const rows = await db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active")));
  const roles = rows.length
    ? await db
        .select()
        .from(membershipRoles)
        .where(
          inArray(
            membershipRoles.membershipId,
            rows.map((r) => r.m.id),
          ),
        )
    : [];
  return rows.map(({ m, u }) => ({
    membershipId: m.id,
    displayName: u.displayName,
    email: u.email,
    roles: roles.filter((r) => r.membershipId === m.id).map((r) => r.role),
  }));
}

export const demoRoutes = [
  defineRoute({
    method: "get",
    path: "/demo/personas",
    summary: "Demo personas (browser demo, or a live demo company named by `org`)",
    access: "public",
    request: { query: z.object({ org: z.string().trim().max(100).optional() }) },
    responses: { 200: z.object({ items: z.array(persona) }) },
    errors: ["not_found"],
    handler: async ({ c, deps, query }) => {
      if (deps.demoMode) {
        const org = await onlyOrganisation(deps.db);
        return { items: org ? await activePeople(deps.db, org.id) : [] };
      }
      if (!deps.demoCompanies || !query.org) throw NO_ENDPOINT();
      const org = await findSignInOrg(deps, query.org, deps.clock.now());
      if (!org?.demoExpiresAt) throw new AppError("not_found", "That demo company doesn't exist or has ended.");
      c.header("cache-control", "no-store");
      const info = deps.demoCompanies.personaInfo;
      return {
        items: (await activePeople(deps.db, org.id)).map((p) => {
          const described = info?.(p.email);
          return described ? { ...p, persona: described } : p;
        }),
      };
    },
  }),
  defineRoute({
    method: "post",
    path: "/demo/sign-in",
    summary: "Sign in as a demo persona (browser demo, or a live demo company)",
    description:
      "Demo company: send `org` (its short name) and, during a mobile app's sign-in, `native` (the request id from /native/authorize); the answer is then 200 with the app redirect instead of a browser session.",
    access: "public",
    request: {
      body: z.object({
        membershipId: z.uuid(),
        /** Demo company: its short name. */
        org: z.string().trim().max(100).optional(),
        /** Demo company: native-app sign-in in progress (api-platform). */
        native: z.uuid().optional(),
      }),
    },
    responses: {
      200: z.object({ redirectTo: z.string() }),
      204: null,
    },
    errors: ["not_found"],
    handler: async ({ c, deps, body }) => {
      if (deps.demoMode) {
        const [m] = await deps.db
          .select()
          .from(memberships)
          .where(and(eq(memberships.id, body.membershipId), eq(memberships.status, "active")));
        if (!m) throw NO_PERSONA();
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
        return reply(204);
      }
      if (!deps.demoCompanies || !body.org) throw NO_ENDPOINT();
      const now = deps.clock.now();
      const [row] = await deps.db
        .select({ m: memberships, org: organisations })
        .from(memberships)
        .innerJoin(organisations, eq(organisations.id, memberships.orgId))
        .where(and(eq(memberships.id, body.membershipId), eq(memberships.status, "active")));
      if (!row || row.org.slug !== body.org.toLowerCase() || !isLiveDemoCompany(deps, row.org, now)) throw NO_PERSONA();
      const { m } = row;
      // Defence in depth: a demo company's people belong to it alone (invitations are refused
      // there), so a persona can never carry a session into another organisation.
      const [elsewhere] = await deps.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, m.userId), ne(memberships.orgId, m.orgId)))
        .limit(1);
      if (elsewhere) throw NO_PERSONA();
      if (body.native) {
        const redirectTo = await completeNativeSignIn(c, {
          requestId: body.native,
          orgId: m.orgId,
          userId: m.userId,
          membershipId: m.id,
          authMethod: "password",
          mfaSatisfied: true,
        });
        await audit(
          c,
          {
            action: "auth.signed_in",
            targetType: "membership",
            targetId: m.id,
            meta: { method: "demo_persona", client: "native" },
          },
          { orgId: m.orgId },
        );
        return { redirectTo };
      }
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
      return reply(204);
    },
  }),
];
