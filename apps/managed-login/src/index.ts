import { readFile } from "node:fs/promises";
import { SINGPASS_ISSUERS, singpassConfiguration } from "@crowhr/core/singpass";
import type { Configuration } from "openid-client";
import { Pool } from "pg";
import { createBroker } from "./broker.ts";
import { parseConfig } from "./config.ts";
import { createStorage } from "./storage.ts";

async function main() {
  const configPath = process.env.MANAGED_LOGIN_CONFIG_FILE;
  if (!configPath) throw new Error("Set MANAGED_LOGIN_CONFIG_FILE to the path of the mounted JSON configuration.");
  const contents = await readFile(configPath, "utf8").catch(() => {
    throw new Error("Could not read the managed login configuration file.");
  });
  const config = parseConfig(contents);
  const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, max: 5 });
  pool.on("error", () => console.error("Managed login database connection failed."));
  try {
    const storage = createStorage((sql, values) => pool.query(sql, values), config.issuer);
    await storage.initialise().catch(() => {
      throw new Error("Check the managed login PostgreSQL connection and schema permissions.");
    });
    let discovered: Promise<Configuration> | undefined;
    const broker = createBroker({
      ...config,
      singpassKeys: config.singpass.keys,
      upstream: () => {
        discovered ??= singpassConfiguration(
          SINGPASS_ISSUERS[config.singpass.environment],
          config.singpass.clientId,
          config.singpass.keys,
        ).catch((error: unknown) => {
          discovered = undefined;
          throw error;
        });
        return discovered;
      },
      storage,
      audit: ({ client, outcome }) =>
        process.stdout.write(`${JSON.stringify({ operation: "singpass", client, outcome })}\n`),
    });
    broker.on("server_error", () => console.error("Managed login protocol request failed."));
    const server = broker.listen(config.port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", () => reject(new Error("Could not listen on the configured managed login port.")));
    });
    process.stdout.write(`Managed login is listening on loopback port ${config.port}.\n`);
    const sweeper = setInterval(() => {
      void storage.sweep().catch(() => console.error("Managed login expired-state cleanup failed."));
    }, 60_000).unref();
    const shutdown = () => {
      clearInterval(sweeper);
      server.close(() => void pool.end());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    await pool.end();
    throw error;
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Managed login startup failed.");
  process.exitCode = 1;
});
