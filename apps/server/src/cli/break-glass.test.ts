import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDeps, seedMember, seedOrg } from "@crowhr/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db.ts";
import { runCli } from "./main.ts";

describe("crowhr break-glass commands", () => {
  let dir: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-cli-"));
    env = {
      DATABASE_URL: `pglite:${join(dir, "db")}`,
      DATA_DIR: join(dir, "data"),
      PUBLIC_URL: "https://hr.kopi.sg",
    };
    const database = await openDatabase(env.DATABASE_URL as string);
    await database.migrate();
    const deps = createTestDeps(database.db);
    const org = await seedOrg(deps, { slug: "kopi" });
    await seedMember(deps, org.id, { email: "boss@kopi.sg", roles: ["owner"], password: "forgotten passphrase!" });
    await seedMember(deps, org.id, { email: "staff@kopi.sg", password: "another passphrase!" });
    await database.close();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const run = async (argv: string[]) => {
    const out: string[] = [];
    const code = await runCli(argv, env, { out: (s) => out.push(s), err: (s) => out.push(s) });
    return { code, text: out.join("\n") };
  };

  it("create-reset-link prints a one-time link for an owner, finding the only organisation", async () => {
    const { code, text } = await run(["create-reset-link", "--email", "boss@kopi.sg"]);
    expect(code).toBe(0);
    expect(text).toMatch(/https:\/\/hr\.kopi\.sg\/reset\/\S+/);
    expect(text).not.toContain("Two-step verification was cleared");
  });

  it("reset-owner-mfa also clears two-step verification", async () => {
    const { code, text } = await run(["reset-owner-mfa", "--email", "boss@kopi.sg", "--org", "kopi"]);
    expect(code).toBe(0);
    expect(text).toContain("Two-step verification was cleared");
  });

  it("refuses non-owners and explains usage", async () => {
    expect((await run(["create-reset-link", "--email", "staff@kopi.sg"])).code).toBe(1);
    expect((await run(["create-reset-link"])).code).toBe(64);
  });

  it("admin verify-audit checks the audit chain", async () => {
    const { code, text } = await run(["admin", "verify-audit"]);
    expect(code).toBe(0);
    expect(text).toMatch(/kopi: OK/);
  });

  it("help lists every command and unknown commands exit 64", async () => {
    const help = await run(["help"]);
    for (const cmd of ["backup", "restore", "migrate", "doctor", "setup-code", "init-secrets", "create-reset-link"]) {
      expect(help.text).toContain(cmd);
    }
    expect((await run(["frobnicate"])).code).toBe(64);
  });
});
