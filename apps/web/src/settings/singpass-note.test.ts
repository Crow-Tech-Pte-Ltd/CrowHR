import { describe, expect, it } from "vitest";
import { singpassNote } from "./singpass-note.ts";

const base = { configured: true, environment: "staging" as const, lastTestOkAt: null };

describe("singpassNote", () => {
  it("says nothing while Singpass has not issued a client ID (the setup steps show instead)", () => {
    expect(singpassNote({ ...base, configured: false })).toBeNull();
  });

  it("asks for a staging test with a test account first", () => {
    expect(singpassNote(base)).toEqual({
      tone: "warning",
      text: "Not tested yet. Run Test sign-in with a Singpass staging test account (Developer Portal → Test account).",
    });
  });

  it("after a passed staging test, points to the production step instead of claiming a simulation", () => {
    const note = singpassNote({ ...base, lastTestOkAt: "2026-11-09T14:10:00.000Z" });
    expect(note).toEqual({
      tone: "info",
      text: "Staging test passed. For production, switch to Production with the production client ID and test again.",
    });
    expect(note?.text).not.toMatch(/simulated/i);
  });

  it("in production, asks for a test until one passes, then says nothing", () => {
    expect(singpassNote({ ...base, environment: "production" })).toEqual({
      tone: "warning",
      text: "Production: run Test sign-in before turning it on.",
    });
    expect(singpassNote({ ...base, environment: "production", lastTestOkAt: "2026-11-09T14:10:00.000Z" })).toBeNull();
  });
});
