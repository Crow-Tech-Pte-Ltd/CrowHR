import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initDbPassword } from "../secrets/db-password.ts";
import { runCli } from "./main.ts";

describe("crowhr init-secrets", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-init-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes the database password once, with mode 0600", async () => {
    const path = join(dir, "secrets", "db_password");
    expect(await initDbPassword(path)).toEqual({ created: true, path });
    const password = (await readFile(path, "utf8")).trim();
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await initDbPassword(path)).toEqual({ created: false, path });
    expect((await readFile(path, "utf8")).trim()).toBe(password);
  });

  it("exits 0 through the CLI and is idempotent", async () => {
    const path = join(dir, "db_password");
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) };
    expect(await runCli(["init-secrets"], { DATABASE_PASSWORD_FILE: path }, io)).toBe(0);
    const first = await readFile(path, "utf8");
    expect(await runCli(["init-secrets"], { DATABASE_PASSWORD_FILE: path }, io)).toBe(0);
    expect(await readFile(path, "utf8")).toBe(first);
    expect(out.join("\n")).toMatch(/Generated a database password.*already exists/s);
  });
});
