import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "demo",
    include: ["src/**/*.test.ts"],
    // bundled-migrations.ts uses import.meta.glob over packages/core/drizzle. The fs module cache
    // does not see new SQL files, so a cached transform would miss fresh migrations.
    fsModuleCache: false,
    // The seed runs the real payroll engine on PGlite (WASM): give it room on slow machines.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
