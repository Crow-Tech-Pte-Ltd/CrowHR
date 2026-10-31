import { describe, expect, it } from "vitest";
import { singaporeRules } from "./index.ts";

describe("sg-rules skeleton", () => {
  it("exposes the Singapore rule set identity", () => {
    expect(singaporeRules.country).toBe("SG");
    expect(singaporeRules.currency).toBe("SGD");
  });
});
