import { defineModule, defineRoute } from "../http/route.ts";
import { getSystemStatus, systemStatusSchema } from "./status.ts";

export const systemModule = defineModule({
  name: "system",
  basePath: "/system",
  tag: "System",
  routes: [
    defineRoute({
      method: "get",
      path: "/status",
      summary: "System status for owners",
      description:
        "Version, database and migration state, last backup, disk space, and how this request reached the server (client IP, scheme, trusted proxy). Owners only; read-only.",
      // Owner-only is checked in the service: the permission matrix has no install-level row.
      access: "authenticated",
      responses: { 200: systemStatusSchema },
      errors: ["forbidden"],
      handler: ({ deps, auth, c }) => getSystemStatus(deps, auth, c.var.client),
    }),
  ],
});
