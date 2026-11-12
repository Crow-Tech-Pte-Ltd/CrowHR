import { z } from "zod";
import { defaultSignInOrg, demoCompanyEnded, findSignInOrg } from "../demo-companies/service.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { accountRoutes } from "./account-routes.ts";
import { demoRoutes } from "./demo.ts";
import { publicSignInMethods } from "./methods.ts";
import { oidcRoutes } from "./oidc/routes.ts";
import { signInRoutes } from "./sign-in-routes.ts";

const methodsResponse = z.object({
  /** True on a multi-organisation install when no `org` was given: ask the user which one. */
  orgSlugRequired: z.boolean(),
  organisation: z.object({ name: z.string(), slug: z.string().nullable() }).nullable(),
  password: z.object({ enabled: z.boolean() }),
  providers: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["google", "entra", "singpass", "oidc"]),
      displayName: z.string(),
      allowedDomains: z.array(z.string()),
    }),
  ),
  demoMode: z.boolean(),
  /**
   * Set for a live demo company (demo-companies): its people sign in by picking a person
   * (`/auth/demo/personas?org=`), with no password or single sign-on, until `expiresAt`.
   */
  demoCompany: z.object({ expiresAt: z.iso.datetime() }).nullable(),
  /** The official Singpass logo for the Singpass button, when the deployer supplied it; else null. */
  singpassLogoUrl: z.string().nullable(),
});

export const authModule = defineModule({
  name: "auth",
  basePath: "/auth",
  tag: "Authentication",
  routes: [
    defineRoute({
      method: "get",
      path: "/methods",
      summary: "Sign-in methods an organisation has enabled",
      description:
        "Public. Without `org`, resolves the only organisation of a single-organisation install (never on a server that offers demo companies). An ended demo company answers 404 with `details.demoCompanyEnded`.",
      access: "public",
      request: { query: z.object({ org: z.string().trim().max(100).optional() }) },
      responses: { 200: methodsResponse },
      errors: ["not_found"],
      handler: async ({ deps, query }) => {
        const org = query.org ? await findSignInOrg(deps, query.org, deps.clock.now()) : await defaultSignInOrg(deps);
        if (!org) {
          if (query.org) {
            throw (
              demoCompanyEnded(deps, query.org) ??
              new AppError(
                "not_found",
                `There is no organisation called "${query.org}" on this server. Check the address you were given.`,
              )
            );
          }
          return {
            orgSlugRequired: true,
            organisation: null,
            password: { enabled: false },
            providers: [],
            demoMode: !!deps.demoMode,
            demoCompany: null,
            singpassLogoUrl: deps.singpassLogoUrl?.() ?? null,
          };
        }
        if (org.demoExpiresAt) {
          // A live demo company (findSignInOrg returns no other kind): persona sign-in only.
          return {
            orgSlugRequired: false,
            organisation: { name: org.name, slug: org.slug },
            password: { enabled: false },
            providers: [],
            demoMode: !!deps.demoMode,
            demoCompany: { expiresAt: org.demoExpiresAt.toISOString() },
            singpassLogoUrl: null,
          };
        }
        const methods = await publicSignInMethods(deps.db, org.id);
        return {
          orgSlugRequired: false,
          organisation: { name: org.name, slug: org.slug },
          ...methods,
          demoMode: !!deps.demoMode,
          demoCompany: null,
          singpassLogoUrl: deps.singpassLogoUrl?.() ?? null,
        };
      },
    }),
    ...signInRoutes,
    ...accountRoutes,
    ...oidcRoutes,
    ...demoRoutes,
  ],
});
