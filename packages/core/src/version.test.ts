import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "./version.ts";

/**
 * One product version: the root package.json, every workspace and the version the server reports
 * (health, meta, Settings → System, `crowhr --version`, backup manifests) are the same, and the
 * changelog has a section for it. The release workflow builds image tags from this version and
 * refuses a git tag that does not match it.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as { version?: string };

function workspaceManifests(): string[] {
  return ["apps", "packages"].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}/package.json`)
      .filter((path) => {
        try {
          readFileSync(join(root, path));
          return true;
        } catch {
          return false;
        }
      }),
  );
}

describe("product version", () => {
  it("is a semantic version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it("is the root package.json version", () => {
    expect(readJson("package.json").version).toBe(VERSION);
  });

  it("is the version of every workspace", () => {
    const manifests = workspaceManifests();
    expect(manifests.length).toBeGreaterThanOrEqual(8);
    const mismatched = manifests.filter((path) => readJson(path).version !== VERSION);
    expect(mismatched, `set "version": "${VERSION}" in these`).toEqual([]);
  });

  it("has a CHANGELOG.md section", () => {
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const escaped = VERSION.replace(/\./g, "\\.");
    expect(changelog).toMatch(new RegExp(`^## \\[${escaped}\\]`, "m"));
  });
});
