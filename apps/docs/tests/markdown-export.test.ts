import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../../packages/core/src/employees/import/templates.ts";
import {
  AI_SETUP_PROMPT,
  absoluteLinks,
  importColumnsMarkdown,
  mdxToMarkdown,
  pageMarkdown,
  permissionMatrixMarkdown,
} from "../src/lib/markdown.ts";
import { matrixGroups } from "../src/lib/permissions.ts";
import { slugsInOrder } from "../src/lib/sidebar.ts";

/** The Markdown copies (`<page>.md`, llms-full.txt) and the AI setup prompt. */

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "../src/content/docs");

function pages(dir = CONTENT, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pages(path, out);
    else if (/\.mdx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const idOf = (file: string) => relative(CONTENT, file).replace(/\.mdx?$/, "");
const bodyOf = (file: string) => readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");

describe("MDX pages export to plain Markdown", () => {
  const mdx = pages().filter((f) => f.endsWith(".mdx"));

  it.each(mdx.map((f) => [idOf(f), f]))("%s has no MDX left", (_id, file) => {
    const md = mdxToMarkdown(bodyOf(file));
    expect(md).not.toMatch(/^import .+ from /m);
    expect(md).not.toMatch(/<[A-Z][A-Za-z]+[\s/>]/); // components
    expect(md).not.toMatch(/\{[A-Z_]+[\s}?]/); // expressions such as {TRY_URL}
    expect(md).not.toMatch(/<\/?p>/);
  });

  it("renders the permission matrix from the same data as the page", () => {
    const md = permissionMatrixMarkdown();
    const rows = matrixGroups().reduce((n, g) => n + g.rows.length, 0);
    expect(md.match(/^\| `[a-z_]+:[a-z_]+`/gm)).toHaveLength(rows);
    for (const group of matrixGroups()) expect(md).toContain(`### ${group.label}`);
  });

  it.each(Object.keys(TEMPLATES))("renders the %s import columns", (kind) => {
    const md = importColumnsMarkdown(kind);
    const template = TEMPLATES[kind as keyof typeof TEMPLATES];
    expect(md.match(/^\| `/gm)).toHaveLength(template.columns.length);
    expect(md).toContain(template.fileName);
  });

  it("makes docs links absolute and heads each page with its title, summary and source", () => {
    expect(absoluteLinks("See [backups](/docs/self-hosting/backups/).")).toBe(
      "See [backups](https://hr.crow.sg/docs/self-hosting/backups/).",
    );
    const md = pageMarkdown({
      id: "self-hosting/install",
      title: "Install",
      description: "How.",
      body: "Text.",
      mdx: false,
    });
    expect(md).toBe("# Install\n\n> How.\n\nSource: https://hr.crow.sg/docs/self-hosting/install/\n\nText.\n");
  });
});

describe("llms.txt lists every page", () => {
  it("every docs page is in the sidebar, so llms.txt and the navigation agree", () => {
    const inSidebar = new Set(slugsInOrder().map((s) => s.slug));
    const missing = pages()
      .map(idOf)
      .filter((id) => !["index", "404"].includes(id) && !inSidebar.has(id));
    expect(missing).toEqual([]);
  });
});

describe("AI setup prompt", () => {
  it("only links docs pages that exist", () => {
    const ids = new Set(pages().map(idOf));
    const linked = [...AI_SETUP_PROMPT.matchAll(/https:\/\/hr\.crow\.sg\/docs\/([a-z0-9/-]+)\.md/g)].map((m) => m[1]);
    expect(linked.length).toBeGreaterThan(0);
    for (const id of linked) expect(ids.has(id as string), id).toBe(true);
  });

  it("keeps the safety rules and leaves the secrets to the person", () => {
    for (const phrase of [
      "Never run `docker compose down -v`",
      "Keep secrets out of this chat",
      "BACKUP_PASSPHRASE",
      "SETUP CODE",
      "crowhr doctor",
      "PUBLIC_URL",
      "TRUSTED_PROXIES",
    ]) {
      expect(AI_SETUP_PROMPT).toContain(phrase);
    }
    expect(AI_SETUP_PROMPT).not.toMatch(/\{\{|TODO/);
  });

  it("names only configuration variables the reference documents", () => {
    const reference = readFileSync(join(CONTENT, "self-hosting/configuration.md"), "utf8");
    const documented = new Set([...reference.matchAll(/^\| `([A-Z_]+)`/gm)].map((m) => m[1]));
    // Shell placeholders and the tunnel token (set in the override file, documented on the proxy page).
    const exempt = new Set(["CLOUDFLARE_TUNNEL_TOKEN", "SETUP", "CODE", "NRIC"]);
    const named = [...AI_SETUP_PROMPT.matchAll(/`([A-Z][A-Z_]{3,})(?:=[^`]*)?`/g)].map((m) => m[1] as string);
    for (const name of named) if (!exempt.has(name)) expect(documented.has(name), name).toBe(true);
  });
});
