import { z } from "zod";
import { auditContext, clientIp } from "../audit/audit.ts";
import { startBrowserSession } from "../auth/sessions.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { checkSetupCode, completeSetup, isSetupRequired } from "./service.ts";

/** The one-time code travels in this header, never in a URL (it would land in proxy logs). */
export const SETUP_CODE_HEADER = "x-setup-code";

const notAvailable = () =>
  new AppError("not_found", "Setup is already complete. Sign in instead.", { setupComplete: true });

async function assertSetupOpen(db: Parameters<typeof isSetupRequired>[0]) {
  if (!(await isSetupRequired(db))) throw notAvailable();
}

const setupBody = z.object({
  organisationName: z
    .string()
    .trim()
    .min(2, { error: "Enter the company's registered name, as on ACRA BizFile." })
    .max(200, { error: "Keep the company name under 200 characters." }),
  ownerName: z
    .string()
    .trim()
    .min(1, { error: "Enter your name." })
    .max(200, { error: "Keep the name under 200 characters." }),
  ownerEmail: z
    .string()
    .trim()
    .max(320, { error: "Keep the email address under 320 characters." })
    .pipe(z.email({ error: "Enter a valid email address, for example aisyah@acme.sg." })),
  // Length and strength rules come from the identity password policy (checked in the service).
  ownerPassword: z.string().max(1024, { error: "Use at most 128 characters." }),
});

export const setupModule = defineModule({
  name: "setup",
  basePath: "/setup",
  tag: "Setup",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "First-run setup state",
      description: "200 while the install has no organisation; 404 once setup is complete.",
      access: "public",
      responses: {
        200: z.object({ required: z.literal(true) }),
      },
      errors: ["not_found"],
      handler: async ({ deps }) => {
        await assertSetupOpen(deps.db);
        return { required: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/verify",
      summary: "Check the one-time setup code",
      description: `Send the code from the server logs in the \`${SETUP_CODE_HEADER}\` header. Five wrong codes from one IP block it for 15 minutes.`,
      access: "public",
      responses: { 204: null },
      errors: ["not_found", "invalid_setup_code", "rate_limited"],
      handler: async ({ deps, c }) => {
        await assertSetupOpen(deps.db);
        await checkSetupCode(deps, c.var.client.ip ?? clientIp(c), c.req.header(SETUP_CODE_HEADER));
      },
    }),
    defineRoute({
      method: "post",
      path: "/",
      summary: "Complete first-run setup",
      description: `Creates the organisation and its owner in one transaction, invalidates the setup code and signs the owner in (MFA enrolment is offered next). Requires the code in the \`${SETUP_CODE_HEADER}\` header.`,
      access: "public",
      request: { body: setupBody },
      responses: {
        201: z.object({
          organisationId: z.uuid(),
          organisationSlug: z.string(),
          ownerUserId: z.uuid(),
        }),
      },
      errors: ["not_found", "invalid_setup_code", "rate_limited", "conflict"],
      handler: async ({ deps, c, body }) => {
        await assertSetupOpen(deps.db);
        await checkSetupCode(deps, c.var.client.ip ?? clientIp(c), c.req.header(SETUP_CODE_HEADER));
        const result = await completeSetup(deps, body, (orgId) => auditContext(c, orgId));
        // Signed in straight away; MFA is not yet satisfied, so the owner is asked to enrol.
        await startBrowserSession(c, {
          userId: result.ownerUserId,
          orgId: result.organisationId,
          membershipId: result.ownerMembershipId,
          authMethod: "password",
          mfaSatisfied: false,
        });
        return {
          organisationId: result.organisationId,
          organisationSlug: result.organisationSlug,
          ownerUserId: result.ownerUserId,
        };
      },
    }),
  ],
});
