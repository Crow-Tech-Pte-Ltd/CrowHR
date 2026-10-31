/**
 * The configuration reference must list every environment variable Crow HR reads, and nothing
 * else. Sources: the server and CLI code (apps/server/src), the Dockerfile's ENV, the variables
 * docker-compose.yml interpolates, and .env.example. Fails with the names to add or remove.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchAll, read, sourceFiles } from "./sources.ts";

const NAME = "[A-Z][A-Z0-9_]{2,}";

/** Set by the code for a child process, never read from the environment. */
const NOT_CONFIGURATION: Record<string, string> = {
  PGSSLMODE: "set by the backup code for pg_dump/pg_restore from DATABASE_URL's sslmode",
};

function variablesInCode(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (name: string, where: string) => {
    if (!(name in NOT_CONFIGURATION) && !found.has(name)) found.set(name, where);
  };
  for (const file of sourceFiles("apps/server/src")) {
    const text = readFileSync(file, "utf8");
    const where = file.slice(file.indexOf("apps/server"));
    // loadConfig's readers: get("X"), int("X", …), bool("X", …)
    for (const n of matchAll(text, new RegExp(`\\b(?:get|int|bool)\\("(${NAME})"`, "g"))) add(n, where);
    // env.X / process.env.X / env["X"], excluding assignments (env.X = …)
    for (const n of matchAll(text, new RegExp(`\\benv\\.(${NAME})\\b(?!\\s*=[^=])`, "g"))) add(n, where);
    for (const n of matchAll(text, new RegExp(`\\benv\\[["'](${NAME})["']\\](?!\\s*=[^=])`, "g"))) add(n, where);
  }
  // Dockerfile: ENV A=1 \ B=2 …
  const dockerfile = read("Dockerfile");
  for (const block of dockerfile.match(/^ENV [\s\S]*?(?<!\\)\n/gm) ?? []) {
    for (const n of matchAll(block, new RegExp(`(?:^ENV |\\s)(${NAME})=`, "g"))) add(n, "Dockerfile");
  }
  // docker-compose.yml: ${VAR} and ${VAR:-default}
  for (const n of matchAll(read("docker-compose.yml"), new RegExp(`\\$\\{(${NAME})`, "g")))
    add(n, "docker-compose.yml");
  // .env.example: VAR= or # VAR= at the start of a line
  for (const n of matchAll(read(".env.example"), new RegExp(`^#?\\s?(${NAME})=`, "gm"))) add(n, ".env.example");
  return found;
}

function variablesDocumented(): Set<string> {
  const page = read("apps/docs/src/content/docs/self-hosting/configuration.md");
  return new Set(matchAll(page, new RegExp(`^\\| \`(${NAME})\` \\|`, "gm")));
}

describe("configuration reference", () => {
  const inCode = variablesInCode();
  const documented = variablesDocumented();

  it("finds the variables the server reads (sanity check of the scanner)", () => {
    for (const n of ["PUBLIC_URL", "TRUSTED_PROXIES", "SMTP_URL", "MAIL_FROM", "DATABASE_PASSWORD_FILE", "HTTP_PORT"]) {
      expect(inCode.has(n), `${n} not found in code`).toBe(true);
    }
  });

  it("documents every variable the code reads", () => {
    const missing = [...inCode.entries()]
      .filter(([n]) => !documented.has(n))
      .map(([n, where]) => `${n} (read in ${where})`);
    expect(missing, "Add these to apps/docs/src/content/docs/self-hosting/configuration.md").toEqual([]);
  });

  it("documents nothing the code no longer reads", () => {
    const stale = [...documented].filter((n) => !inCode.has(n));
    expect(stale, "Remove these from the configuration reference, or the code stopped reading them").toEqual([]);
  });
});
