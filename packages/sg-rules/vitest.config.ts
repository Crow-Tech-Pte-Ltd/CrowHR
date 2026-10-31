import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sg-rules",
    include: ["src/**/*.test.ts"],
    // `bun run coverage` here (root: `bun run coverage:sg-rules`, part of `bun run check`). Coverage
    // options apply only when this package is run on its own, not as a project of the root config.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__fixtures__/**"],
      reporter: ["text-summary"],
      reportsDirectory: "../../coverage/sg-rules",
      thresholds: { lines: 95 },
    },
  },
});
