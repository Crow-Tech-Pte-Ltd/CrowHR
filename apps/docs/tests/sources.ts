/** Helpers for the docs-in-sync tests: read repository files relative to the repo root. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DOCS = join(REPO, "apps/docs/src/content/docs");

export function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/** Every non-test TypeScript file under a repository directory. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
    }
  };
  walk(join(REPO, dir));
  return out;
}

export function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1] as string);
}
