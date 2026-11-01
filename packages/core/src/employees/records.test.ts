import { describe, expect, it } from "vitest";
import { displayName } from "./records.ts";

describe("employee names in shared administrative views", () => {
  it("keeps the full name when the employee has a preferred name", () => {
    expect(displayName({ legalName: "Ahmad Ismail", preferredName: "Ahmad" })).toBe("Ahmad Ismail");
    expect(displayName({ legalName: "Goh Jun Jie", preferredName: null })).toBe("Goh Jun Jie");
  });
});
