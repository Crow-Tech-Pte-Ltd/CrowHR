import { z } from "zod";
import { findOrgBySlug } from "../auth/credentials.ts";
import { publicSignInMethods } from "../auth/methods.ts";
import { organisations } from "../db/schema/organisations.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { SUPPORTED_API_VERSIONS } from "../openapi/generate.ts";
import { VERSION } from "../version.ts";

const METHOD_NAMES = { password: "Email and password" } as const;

/**
 * `GET /api/v1/meta` (api-platform "Server meta endpoint"): public discovery for the sign-in
 * page and mobile onboarding. Never lists the organisations of a multi-organisation install
 * without a slug, and never exposes member counts, emails or secrets.
 */
export function createMetaModule(features: () => readonly string[]) {
  return defineModule({
    name: "meta",
    basePath: "/meta",
    tag: "Meta",
    routes: [
      defineRoute({
        method: "get",
        path: "/",
        summary: "Server version, API versions, features and organisation sign-in methods",
        access: "public",
        request: { query: z.object({ org: z.string().trim().max(100).optional() }) },
        responses: {
          200: z.object({
            serverVersion: z.string(),
            apiVersions: z.array(z.string()),
            features: z.array(z.string()),
            demo: z.boolean(),
            orgSlugRequired: z.boolean(),
            organisations: z.array(
              z.object({
                slug: z.string(),
                displayName: z.string(),
                logoUrl: z.string().nullable(),
                signInMethods: z.array(
                  z.object({
                    kind: z.enum(["password", "google", "entra", "singpass", "oidc"]),
                    displayName: z.string(),
                  }),
                ),
              }),
            ),
          }),
        },
        handler: async ({ c, deps, query }) => {
          const all = await deps.db.select().from(organisations).limit(2);
          const org = query.org ? await findOrgBySlug(deps.db, query.org) : all.length === 1 ? all[0] : null;
          const entries = [];
          if (org?.slug) {
            const methods = await publicSignInMethods(deps.db, org.id);
            entries.push({
              slug: org.slug,
              displayName: org.name,
              // NOT IMPLEMENTED: logos arrive with the company profile (organisation module).
              logoUrl: null,
              signInMethods: [
                ...(methods.password.enabled
                  ? [{ kind: "password" as const, displayName: METHOD_NAMES.password }]
                  : []),
                ...methods.providers.map((p) => ({ kind: p.kind, displayName: p.displayName })),
              ],
            });
          }
          c.header("cache-control", "public, max-age=60");
          return {
            serverVersion: VERSION,
            apiVersions: [...SUPPORTED_API_VERSIONS],
            features: [...features()],
            demo: !!deps.demoMode,
            orgSlugRequired: !query.org && all.length > 1,
            organisations: entries,
          };
        },
      }),
    ],
  });
}
