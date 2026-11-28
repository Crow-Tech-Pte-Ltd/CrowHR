import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "managed-login",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
