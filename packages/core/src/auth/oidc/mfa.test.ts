import { describe, expect, it } from "vitest";
import { entraEmailVerified, idpAssertsMfa } from "./mfa.ts";

describe("verified OIDC claims", () => {
  it("requires an explicit MFA assertion, rather than a single factor", () => {
    for (const amr of [["otp"], ["hwk"], ["sms"], ["face"], ["otp-sms"], ["pwd"], undefined]) {
      expect(idpAssertsMfa({ amr })).toBe(false);
    }
    expect(idpAssertsMfa({ amr: ["pwd", "mfa"] })).toBe(true);
  });
  it("does not trust an absent or false Entra verification claim", () => {
    for (const xms_edov of [undefined, false, "false", 0, "0"]) expect(entraEmailVerified({ xms_edov })).toBe(false);
    expect(entraEmailVerified({ xms_edov: true })).toBe(true);
  });
});
