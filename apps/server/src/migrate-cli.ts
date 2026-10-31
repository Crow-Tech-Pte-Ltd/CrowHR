import { ConfigError, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";

// `bun run --cwd apps/server migrate`: apply migrations and exit.
try {
  const config = loadConfig(process.env);
  const database = await openDatabase(config.DATABASE_URL);
  await database.migrate();
  await database.close();
  console.error("Migrations applied.");
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
