import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

const BASE = {
  DATABASE_URL: "postgres://u:p@localhost:5432/crowhr",
  PUBLIC_URL: "https://hr.example.sg",
  CROWHR_SECRET_KEY: "A".repeat(43),
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(BASE);
    expect(config).toMatchObject({ HOST: "127.0.0.1", PORT: 3000, MIGRATE_ON_START: true, LOG_LEVEL: "info" });
    expect(config.WEB_DIST_DIR).toMatch(/apps\/web\/dist$/);
  });

  it("accepts pglite URLs for local development", () => {
    expect(loadConfig({ ...BASE, DATABASE_URL: "pglite:memory" }).DATABASE_URL).toBe("pglite:memory");
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
        "PUBLIC_URL: PUBLIC_URL is required: the address people open Crow HR at, like https://hr.example.sg.",
        "CROWHR_SECRET_KEY: CROWHR_SECRET_KEY is required. Generate one with `openssl rand -base64 32` and keep a copy with your backups.",
      ]);
      expect(message).toContain(".env.example");
    }
  });

  it("rejects unsupported database URLs with the accepted forms", () => {
    expect(() => loadConfig({ ...BASE, DATABASE_URL: "mysql://x" })).toThrow(/postgres:\/\/user:password@host/);
  });

  it("refuses a short or malformed CROWHR_SECRET_KEY with how to generate one", () => {
    expect(() => loadConfig({ ...BASE, CROWHR_SECRET_KEY: "too-short" })).toThrow(/openssl rand -base64 32/);
    expect(loadConfig({ ...BASE, CROWHR_SECRET_KEY: "ab".repeat(32) }).CROWHR_SECRET_KEY).toBe("ab".repeat(32));
  });

  it("refuses a PUBLIC_URL with a path and strips a trailing slash", () => {
    expect(() => loadConfig({ ...BASE, PUBLIC_URL: "https://hr.example.sg/app" })).toThrow(/origin only/);
    expect(() => loadConfig({ ...BASE, PUBLIC_URL: "hr.example.sg" })).toThrow(/origin only/);
    expect(loadConfig({ ...BASE, PUBLIC_URL: "http://192.168.1.20:8080/" }).PUBLIC_URL).toBe(
      "http://192.168.1.20:8080",
    );
  });
});
