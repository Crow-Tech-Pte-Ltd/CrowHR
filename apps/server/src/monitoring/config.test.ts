import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../config.ts";
import { dsnOrigin, isDsn, readMonitoringConfig } from "./config.ts";

const DSN = "https://0123456789abcdef@glitchtip.example.sg/7";
const read = (env: Record<string, string>, production = true) =>
  readMonitoringConfig(env, { version: "1.4.0", production });

describe("monitoring configuration", () => {
  it("is off without a DSN, whatever else is set", () => {
    expect(read({})).toEqual({ config: null, problems: [] });
    expect(read({ SENTRY_DSN: " ", SENTRY_TRACES_SAMPLE_RATE: "lots", SENTRY_ENABLE_LOGS: "maybe" })).toEqual({
      config: null,
      problems: [],
    });
  });

  it("has working defaults once SENTRY_DSN is set", () => {
    expect(read({ SENTRY_DSN: DSN })).toEqual({
      config: {
        dsn: DSN,
        browserDsn: null,
        environment: "production",
        release: "crowhr@1.4.0",
        tracesSampleRate: 0.2,
        logs: true,
      },
      problems: [],
    });
    expect(read({ SENTRY_DSN: DSN }, false).config?.environment).toBe("development");
  });

  it("takes environment, release, sample rate, logs and a browser DSN from the environment", () => {
    const { config, problems } = read({
      SENTRY_DSN: DSN,
      SENTRY_BROWSER_DSN: "https://fedcba9876543210@glitchtip.example.sg/8",
      SENTRY_ENVIRONMENT: "staging",
      SENTRY_TRACES_SAMPLE_RATE: "0.05",
      SENTRY_ENABLE_LOGS: "false",
    });
    expect(problems).toEqual([]);
    expect(config).toMatchObject({
      browserDsn: "https://fedcba9876543210@glitchtip.example.sg/8",
      environment: "staging",
      tracesSampleRate: 0.05,
      logs: false,
    });
    expect(read({ SENTRY_DSN: DSN, SENTRY_RELEASE: "crowhr@2026.11.9" }).config?.release).toBe("crowhr@2026.11.9");
    expect(read({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: "0" }).config?.tracesSampleRate).toBe(0);
  });

  it("adds the build's commit to the release", () => {
    const sha = "06D0D6F1234567890ABCDEF1234567890ABCDEF1";
    expect(read({ SENTRY_DSN: DSN, CROWHR_GIT_SHA: sha }).config?.release).toBe("crowhr@1.4.0+06d0d6f12345");
  });

  it("can report browser errors only", () => {
    const { config } = read({ SENTRY_BROWSER_DSN: DSN });
    expect(config).toMatchObject({ dsn: null, browserDsn: DSN });
  });

  it("names each wrong variable and never echoes a DSN", () => {
    const { problems } = read({
      SENTRY_DSN: "glitchtip.example.sg/7",
      SENTRY_BROWSER_DSN: "https://glitchtip.example.sg/8",
      SENTRY_ENVIRONMENT: "my staging",
      SENTRY_TRACES_SAMPLE_RATE: "1.5",
      SENTRY_ENABLE_LOGS: "maybe",
      CROWHR_GIT_SHA: "main",
    });
    expect(problems.map((p) => p.split(" ")[0])).toEqual([
      "SENTRY_DSN",
      "SENTRY_BROWSER_DSN",
      "SENTRY_ENVIRONMENT",
      "CROWHR_GIT_SHA",
      "SENTRY_TRACES_SAMPLE_RATE",
      "SENTRY_ENABLE_LOGS",
    ]);
    expect(problems.join("\n")).not.toContain("glitchtip.example.sg/7");
    expect(read({ SENTRY_DSN: DSN, SENTRY_RELEASE: "feature/x" }).problems[0]).toMatch(/^SENTRY_RELEASE /);
  });

  it("recognises Sentry and GlitchTip DSNs", () => {
    expect(isDsn(DSN)).toBe(true);
    expect(isDsn("https://key@sentry.example.sg/sub/path/12")).toBe(true);
    expect(isDsn("http://key@127.0.0.1:9000/1")).toBe(true);
    expect(isDsn("https://glitchtip.example.sg/7")).toBe(false);
    expect(isDsn("https://key@glitchtip.example.sg/")).toBe(false);
    expect(isDsn("ftp://key@glitchtip.example.sg/7")).toBe(false);
    expect(isDsn("https://key@glitchtip.example.sg/7?x=1")).toBe(false);
    expect(dsnOrigin(DSN)).toBe("https://glitchtip.example.sg");
  });

  it("is part of the startup configuration check", () => {
    const base = {
      NODE_ENV: "production",
      PUBLIC_URL: "https://hr.acme.sg",
      DATABASE_HOST: "db",
      DATABASE_PASSWORD: "pw",
    };
    expect(loadConfig(base).monitoring).toBeNull();
    expect(loadConfig({ ...base, SENTRY_DSN: DSN }).monitoring?.dsn).toBe(DSN);
    try {
      loadConfig({ ...base, SENTRY_DSN: "not-a-dsn" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).problems[0]).toMatch(/^SENTRY_DSN is not a valid DSN/);
    }
  });
});
