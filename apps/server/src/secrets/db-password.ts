import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_DB_PASSWORD_FILE = "/run/crowhr-secrets/db_password";

/**
 * `crowhr init-secrets` (the compose `init` service): writes a random database password to
 * the shared secrets volume once. Postgres reads it via POSTGRES_PASSWORD_FILE and the app
 * via DATABASE_PASSWORD_FILE. Idempotent: an existing non-empty file is never replaced,
 * because Postgres only reads the password when it initialises an empty data directory.
 */
export async function initDbPassword(path: string): Promise<{ created: boolean; path: string }> {
  try {
    if ((await readFile(path, "utf8")).trim()) return { created: false, path };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  // base64url: safe in a postgres:// URL and in shell snippets.
  const password = randomBytes(24).toString("base64url");
  try {
    await writeFile(path, `${password}\n`, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return { created: false, path };
    throw err;
  }
  await chmod(path, 0o600);
  return { created: true, path };
}
