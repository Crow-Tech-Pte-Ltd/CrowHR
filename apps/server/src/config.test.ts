import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://u:p@localhost:5432/crowhr" });
    expect(config).toMatchObject({ HOST: "127.0.0.1", PORT: 3000, MIGRATE_ON_START: true, LOG_LEVEL: "info" });
    expect(config.WEB_DIST_DIR).toMatch(/apps\/web\/dist$/);
  });

  it("accepts pglite URLs for local development", () => {
    expect(loadConfig({ DATABASE_URL: "pglite:memory" }).DATABASE_URL).toBe("pglite:memory");
  });

  it("names every missing or invalid variable and how to fix it", () => {
    try {
      loadConfig({ PORT: "99999", LOG_LEVEL: "loud", MIGRATE_ON_START: "yes" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const { problems, message } = err as ConfigError;
      expect(problems).toEqual([
        "DATABASE_URL: DATABASE_URL is required.",
        "PORT: PORT must be between 1 and 65535.",
        "MIGRATE_ON_START: Use true or false.",
        "LOG_LEVEL: Use debug, info, warn or error.",
      ]);
      expect(message).toContain(".env.example");
    }
  });

  it("rejects unsupported database URLs with the accepted forms", () => {
    expect(() => loadConfig({ DATABASE_URL: "mysql://x" })).toThrow(/postgres:\/\/user:password@host/);
  });
});
