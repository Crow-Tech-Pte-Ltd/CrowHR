import { describe, expect, it } from "vitest";
import { ConfigError, decodeSecretKey, loadConfig } from "./config.ts";

const prod = (env: Record<string, string>) =>
  loadConfig({ NODE_ENV: "production", DATABASE_HOST: "db", DATABASE_PASSWORD: "pw", ...env });

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error("expected a ConfigError");
}

describe("self-host configuration", () => {
  it("needs only PUBLIC_URL in the container; everything else has a working default", () => {
    const config = loadConfig(
      {
        NODE_ENV: "production",
        PUBLIC_URL: "http://192.168.1.20:8080",
        DATABASE_HOST: "db",
        DATABASE_PASSWORD_FILE: "/run/crowhr-secrets/db_password",
        DATA_DIR: "/data",
      },
      { readFile: () => "s3cr3t/with+chars\n" },
    );
    expect(config).toMatchObject({
      PUBLIC_URL: "http://192.168.1.20:8080",
      secureCookies: false,
      HOST: "0.0.0.0",
      PORT: 8080,
      DATABASE_URL: "postgres://crowhr:s3cr3t%2Fwith%2Bchars@db:5432/crowhr",
      FILE_STORAGE_DIR: "/data/files",
      SECRET_KEY_FILE: "/data/secrets/crowhr.key",
      CROWHR_SECRET_KEY: null,
      BACKUP_DIR: "/backups",
      BACKUP_TIME: { hour: 2, minute: 0 },
      BACKUP_TIMEZONE: "Asia/Singapore",
      BACKUP_KEEP: 14,
      BACKUP_PASSPHRASE: null,
      BACKUP_BEFORE_MIGRATE: true,
      MIGRATE_ON_START: true,
      DB_WAIT_SECONDS: 60,
      MIGRATE_LOCK_TIMEOUT_SECONDS: 300,
      SETUP_GATE: true,
    });
    expect(config.TRUSTED_PROXIES.entries).toEqual([]);
  });

  it("PUBLIC_URL missing scheme gives the spec's fix-it message", () => {
    expect(problemsOf(() => prod({ PUBLIC_URL: "hr.acme.sg" }))).toEqual([
      "PUBLIC_URL must start with http:// or https://, for example PUBLIC_URL=https://hr.acme.sg. Set it in .env.",
    ]);
  });

  it("PUBLIC_URL is required in production and must not have a path", () => {
    expect(problemsOf(() => prod({}))[0]).toMatch(/^PUBLIC_URL is not set\. .*PUBLIC_URL=https:\/\/hr\.acme\.sg/);
    expect(problemsOf(() => prod({ PUBLIC_URL: "https://acme.sg/hr" }))[0]).toMatch(
      /PUBLIC_URL must not contain a path.*PUBLIC_URL=https:\/\/acme\.sg\. Set it in \.env\./,
    );
  });

  it("normalises PUBLIC_URL and derives secure cookies from https", () => {
    const c = prod({ PUBLIC_URL: "https://HR.Acme.sg/" });
    expect(c.PUBLIC_URL).toBe("https://hr.acme.sg");
    expect(c.secureCookies).toBe(true);
  });

  it("TRUSTED_PROXIES parse errors list the bad entries", () => {
    const [problem] = problemsOf(() => prod({ PUBLIC_URL: "https://hr.acme.sg", TRUSTED_PROXIES: "10.0.0.1,caddy" }));
    expect(problem).toMatch(/^TRUSTED_PROXIES has an entry that is not an IP address or CIDR range: caddy\./);
    expect(problem).toMatch(/TRUSTED_PROXIES=172\.16\.0\.0\/12/);
  });

  it("CROWHR_SECRET_KEY must be 32 bytes in base64 or hex", () => {
    const hex = "ab".repeat(32);
    const b64 = Buffer.alloc(32, 7).toString("base64");
    expect(prod({ PUBLIC_URL: "https://hr.acme.sg", CROWHR_SECRET_KEY: hex }).CROWHR_SECRET_KEY).toHaveLength(32);
    expect(prod({ PUBLIC_URL: "https://hr.acme.sg", CROWHR_SECRET_KEY: b64 }).CROWHR_SECRET_KEY).toHaveLength(32);
    expect(problemsOf(() => prod({ PUBLIC_URL: "https://hr.acme.sg", CROWHR_SECRET_KEY: "short" }))[0]).toMatch(
      /CROWHR_SECRET_KEY must be 32 random bytes.*openssl rand -base64 32/,
    );
    expect(decodeSecretKey(Buffer.alloc(16).toString("base64"))).toBeNull();
  });

  it("explains a missing database password file", () => {
    const [problem] = problemsOf(() =>
      loadConfig(
        {
          NODE_ENV: "production",
          PUBLIC_URL: "https://hr.acme.sg",
          DATABASE_HOST: "db",
          DATABASE_PASSWORD_FILE: "/nope",
        },
        {
          readFile: () => {
            throw new Error("ENOENT");
          },
        },
      ),
    );
    expect(problem).toMatch(/DATABASE_PASSWORD_FILE points to \/nope.*docker compose up -d/);
  });

  it("validates backup settings", () => {
    expect(prod({ PUBLIC_URL: "https://hr.acme.sg", BACKUP_TIME: "off" }).BACKUP_TIME).toBeNull();
    expect(prod({ PUBLIC_URL: "https://hr.acme.sg", BACKUP_TIME: "23:30" }).BACKUP_TIME).toEqual({
      hour: 23,
      minute: 30,
    });
    const problems = problemsOf(() =>
      prod({
        PUBLIC_URL: "https://hr.acme.sg",
        BACKUP_TIME: "25:00",
        BACKUP_KEEP: "0",
        BACKUP_PASSPHRASE: "short",
        BACKUP_TIMEZONE: "Mars/Olympus",
      }),
    );
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toMatch(/BACKUP_TIME must be a 24-hour time like BACKUP_TIME=02:00/);
    expect(problems.join("\n")).toMatch(/BACKUP_KEEP must be a whole number from 1/);
    expect(problems.join("\n")).toMatch(/BACKUP_PASSPHRASE must be at least 12 characters/);
    expect(problems.join("\n")).toMatch(/BACKUP_TIMEZONE "Mars\/Olympus" is not a known time zone/);
  });

  it("accepts a fixed SETUP_CODE for automated installs, normalised", () => {
    expect(prod({ PUBLIC_URL: "https://hr.acme.sg" }).SETUP_CODE).toBeNull();
    expect(prod({ PUBLIC_URL: "https://hr.acme.sg", SETUP_CODE: "acdefghjkmnpqrtu" }).SETUP_CODE).toBe(
      "ACDE-FGHJ-KMNP-QRTU",
    );
    expect(problemsOf(() => prod({ PUBLIC_URL: "https://hr.acme.sg", SETUP_CODE: "0000-1111-2222-3333" }))[0]).toMatch(
      /^SETUP_CODE must be 16 characters/,
    );
  });

  it("reports all problems in one run", () => {
    const problems = problemsOf(() =>
      loadConfig({
        NODE_ENV: "production",
        PUBLIC_URL: "hr.acme.sg",
        TRUSTED_PROXIES: "x",
        PORT: "0",
        CROWHR_SECRET_KEY: "y",
      }),
    );
    expect(problems.map((p) => p.split(" ")[0])).toEqual([
      "PORT",
      "PUBLIC_URL",
      "TRUSTED_PROXIES",
      "DATABASE_URL",
      "CROWHR_SECRET_KEY",
    ]);
    for (const p of problems) expect(p).toMatch(/Set it in \.env\.$/);
  });
});
