/**
 * Adds the fictional sample company Kopi Kaki Pte. Ltd. (slug `kopi-kaki`, the public demo's
 * company) to a running Crow HR server as an additional organisation, for App Store / Google Play
 * review and sales demos. See docs/sample-company.md.
 *
 *   node scripts/seed-sample-company.ts --credentials <new file> [--dry-run]
 *
 * Uses the server's own configuration (the same environment as the app container: PUBLIC_URL,
 * DATABASE_*, DATA_DIR / CROWHR_SECRET_KEY), its argon2id hasher, encryption key and file storage.
 * The history is seeded in an in-memory scratch database (packages/demo/src/sample-company), then
 * copied into the server's database in one transaction. Refuses, changing nothing, when:
 * - an organisation with the slug `kopi-kaki`, or a user with one of its emails, already exists;
 * - the database schema doesn't match this checkout (pending or unknown migrations);
 * - the encryption key is missing or doesn't match the database;
 * - the credentials file already exists.
 * Never touches other organisations. Sends no email (no mailer is wired in).
 *
 * Every account gets a fresh random password, written only to the --credentials file (mode 0600,
 * JSON). Nothing secret is printed. --dry-run seeds the scratch database and runs the checks,
 * but writes no file and leaves the server untouched.
 */
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createArgon2Hasher } from "../apps/server/src/argon2-hasher.ts";
import { ConfigError, loadConfig } from "../apps/server/src/config.ts";
import { openDatabase } from "../apps/server/src/db.ts";
import { createDiskFileStore } from "../apps/server/src/disk-file-store.ts";
import { planMigrations, readBundledMigrations } from "../apps/server/src/migrate/runner.ts";
import { readExistingKey } from "../apps/server/src/secrets/existing.ts";
import { keyMatchesDatabase } from "../apps/server/src/secrets/key.ts";
import { createJsonConsoleLogger } from "../packages/core/src/index.ts";
import { migrationsFolder } from "../packages/core/testing/migrations-folder.ts";
import {
  assertCanInstall,
  installSampleCompany,
  prepareSampleCompany,
  SAMPLE_ORG,
} from "../packages/demo/src/sample-company/seed.ts";

const log = (message: string) => process.stderr.write(`${message}\n`);

class Refused extends Error {}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { credentials: { type: "string" }, "dry-run": { type: "boolean", default: false } },
  });
  const dryRun = values["dry-run"];
  const credentials = values.credentials;
  if (!dryRun && !credentials) {
    log("Usage: node scripts/seed-sample-company.ts --credentials <new file> [--dry-run]");
    return 64;
  }
  if (credentials && existsSync(credentials)) throw new Refused(`${credentials} already exists. Pass a new path.`);

  const config = loadConfig(process.env);
  const database = await openDatabase(config.DATABASE_URL);
  const scratch = await openDatabase("pglite:memory");
  try {
    await database.probe();
    const plan = await planMigrations(database.db, readBundledMigrations(migrationsFolder));
    if (plan.pending.length || plan.unknown.length) {
      throw new Refused(
        `The server's database schema doesn't match this checkout (pending: ${plan.pending.map((m) => m.tag).join(", ") || "none"}; unknown: ${plan.unknown.length}). Run this from the same version as the server.`,
      );
    }
    const key = await readExistingKey(config);
    if (!key) throw new Refused("No encryption key found (CROWHR_SECRET_KEY or the key file in DATA_DIR).");
    const matches = await keyMatchesDatabase(database.db, key);
    if (matches !== true) {
      throw new Refused(
        matches === null
          ? "The database has no key check yet. Start the server once before seeding."
          : "The encryption key does not match this database. Use the server's own key.",
      );
    }
    await assertCanInstall(database.db);
    log(`Server ${config.PUBLIC_URL}: no "${SAMPLE_ORG.slug}" organisation yet. Seeding a scratch copy first.`);

    await scratch.migrate();
    const prepared = await prepareSampleCompany({
      scratch: scratch.db,
      secretKey: key,
      passwordHasher: createArgon2Hasher(),
      publicUrl: config.PUBLIC_URL,
      logger: createJsonConsoleLogger({ level: "error", base: { service: "seed-sample-company" } }),
      progress: (m) => log(`  ${m}`),
    });
    log(`Checks passed: ${JSON.stringify(prepared.checks)}`);
    if (dryRun || !credentials) {
      log("Dry run: the server was not changed.");
      return 0;
    }

    const server = config.PUBLIC_URL;
    const connect = `crowhr://connect?${new URLSearchParams({ server, org: SAMPLE_ORG.slug })}`;
    await writeFile(
      credentials,
      `${JSON.stringify(
        {
          server,
          org: SAMPLE_ORG.slug,
          orgName: SAMPLE_ORG.name,
          connectLink: connect,
          signInUrl: `${server}/sign-in/${SAMPLE_ORG.slug}`,
          createdAt: new Date().toISOString(),
          accounts: prepared.accounts,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: "wx" },
    );
    try {
      const result = await installSampleCompany(prepared, database.db, createDiskFileStore(config.FILE_STORAGE_DIR));
      log(`Added ${SAMPLE_ORG.name} (${SAMPLE_ORG.slug}): ${result.copy.total} rows, ${result.files} files.`);
    } catch (err) {
      await rm(credentials, { force: true });
      throw err;
    }
    for (const a of prepared.accounts) {
      log(`  ${a.reviewer ? `[reviewer ${a.reviewer}] ` : ""}${a.label}: ${a.name} <${a.email}>`);
    }
    log(`Passwords are in ${credentials} (mode 600). Connect link: ${connect}`);
    return 0;
  } finally {
    await scratch.close().catch(() => undefined);
    await database.close().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof Refused || err instanceof ConfigError || (err as Error)?.name === "OrganisationCopyRefused") {
      log(`Refused: ${(err as Error).message}`);
      process.exit(2);
    }
    log(`Failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
