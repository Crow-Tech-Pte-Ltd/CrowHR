import { parseSecretKey } from "@crowhr/core";
import { z } from "zod";

function httpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search) return url;
  } catch {
    return undefined;
  }
}

const callback = z.string().refine((value) => {
  const url = httpsUrl(value);
  const providerId = url?.pathname.match(/^\/api\/v1\/auth\/oidc\/([^/]+)\/callback$/)?.[1];
  return value === url?.href && z.uuid().safeParse(providerId).success;
}, "Use the customer's exact HTTPS Crow HR callback URL.");

const secret = z.string().min(43);
const keyBytes = z.string().transform((raw, ctx) => {
  try {
    return parseSecretKey(raw);
  } catch {
    ctx.addIssue({ code: "custom", message: "Use a 32-byte hex or base64 key." });
    return z.NEVER;
  }
});
const privateKey = z.looseObject({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  kid: z.string().min(1),
  use: z.enum(["sig", "enc"]),
  alg: z.enum(["ES256", "ECDH-ES+A256KW"]),
  x: z.string().min(1),
  y: z.string().min(1),
  d: z.string().min(1),
});
const jwks = z.strictObject({ keys: z.array(privateKey).min(1) }).superRefine(({ keys }, ctx) => {
  if (
    new Set(keys.map((key) => key.kid)).size !== keys.length ||
    keys.some((key) => (key.use === "sig" ? key.alg !== "ES256" : key.alg !== "ECDH-ES+A256KW"))
  )
    ctx.addIssue({ code: "custom", message: "Use distinct key IDs and the proper algorithm for each key use." });
});

const configSchema = z.strictObject({
  issuer: z
    .string()
    .refine((value) => httpsUrl(value)?.origin === value, "Use the shared HTTPS origin without a path."),
  databaseUrl: z.string().refine((url) => /^postgres(?:ql)?:\/\//.test(url), "Use a PostgreSQL connection URL."),
  port: z.int().min(1).max(65535).default(8081),
  subjectKey: keyBytes,
  attemptKey: keyBytes,
  cookieKeys: z.array(secret).min(1),
  signingKeys: jwks.refine(({ keys }) => keys.every((key) => key.use === "sig"), "Use downstream signing keys."),
  singpass: z.strictObject({
    environment: z.enum(["staging", "production"]),
    clientId: z.string().regex(/^[A-Za-z0-9]{32}$/),
    keys: jwks.refine(
      ({ keys }) => keys.length === 2 && new Set(keys.map((key) => key.use)).size === 2,
      "Use one upstream signing key and one upstream encryption key.",
    ),
  }),
  clients: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
        secret,
        callback,
        suspended: z.boolean().default(false),
      }),
    )
    .superRefine((clients, ctx) => {
      for (const field of ["id", "secret", "callback"] as const) {
        if (new Set(clients.map((client) => client[field])).size !== clients.length) {
          ctx.addIssue({ code: "custom", message: `Each hosted instance needs its own ${field}.` });
        }
      }
    }),
});

export type BrokerConfig = z.output<typeof configSchema>;
export type HostedClient = BrokerConfig["clients"][number];

/** Errors identify fields without echoing the contents of the operator's secret file. */
export function parseConfig(json: string): BrokerConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Managed login configuration must be valid JSON.");
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid managed login fields: ${result.error.issues.map((issue) => issue.path.join(".") || "root").join(", ")}.`,
    );
  }
  const config = result.data;
  if (Buffer.from(config.subjectKey).equals(Buffer.from(config.attemptKey))) {
    throw new Error("Use independent subjectKey and attemptKey values.");
  }
  return config;
}
