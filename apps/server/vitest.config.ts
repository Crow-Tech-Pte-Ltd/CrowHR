import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "server",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    // Each test file boots a WASM Postgres (PGlite) in beforeEach; slow under load.
    hookTimeout: 30_000,
  },
});
