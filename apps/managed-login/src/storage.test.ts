import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStorage } from "./storage.ts";

const db = new PGlite();
const storage = createStorage((statement, parameters) => db.query(statement, parameters), "test");

beforeAll(storage.initialise);
afterAll(() => db.close());

describe("managed login protocol storage", () => {
  it("allows only one redemption across concurrent requests", async () => {
    const codes = storage.adapter("AuthorizationCode");
    await codes.upsert("code", { clientId: "customer-a" }, 60);
    const attempts = await Promise.allSettled([codes.consume("code"), codes.consume("code")]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(await codes.find("code")).toHaveProperty("consumed");
  });

  it("rejects expired codes and upstream attempts", async () => {
    const codes = storage.adapter("AuthorizationCode");
    await codes.upsert("expired", { clientId: "customer-a" }, 0);
    expect(await codes.find("expired")).toBeUndefined();
    await expect(codes.consume("expired")).rejects.toThrow();
    const attempt = { state: "expired", interaction: "expired-session", client: "customer-a", sealed: "sealed" };
    await storage.saveAttempt(attempt);
    await db.query("UPDATE managed_login_attempts SET expires_at = now() WHERE interaction = $1", [
      attempt.interaction,
    ]);
    expect(await storage.takeAttempt(attempt)).toBeUndefined();
  });

  it("binds an upstream attempt to its original interaction and client", async () => {
    const original = { state: "original-state", interaction: "session-a", client: "customer-a", sealed: "sealed" };
    await storage.saveAttempt(original);
    expect(await storage.takeAttempt({ ...original, client: "customer-b" })).toBeUndefined();
    expect(await storage.takeAttempt({ ...original, interaction: "session-b" })).toBeUndefined();
    expect(await storage.takeAttempt(original)).toBe("sealed");
    expect(await storage.takeAttempt(original)).toBeUndefined();
  });

  it("removes the old state when the same interaction starts again", async () => {
    const original = { state: "start-a", interaction: "retry", client: "customer-a", sealed: "first" };
    const retry = { ...original, state: "start-b", sealed: "second" };
    await storage.saveAttempt(original);
    await storage.saveAttempt(retry);
    expect(await storage.takeAttempt(original)).toBeUndefined();
    expect(await storage.takeAttempt(retry)).toBe("second");
  });
});
