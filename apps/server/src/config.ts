import { fileURLToPath } from "node:url";
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
