import { createJsonConsoleLogger, VERSION } from "@crowhr/core";
import { serve } from "@hono/node-server";
import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createServerDeps } from "./deps.ts";
import { createServerApp } from "./http.ts";

async function main() {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(78); // EX_CONFIG
    }
    throw err;
  }

  const logger = createJsonConsoleLogger({ level: config.LOG_LEVEL, base: { service: "crowhr" } });
  const database = await openDatabase(config.DATABASE_URL);
  if (database.driver === "pglite") {
    logger.warn("Using in-process PGlite. Fine for development; use PostgreSQL in production.");
  }
  if (config.MIGRATE_ON_START) {
    await database.migrate();
    logger.info("Database migrations applied");
  }

  const app = createServerApp(createServerDeps(config, database, logger), { webDistDir: config.WEB_DIST_DIR });
  const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
    logger.info("Crow HR listening", { url: `http://${info.address}:${info.port}`, version: VERSION });
  });

  const shutdown = (signal: string) => {
    logger.info("Shutting down", { signal });
    server.close(() => {
      database.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Crow HR failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
