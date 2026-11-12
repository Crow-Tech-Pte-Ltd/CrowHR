import { isNull } from "drizzle-orm";
import { z } from "zod";
import { publicSignInMethods } from "../auth/methods.ts";
import { organisations } from "../db/schema/organisations.ts";
import { isLiveDemoCompany } from "../demo-companies/config.ts";
import { findSignInOrg } from "../demo-companies/service.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { SUPPORTED_API_VERSIONS } from "../openapi/generate.ts";
import { getCompanyProfile, readCompanyLogo } from "../organisation/profile.ts";
import { VERSION } from "../version.ts";

const METHOD_NAMES = { password: "Email and password" } as const;
/** How a demo company's one-tap persona sign-in is named to the mobile apps. */
export const DEMO_COMPANY_METHOD = "Pick a person (demo company, no password)";

/** Up to two real organisations (demo companies never count toward "the only organisation"). */
function realOrganisations(deps: AppDeps) {
  return deps.db.select().from(organisations).where(isNull(organisations.demoExpiresAt)).limit(2);
}

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
          const now = deps.clock.now();
          // Demo companies are never listed (their slug is the key to a visitor's copy), and a
          // server that offers them always asks which organisation (demo-companies decision 6).
          const all = await realOrganisations(deps);
          const org = query.org
            ? await findSignInOrg(deps, query.org, now)
            : !deps.demoCompanies && all.length === 1
              ? all[0]
              : null;
          const entries = [];
          const demoCompany = !!org && isLiveDemoCompany(deps, org, now);
          if (org?.slug) {
            const methods = demoCompany ? null : await publicSignInMethods(deps.db, org.id);
            entries.push({
              slug: org.slug,
              displayName: org.name,
              logoUrl: (await getCompanyProfile(deps, org.id))?.logoFileKey
                ? `${deps.publicUrl.replace(/\/$/, "")}/api/v1/meta/logo?${new URLSearchParams({ org: org.slug })}`
                : null,
              signInMethods: methods
                ? [
                    ...(methods.password.enabled
                      ? [{ kind: "password" as const, displayName: METHOD_NAMES.password }]
                      : []),
                    ...methods.providers.map((p) => ({ kind: p.kind, displayName: p.displayName })),
                  ]
                : // A demo company: the 1.0.0 apps refuse an organisation that lists no sign-in
                  // method, and `kind` is a closed enum in the v1.0 contract. The apps show only
                  // `displayName` and sign in on the server's page, which offers the company's people.
                  [{ kind: "password" as const, displayName: DEMO_COMPANY_METHOD }],
            });
          }
          c.header("cache-control", demoCompany ? "no-store" : "public, max-age=60");
          return {
            serverVersion: VERSION,
            apiVersions: [...SUPPORTED_API_VERSIONS],
            features: [...features()],
            demo: !!deps.demoMode || demoCompany,
            orgSlugRequired: !query.org && (all.length > 1 || !!deps.demoCompanies),
            organisations: entries,
          };
        },
      }),
      defineRoute({
        method: "get",
        path: "/logo",
        summary: "The organisation's logo, public like its name (sign-in page and mobile apps)",
        access: "public",
        request: { query: z.object({ org: z.string().trim().max(100).optional() }) },
        responses: { 200: { description: "The logo image", contentType: "image/png" } },
        errors: ["not_found"],
        handler: async ({ deps, query }) => {
          const all = await realOrganisations(deps);
          const org = query.org
            ? await findSignInOrg(deps, query.org, deps.clock.now())
            : !deps.demoCompanies && all.length === 1
              ? all[0]
              : null;
          if (!org) throw new AppError("not_found", "No organisation with that address.");
          // readCompanyLogo re-sniffs the stored file: only a real PNG is ever served.
          const file = await readCompanyLogo(deps, org.id);
          return new Response(file.data as BodyInit, {
            headers: {
              "content-type": "image/png",
              "x-content-type-options": "nosniff",
              "cache-control": "public, max-age=300",
            },
          });
        },
      }),
    ],
  });
}
