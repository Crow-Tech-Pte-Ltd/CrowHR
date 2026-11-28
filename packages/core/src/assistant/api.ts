import { eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { auditContext, recordAudit } from "../audit/audit.ts";
import { assistantGrants } from "../db/schema/assistant.ts";
import { organisations } from "../db/schema/organisations.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { assistantProvider } from "./clients.ts";
import { assistantAvailable, assistantResource, isAssistantEnabled, setAssistantEnabled } from "./settings.ts";

const settingsView = z.object({ available: z.boolean(), enabled: z.boolean(), url: z.string().nullable() });

export const assistantModule = defineModule({
  name: "assistant",
  basePath: "/assistant",
  tag: "AI assistants",
  routes: [
    defineRoute({
      method: "get",
      path: "/settings",
      summary: "AI assistant status for the signed-in company",
      access: "authenticated",
      responses: { 200: settingsView },
      handler: async ({ auth, deps }) => {
        const [org] = await deps.db
          .select({ slug: organisations.slug })
          .from(organisations)
          .where(eq(organisations.id, auth.orgId));
        const available = assistantAvailable(deps) && !auth.demoCompany && !!org?.slug;
        const enabled = available && (await isAssistantEnabled(deps.db, auth.orgId));
        return { available, enabled, url: enabled && org?.slug ? assistantResource(deps, org.slug) : null };
      },
    }),
    defineRoute({
      method: "put",
      path: "/settings",
      summary: "Turn the connector on or off for the company (owner only)",
      access: "authenticated",
      request: { body: z.object({ enabled: z.boolean() }) },
      responses: { 200: settingsView },
      errors: ["forbidden"],
      handler: async ({ c, auth, deps, body }) => {
        if (!auth.roles.includes("owner") || auth.demoCompany)
          throw new AppError("forbidden", "Only a company owner can change this setting.");
        const [org] = await deps.db
          .select({ slug: organisations.slug })
          .from(organisations)
          .where(eq(organisations.id, auth.orgId));
        if (!org?.slug)
          throw new AppError("forbidden", "Set a company sign-in address before enabling this connector.");
        await deps.db.transaction((tx) => setAssistantEnabled(deps, tx, auditContext(c), body.enabled));
        return { available: true, enabled: body.enabled, url: body.enabled ? assistantResource(deps, org.slug) : null };
      },
    }),
    defineRoute({
      method: "get",
      path: "/connections",
      summary: "List my AI assistant connections",
      access: "authenticated",
      responses: {
        200: z.object({
          connections: z.array(z.object({ id: z.uuid(), provider: z.string(), connectedAt: z.iso.datetime() })),
        }),
      },
      handler: async ({ auth, deps }) => {
        if (!assistantAvailable(deps) || auth.demoCompany) return { connections: [] };
        const org = orgScope(deps.db, auth);
        const rows = await deps.db
          .select({
            id: assistantGrants.id,
            redirectUri: assistantGrants.redirectUri,
            connectedAt: assistantGrants.connectedAt,
          })
          .from(assistantGrants)
          .where(
            org.where(
              assistantGrants,
              eq(assistantGrants.membershipId, auth.membershipId),
              isNotNull(assistantGrants.connectedAt),
              gt(assistantGrants.expiresAt, deps.clock.now()),
            ),
          );
        return {
          connections: rows.flatMap((row) =>
            row.connectedAt
              ? [
                  {
                    id: row.id,
                    provider: assistantProvider(row.redirectUri) ?? "AI assistant",
                    connectedAt: row.connectedAt.toISOString(),
                  },
                ]
              : [],
          ),
        };
      },
    }),
    defineRoute({
      method: "delete",
      path: "/connections/:id",
      summary: "Disconnect one of my AI assistants",
      access: "authenticated",
      allowDuringMfaEnrolment: true,
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        await deps.db.transaction(async (tx) => {
          const org = orgScope(tx, auth);
          const [deleted] = await tx
            .delete(assistantGrants)
            .where(
              org.where(
                assistantGrants,
                eq(assistantGrants.id, params.id),
                eq(assistantGrants.membershipId, auth.membershipId),
              ),
            )
            .returning({ id: assistantGrants.id });
          if (!deleted) throw new AppError("not_found", "This assistant connection is no longer available.");
          await recordAudit(tx, deps, auditContext(c), {
            action: "assistant.disconnected",
            targetType: "assistant_connection",
            targetId: deleted.id,
          });
        });
      },
    }),
  ],
});
