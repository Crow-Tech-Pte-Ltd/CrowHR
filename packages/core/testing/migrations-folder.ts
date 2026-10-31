import { fileURLToPath } from "node:url";

/**
 * Absolute path of the drizzle-kit migrations folder. Node-only (filesystem);
 * used by apps/server and the PGlite test harness. The browser demo must
 * bundle the SQL files instead.
 */
export const migrationsFolder: string = fileURLToPath(new URL("../drizzle", import.meta.url));
