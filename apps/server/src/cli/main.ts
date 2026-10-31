import { ConfigError, loadConfig } from "../config.ts";
import { openDatabase } from "../db.ts";
import { cliDeps, resetOwnerPasswordCommand, verifyAuditCommand } from "./admin.ts";

/**
 * `node apps/server/src/cli/main.ts admin verify-audit [--org <slug>]`
 * `node apps/server/src/cli/main.ts admin reset-owner-password --org <slug> --email <email> [--reset-mfa]`
 * (add-self-hosting wraps this as `crowhr admin …` inside the container.)
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const [, , group, command] = process.argv;
try {
  const config = loadConfig(process.env);
  const database = await openDatabase(config.DATABASE_URL);
  let result: { ok: boolean; lines: string[] };
  if (group === "admin" && command === "verify-audit") {
    result = await verifyAuditCommand(database.db, arg("org"));
  } else if (group === "admin" && command === "reset-owner-password") {
    const org = arg("org");
    const email = arg("email");
    if (!org || !email) {
      result = {
        ok: false,
        lines: ["Usage: crowhr admin reset-owner-password --org <slug> --email <owner email> [--reset-mfa]"],
      };
    } else {
      result = await resetOwnerPasswordCommand(cliDeps(database.db, config.PUBLIC_URL), {
        orgSlug: org,
        email,
        resetMfa: process.argv.includes("--reset-mfa"),
      });
    }
  } else {
    result = {
      ok: false,
      lines: [
        "Commands: admin verify-audit [--org <slug>] | admin reset-owner-password --org <slug> --email <email> [--reset-mfa]",
      ],
    };
  }
  await database.close();
  for (const line of result.lines) console.error(line);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
