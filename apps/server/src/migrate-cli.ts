import { runCli } from "./cli/main.ts";

// `bun run --cwd apps/server migrate`: same as `crowhr migrate`.
process.exit(await runCli(["migrate"], process.env));
