/** The CLI reference must document every `crowhr` command and option the CLI accepts. */
import { describe, expect, it } from "vitest";
import { matchAll, read } from "./sources.ts";

const cli = read("apps/server/src/cli/main.ts");
const page = read("apps/docs/src/content/docs/self-hosting/cli.md");

describe("crowhr CLI reference", () => {
  it("documents every command", () => {
    const commands = matchAll(cli, /case "([a-z][a-z-]*)":/g);
    const adminSubcommands = matchAll(cli, /sub === "([a-z][a-z-]*)"/g).map((s) => `admin ${s}`);
    expect(commands.length).toBeGreaterThan(5);
    const missing = [...commands, ...adminSubcommands].filter((c) => !page.includes(`crowhr ${c}`));
    expect(missing, "Add these commands to apps/docs/src/content/docs/self-hosting/cli.md").toEqual([]);
  });

  it("documents every option in the CLI help", () => {
    const help = cli.slice(cli.indexOf("const HELP"), cli.indexOf("`;", cli.indexOf("const HELP")));
    const options = [...new Set(matchAll(help, /(--[a-z][a-z-]+)/g))];
    expect(options.length).toBeGreaterThan(3);
    const missing = options.filter((o) => !page.includes(o));
    expect(missing, "Add these options to the CLI reference").toEqual([]);
  });
});
