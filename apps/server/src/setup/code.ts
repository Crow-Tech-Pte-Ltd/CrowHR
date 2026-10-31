import { type Db, generateSetupCode, isSetupRequired, type Logger, storeSetupCode } from "@crowhr/core";

/**
 * First-run setup code (self-hosting spec "First-run setup wizard"). On every start while the
 * install has no organisation, a fresh code is generated, only its hash is stored, and the
 * code is printed in a block that stands out in `docker compose logs app`. A restart
 * invalidates the previous code.
 */
export async function prepareSetupCode(options: {
  db: Db;
  publicUrl: string;
  logger: Logger;
  /** Where the banner goes (stdout in production). */
  print: (text: string) => void;
  now?: () => Date;
  generate?: () => string;
}): Promise<{ code: string } | null> {
  if (!(await isSetupRequired(options.db))) return null;
  const code = (options.generate ?? generateSetupCode)();
  await storeSetupCode(options.db, code, (options.now ?? (() => new Date()))());
  options.print(setupBanner(code, `${options.publicUrl}/setup`));
  options.logger.info("Setup required: open the setup page and enter the setup code printed above", {
    setupUrl: `${options.publicUrl}/setup`,
  });
  return { code };
}

export function setupBanner(code: string, url: string): string {
  const lines = [
    "CROW HR SETUP CODE",
    "",
    `  ${code}`,
    "",
    `Open ${url}`,
    "and enter this code to create your organisation and owner account.",
    "The code changes every time the app restarts. Show it again with:",
    "  docker compose logs app | grep -A3 'SETUP CODE'",
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = "=".repeat(width);
  return ["", bar, ...lines.map((l) => `  ${l}`), bar, ""].join("\n");
}
