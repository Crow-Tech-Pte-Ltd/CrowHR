import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "sg-rules",
    include: ["src/**/*.test.ts"],
  },
});
