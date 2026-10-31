import { fileURLToPath } from "node:url";
import { parseSecretKey } from "@crowhr/core";
import { z } from "zod";

const defaultWebDist = fileURLToPath(new URL("../../web/dist", import.meta.url));

const bool = z
  .enum(["true", "false", "1", "0"], { error: "Use true or false." })
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required." })
    .trim()
    .refine((v) => /^postgres(ql)?:\/\//.test(v) || /^pglite:/.test(v), {
      error: "Use postgres://user:password@host:5432/db, or pglite:memory / pglite:<directory> for local development.",
    }),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce
    .number({ error: "PORT must be a number." })
    .int()
    .min(1, { error: "PORT must be between 1 and 65535." })
    .max(65535, { error: "PORT must be between 1 and 65535." })
    .default(3000),
  FILE_STORAGE_DIR: z.string().trim().min(1).default("./data/files"),
  WEB_DIST_DIR: z.string().trim().min(1).default(defaultWebDist),
  MIGRATE_ON_START: bool.default(true),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"], { error: "Use debug, info, warn or error." }).default("info"),
  /**
   * The address people open Crow HR at, e.g. https://hr.example.sg. Drives the CSRF origin
   * check, cookie security and SSO redirect URIs. Plain http works for a LAN install.
   */
  PUBLIC_URL: z
    .string({ error: "PUBLIC_URL is required: the address people open Crow HR at, like https://hr.example.sg." })
    .trim()
    .refine((v) => /^https?:\/\/[^/\s]+$/.test(v.replace(/\/$/, "")), {
      error: "Use the origin only, like https://hr.example.sg or http://192.168.1.20:8080 (no path).",
    })
    .transform((v) => v.replace(/\/$/, "")),
  /**
   * 32 random bytes, base64 or hex. Encrypts NRIC, bank numbers and MFA/SSO secrets. Back it up:
   * losing it makes that data unreadable. (add-self-hosting generates it on first boot when unset.)
   */
  CROWHR_SECRET_KEY: z
    .string({
      error:
        "CROWHR_SECRET_KEY is required. Generate one with `openssl rand -base64 32` and keep a copy with your backups.",
    })
    .trim()
    .refine(
      (v) => {
        try {
          parseSecretKey(v);
          return true;
        } catch {
          return false;
        }
      },
      {
        error:
          "CROWHR_SECRET_KEY must be 32 random bytes encoded as base64 or hex. Generate one with `openssl rand -base64 32`.",
      },
    ),
});

export type ServerConfig = z.output<typeof envSchema>;

export class ConfigError extends Error {
  override name = "ConfigError";
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee .env.example for every variable.`,
    );
    this.problems = problems;
  }
}

/** Parses and validates the environment. Throws ConfigError listing every problem at once. */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  // Treat empty strings as unset so `PORT=` falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return result.data;
}
