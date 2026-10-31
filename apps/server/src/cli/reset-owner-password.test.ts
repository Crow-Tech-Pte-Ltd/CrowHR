import { createApp } from "@crowhr/core";
import { createTestDb, createTestDeps, seedMember, seedOrg, type TestDb, testClient } from "@crowhr/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetOwnerPasswordCommand } from "./admin.ts";

describe("crowhr admin reset-owner-password", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  it("prints a one-time reset link for an owner that lets them set a new password", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps, { slug: "kopi" });
    await seedMember(deps, org.id, { email: "boss@kopi.sg", roles: ["owner"], password: "forgotten passphrase!" });
    const result = await resetOwnerPasswordCommand(deps, { orgSlug: "kopi", email: "boss@kopi.sg", resetMfa: true });
    expect(result.ok).toBe(true);
    const url = result.lines[1] as string;
    expect(url).toMatch(/^https:\/\/hr\.test\/reset\//);
    const app = createApp(deps);
    const res = await testClient(app, deps).post("/api/v1/auth/password-reset/complete", {
      token: url.split("/reset/")[1],
      password: "brand new owner passphrase",
    });
    expect(res.status).toBe(200);
  });

  it("refuses non-owners and unknown organisations", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps, { slug: "kopi" });
    await seedMember(deps, org.id, { email: "staff@kopi.sg" });
    expect(
      (await resetOwnerPasswordCommand(deps, { orgSlug: "kopi", email: "staff@kopi.sg", resetMfa: false })).ok,
    ).toBe(false);
    expect(
      (await resetOwnerPasswordCommand(deps, { orgSlug: "nope", email: "x@y.sg", resetMfa: false })).lines[0],
    ).toContain("No organisation");
  });
});
