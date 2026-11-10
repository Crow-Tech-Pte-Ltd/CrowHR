import type { Plugin } from "vite";

/**
 * Build assertion: server-only code must never reach the static demo. Fails the build when the
 * module graph contains any of these, and names the importer chain's first module.
 *
 * Node built-ins are allowed only inside PGlite, whose Emscripten glue has Node branches
 * (`node:module`, its NodeFS adapter) that are never executed in a browser.
 */
export const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /[\\/]node_modules[\\/](\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?@node-rs[\\/]argon2/,
    why: "argon2 (server password hasher)",
  },
  {
    pattern: /[\\/]node_modules[\\/](\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?pg[\\/]/,
    why: "node-postgres (server driver)",
  },
  {
    pattern: /[\\/]node_modules[\\/](\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?pg-pool[\\/]/,
    why: "pg-pool (server driver)",
  },
  {
    pattern: /[\\/]node_modules[\\/](\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?nodemailer[\\/]/,
    why: "nodemailer (server SMTP)",
  },
  {
    pattern: /[\\/]node_modules[\\/](\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?@hono[\\/]node-server/,
    why: "@hono/node-server",
  },
  { pattern: /drizzle-orm[\\/]node-postgres/, why: "drizzle's node-postgres driver" },
  {
    pattern: /[\\/]node_modules[\\/](\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?@sentry[\\/]/,
    why: "the Sentry SDK (the demo never reports errors)",
  },
  { pattern: /[\\/]apps[\\/]server[\\/]/, why: "apps/server (the Node host)" },
  { pattern: /[\\/]packages[\\/]core[\\/]testing[\\/]/, why: "core's Node-only test harness" },
];

const NODE_BUILTIN =
  /^(node:)?(fs|fs\/promises|path|os|crypto|child_process|net|tls|http|https|stream|zlib|module|url|worker_threads|util)$/;
const PGLITE = /@electric-sql[\\/]pglite[\\/]/;

export function checkModuleIds(ids: Iterable<string>, importers: (id: string) => readonly string[] = () => []) {
  const problems: string[] = [];
  for (const id of ids) {
    const clean = id.replace(/^\0/, "").replace(/\?.*$/, "");
    for (const f of FORBIDDEN) if (f.pattern.test(clean)) problems.push(`${f.why}: ${clean}`);
    const bare = clean.replace(/^__vite-browser-external:/, "");
    if (NODE_BUILTIN.test(bare)) {
      const from = importers(id).filter((i) => !PGLITE.test(i));
      if (from.length) problems.push(`Node built-in "${bare}" imported by ${from.join(", ")}`);
    }
  }
  return problems;
}

export function forbidServerModules(): Plugin {
  return {
    name: "crowhr-demo:forbid-server-modules",
    apply: "build",
    generateBundle() {
      const ids = [...this.getModuleIds()];
      const problems = checkModuleIds(ids, (id) => this.getModuleInfo(id)?.importers ?? []);
      if (problems.length) {
        this.error(`Server-only code reached the demo bundle:\n  ${problems.join("\n  ")}`);
      }
    },
  };
}
