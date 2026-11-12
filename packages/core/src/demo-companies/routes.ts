import { z } from "zod";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute, reply } from "../http/route.ts";
import { startDemoCompany } from "./service.ts";

/**
 * Demo companies (openspec add-demo-companies, design decisions 3, 4 and 9). Both routes answer
 * 404 unless the server was started with DEMO_COMPANIES=1, so they are inert on a normal install.
 */
const off = () => new AppError("not_found", "This server doesn't offer demo companies.");

export const demoCompaniesModule = defineModule({
  name: "demoCompanies",
  basePath: "/demo-companies",
  tag: "Demo companies",
  routes: [
    defineRoute({
      method: "get",
      path: "/config",
      summary: "Whether this server offers demo companies, and for how long one lasts (try page)",
      access: "public",
      responses: {
        200: z.object({
          /** Hours a demo company lives from the moment it is handed out. */
          ttlHours: z.number().int(),
          /** The server address the mobile apps connect to (PUBLIC_URL). */
          server: z.string(),
        }),
      },
      errors: ["not_found"],
      handler: ({ c, deps }) => {
        if (!deps.demoCompanies) throw off();
        c.header("cache-control", "no-store");
        return { ttlHours: deps.demoCompanies.ttlHours, server: deps.publicUrl.replace(/\/+$/, "") };
      },
    }),
    defineRoute({
      method: "post",
      path: "/",
      summary: "Start a private demo company: a copy of the fictional sample company, deleted at its expiry",
      description:
        "Public. Hands out a ready copy or seeds one while the caller waits. Limited per network per hour and per day, and by the number of live demo companies: past a limit it answers 429 with `details.retryAt` and `Retry-After`. Nobody else is told the short name, which is the key to the copy.",
      access: "public",
      responses: {
        201: z.object({
          /** The short name (`demo-` + 12 characters): the organisation code in the apps. */
          slug: z.string(),
          name: z.string(),
          server: z.string(),
          /** Opens the Crow HR app on this company (link or QR code). */
          connectUrl: z.string(),
          signInUrl: z.string(),
          expiresAt: z.iso.datetime(),
        }),
      },
      errors: ["not_found", "rate_limited", "service_unavailable"],
      handler: async ({ c, deps }) => {
        if (!deps.demoCompanies) throw off();
        c.header("cache-control", "no-store");
        return reply(201, await startDemoCompany(c));
      },
    }),
  ],
});
