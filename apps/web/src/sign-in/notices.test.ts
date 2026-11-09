import { describe, expect, it } from "vitest";
import { noticeFor } from "./notices.ts";

describe("sign-in notices", () => {
  it("explains an idle timeout", () => {
    expect(noticeFor({ reason: "expired" }, "Kampong Kopi")?.body).toBe(
      "You were signed out after a period of inactivity. Sign in again to continue.",
    );
  });
  it("names the organisation when the SSO user isn't provisioned", () => {
    expect(noticeFor({ error: "not_provisioned", provider: "Google" }, "Kampong Kopi")?.body).toBe(
      "Your account has not been set up in Kampong Kopi. Ask your HR team for an invitation.",
    );
  });
  it("keeps SSO failures generic, naming only the provider", () => {
    expect(noticeFor({ error: "sso_failed", provider: "Okta" }, "X")?.body).toBe(
      "Sign-in with Okta failed. Try again, or use another sign-in method.",
    );
  });
  it("is empty without a reason", () => expect(noticeFor({}, "X")).toBeNull());
  it("explains a demo Singpass login that didn't finish, and a busy demo", () => {
    expect(noticeFor({ singpass: "failed", reason: "token_validation_failed" }, "Kopi Kaki")).toEqual({
      tone: "warning",
      title: "Singpass login didn't finish",
      body: "Try again, or pick someone below to look around without Singpass.",
    });
    expect(noticeFor({ singpass: "failed", reason: "busy" }, "Kopi Kaki")?.body).toBe(
      "The demo has had a lot of Singpass logins. Try again later, or pick someone below to look around without Singpass.",
    );
    // Back from Singpass successfully: the HR admin / Employee choice is shown instead of a notice.
    expect(noticeFor({ singpass: "ok" }, "Kopi Kaki")).toBeNull();
  });
});
