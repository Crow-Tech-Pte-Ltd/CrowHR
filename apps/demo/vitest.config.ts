import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "demo-app",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
