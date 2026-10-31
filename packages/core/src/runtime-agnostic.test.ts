import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Core must run in the browser demo, so nothing under src/ (tests excepted)
 * may import a Node built-in. tsconfig.json already omits @types/node; this
 * catches untyped/dynamic imports too.
 */
const srcDir = fileURLToPath(new URL(".", import.meta.url));
const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
// Packages known to require a Node runtime; extend as needed.
const NODE_ONLY_PACKAGES = ["pg", "@node-rs/argon2", "@hono/node-server", "drizzle-orm/node-postgres"];
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("runtime-agnostic core", () => {
  const files = sourceFiles(srcDir);

  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports no Node built-ins or Node-only packages", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
        const spec = match[1] ?? match[2] ?? match[3] ?? "";
        const bare = spec
          .split("/")
          .slice(0, spec.startsWith("@") ? 2 : 1)
          .join("/");
        if (
          NODE_BUILTINS.has(spec) ||
          NODE_BUILTINS.has(bare) ||
          NODE_ONLY_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`))
        ) {
          offenders.push(`${relative(srcDir, file)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
