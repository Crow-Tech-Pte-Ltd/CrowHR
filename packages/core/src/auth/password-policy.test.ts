import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password-policy.ts";

describe("password policy", () => {
  it("accepts 12 to 128 characters with no composition rules", () => {
    expect(passwordProblem("kopi peng siew dai")).toBeNull();
    expect(passwordProblem(`${"a".repeat(5)}bcdefghxyz7`)).toBeNull();
    expect(passwordProblem(`${"ü".repeat(6)}teh tarik`)).toBeNull();
    expect(passwordProblem(`${"x9".repeat(64).slice(0, 127)}z`)).toBeNull();
  });

  it("refuses short and overlong passwords with how to fix it", () => {
    expect(passwordProblem("short pass")).toBe(
      "Use at least 12 characters. A short phrase of a few unrelated words works well.",
    );
    expect(passwordProblem("a1".repeat(65))).toBe("Use at most 128 characters.");
  });

  it("refuses the bundled common passwords and their patterns", () => {
    for (const p of [
      "password1234",
      "Password1234",
      "qwertyuiop123",
      "123456789012",
      "aaaaaaaaaaaa",
      "abcabcabcabc",
      "Welcome@2026!!",
      "Singapore2026",
      "zxcvbnm12345",
    ]) {
      expect(passwordProblem(p), p).toContain("too common");
    }
    expect(passwordProblem("password1234")).toBe(
      "This password is too common and easy to guess. Choose a longer, less predictable one, such as a few unrelated words.",
    );
  });

  it("refuses the email address", () => {
    expect(passwordProblem("Aisyah@KampongKopi.example", "aisyah@kampongkopi.example")).toContain("email address");
  });
});
