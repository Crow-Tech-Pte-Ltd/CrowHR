/** Test entry point for bun-integration.test.ts. Only mounted on the disposable test server. */
import { defineModule, defineRoute } from "@crowhr/core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { startServer } from "../src/main.ts";

await startServer({
  modules: [
    defineModule({
      name: "monitoring-test",
      basePath: "/monitoring-test",
      routes: [
        defineRoute({
          method: "post",
          path: "/:mode",
          summary: "Exercise sampled PostgreSQL queries",
          access: "public",
          request: {
            params: z.object({ mode: z.enum(["read", "fail"]) }),
            body: z.object({ marker: z.string() }),
          },
          responses: { 204: null },
          handler: async ({ deps, params, body }) => {
            await deps.db.execute(sql`select ${body.marker}::text`);
            if (params.mode === "fail") {
              await deps.db.transaction(async (tx) => {
                await tx.execute(sql`select ${body.marker}::integer`);
              });
            }
          },
        }),
      ],
    }),
  ],
});
