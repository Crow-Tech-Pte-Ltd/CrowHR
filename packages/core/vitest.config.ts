import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "core",
    include: ["src/**/*.test.ts", "testing/**/*.test.ts", "scripts/**/*.test.ts"],
    // PGlite boots a WASM Postgres per test database; give it room on slow CI.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
