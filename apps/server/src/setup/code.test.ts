import { createMemoryLogger, hashSetupCode, SETUP_CODE_ALPHABET, schema } from "@crowhr/core";
import { createTestDb, type TestDb } from "@crowhr/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareSetupCode, setupBanner } from "./code.ts";

describe("setup code on start", () => {
  let testDb: TestDb;
  beforeEach(async () => {
    testDb = await createTestDb();
  });
  afterEach(() => testDb.close());

  const start = async () => {
    const printed: string[] = [];
    const result = await prepareSetupCode({
      db: testDb.db,
      publicUrl: "http://192.168.1.20:8080",
      logger: createMemoryLogger(),
      print: (t) => printed.push(t),
    });
    return { result, printed: printed.join("\n") };
  };

  it("is 16 characters from an unambiguous alphabet, grouped XXXX-XXXX-XXXX-XXXX", async () => {
    const { result } = await start();
    expect(result?.code).toMatch(/^([A-Z0-9]{4}-){3}[A-Z0-9]{4}$/);
    for (const ch of result?.code.replace(/-/g, "") ?? "") expect(SETUP_CODE_ALPHABET).toContain(ch);
  });

  it("prints a clearly marked block with the code and <PUBLIC_URL>/setup", async () => {
    const { result, printed } = await start();
    expect(printed).toContain("CROW HR SETUP CODE");
    expect(printed).toContain(result?.code);
    expect(printed).toContain("Open http://192.168.1.20:8080/setup");
    expect(printed).toMatch(/={20,}/);
  });

  it("stores only the hash, and a new code on each start replaces the old one", async () => {
    const first = await start();
    const second = await start();
    expect(second.result?.code).not.toBe(first.result?.code);
    const rows = await testDb.db.select().from(schema.systemSettings);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(second.result?.code.slice(0, 4));
    expect(rows[0]?.value).toMatchObject({ hash: await hashSetupCode(second.result?.code ?? "") });
  });

  it("prints nothing once setup is done", async () => {
    await testDb.db.insert(schema.organisations).values({ id: "0190f000-0000-7000-8000-00000000000a", name: "Acme" });
    const { result, printed } = await start();
    expect(result).toBeNull();
    expect(printed).toBe("");
  });

  it("the banner lines up", () => {
    const lines = setupBanner("ACDE-FGHJ-KMNP-QRTU", "https://hr.acme.sg/setup").split("\n");
    expect(lines[1]).toBe(lines.at(-2));
  });
});
