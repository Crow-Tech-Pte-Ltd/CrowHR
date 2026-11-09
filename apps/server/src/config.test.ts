import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("applies development defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://u:p@localhost:5432/crowhr" });
    expect(config).toMatchObject({
      HOST: "127.0.0.1",
      PORT: 8080,
      MIGRATE_ON_START: true,
      LOG_LEVEL: "info",
      PUBLIC_URL: "http://localhost:8080",
    });
    expect(config.WEB_DIST_DIR).toMatch(/apps\/web\/dist$/);
  });

  it("enables ClamAV only when configured and validates its port", () => {
    expect(loadConfig({})).toMatchObject({ CLAMAV_HOST: null, CLAMAV_PORT: 3310 });
    expect(loadConfig({ CLAMAV_HOST: "clamav.internal", CLAMAV_PORT: "3311" })).toMatchObject({
      CLAMAV_HOST: "clamav.internal",
      CLAMAV_PORT: 3311,
    });
    expect(() => loadConfig({ CLAMAV_PORT: "65536" })).toThrow(/CLAMAV_PORT/);
  });

  it("accepts pglite URLs for local development and defaults to one", () => {
    expect(loadConfig({ DATABASE_URL: "pglite:memory" }).DATABASE_URL).toBe("pglite:memory");
    expect(loadConfig({}).DATABASE_URL).toBe("pglite:./data/pglite");
  });

  it("names every invalid variable and how to fix it", () => {
    try {
      loadConfig({ PORT: "99999", LOG_LEVEL: "loud", MIGRATE_ON_START: "maybe" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const { problems, message } = err as ConfigError;
      expect(problems).toHaveLength(3);
      expect(problems[0]).toMatch(/^PORT must be a whole number from 1 to 65535, for example PORT=8080/);
      expect(problems.join("\n")).toMatch(/LOG_LEVEL must be debug, info, warn or error/);
      expect(problems.join("\n")).toMatch(/MIGRATE_ON_START must be true or false/);
      expect(message).toContain(".env.example");
    }
  });

  it("rejects unsupported database URLs with the accepted forms", () => {
    expect(() => loadConfig({ DATABASE_URL: "mysql://x" })).toThrow(/postgres:\/\/crowhr:password@db:5432\/crowhr/);
  });
});

describe("demo Singpass round trip settings", () => {
  const id = "01a1c086-96f9-793c-ac3e-aef0f1f4aae5";
  it("is off by default", () => {
    expect(loadConfig({ PUBLIC_URL: "https://hr.example.sg" })).toMatchObject({
      DEMO_SINGPASS_PROVIDER_ID: null,
      DEMO_SINGPASS_RETURN_URL: null,
    });
  });

  it("takes a provider id and an absolute return URL together", () => {
    expect(
      loadConfig({
        PUBLIC_URL: "https://hr.example.sg",
        DEMO_SINGPASS_PROVIDER_ID: id,
        DEMO_SINGPASS_RETURN_URL: "https://hr.crow.sg/sign-in/kopi-kaki",
      }),
    ).toMatchObject({
      DEMO_SINGPASS_PROVIDER_ID: id,
      DEMO_SINGPASS_RETURN_URL: "https://hr.crow.sg/sign-in/kopi-kaki",
    });
  });

  it("says what is wrong", () => {
    expect(() => loadConfig({ PUBLIC_URL: "https://hr.example.sg", DEMO_SINGPASS_PROVIDER_ID: id })).toThrow(
      /DEMO_SINGPASS_PROVIDER_ID and DEMO_SINGPASS_RETURN_URL go together/,
    );
    expect(() =>
      loadConfig({
        PUBLIC_URL: "https://hr.example.sg",
        DEMO_SINGPASS_PROVIDER_ID: "not-a-uuid",
        DEMO_SINGPASS_RETURN_URL: "https://hr.crow.sg/sign-in/kopi-kaki",
      }),
    ).toThrow(/DEMO_SINGPASS_PROVIDER_ID must be the id of a Singpass method/);
    expect(() =>
      loadConfig({
        PUBLIC_URL: "https://hr.example.sg",
        DEMO_SINGPASS_PROVIDER_ID: id,
        DEMO_SINGPASS_RETURN_URL: "/sign-in/kopi-kaki",
      }),
    ).toThrow(/DEMO_SINGPASS_RETURN_URL must be a full http:\/\/ or https:\/\/ address/);
  });
});
