/**
 * Every docs page as Markdown (`<page>.md`, llms.txt, llms-full.txt), for people who paste docs into an
 * AI assistant and for agents that read them. MDX components are rendered from the same data as the
 * HTML page, so the Markdown can't drift from it.
 */
import { ROLES } from "../../../../packages/core/src/access/matrix.ts";
import { TEMPLATES } from "../../../../packages/core/src/employees/import/templates.ts";
import aiSetupPrompt from "./ai-setup-prompt.md?raw";
import { TRY_LIVE, TRY_URL } from "./links.ts";
import { matrixGroups, ROLE_LABELS, SCOPE_LABELS } from "./permissions.ts";

export const SITE = "https://hr.crow.sg";
export const DOCS = `${SITE}/docs`;
export const AI_SETUP_PROMPT = aiSetupPrompt.trim();

/** The HTML page's address for a docs entry id ("index", "self-hosting/install", …). */
export function pageUrl(id: string): string {
  return id === "index" ? `${DOCS}/` : `${DOCS}/${id}/`;
}

/** The Markdown copy's address. */
export function markdownUrl(id: string): string {
  return `${DOCS}/${id}.md`;
}

/** A table cell: no line breaks, and pipes escaped. */
function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
}

/** The permission matrix (PermissionMatrix.astro) as Markdown tables, one per area. */
export function permissionMatrixMarkdown(): string {
  const groups = matrixGroups();
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  const head = `| Permission | ${ROLES.map((r) => ROLE_LABELS[r]).join(" | ")} |\n|${" --- |".repeat(ROLES.length + 1)}`;
  const parts = [
    `${count} permissions in ${groups.length} areas. Cells: All = every record in the organisation, Team = the member's direct and indirect reports (not themselves), Own = their own records, Assigned = only items they are the assigned approver for, and a dash = denied.`,
  ];
  for (const group of groups) {
    const rows = group.rows.map((row) => {
      const name = row.note ? `\`${row.permission}\` (${cell(row.note)})` : `\`${row.permission}\``;
      return `| ${name} | ${row.cells.map((c) => (c.scope ? SCOPE_LABELS[c.scope] : "—")).join(" | ")} |`;
    });
    parts.push(`### ${group.label}${group.notBuilt ? " (module not built)" : ""}\n\n${head}\n${rows.join("\n")}`);
  }
  return parts.join("\n\n");
}

/** A CSV import template's columns (ImportColumns.astro) as a Markdown table. */
export function importColumnsMarkdown(kind: string): string {
  const template = TEMPLATES[kind as keyof typeof TEMPLATES];
  if (!template) throw new Error(`Unknown import template "${kind}"`);
  const rows = template.columns.map(
    (c) =>
      `| \`${c.name}\` | ${c.required ? "yes" : "no"} | ${cell(c.help)} | ${c.example ? `\`${cell(c.example)}\`` : ""} |`,
  );
  return [
    `Template file \`${template.fileName}\` (version ${template.version}), ${template.columns.length} columns.`,
    "",
    "| Column | Required | What to enter | Example |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The few inline HTML elements the MDX pages use, as Markdown. */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<a href=\{TRY_URL\}>([^<]*)<\/a>/g, `[$1](${TRY_URL})`)
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, "[$2]($1)")
    .replace(/<strong>([^<]*)<\/strong>/g, "**$1**")
    .replace(/<code>\{TRY_URL\}<\/code>/g, `\`${TRY_URL}\``)
    .replace(/<code>([^<]*)<\/code>/g, "`$1`")
    .replace(/<\/?p>/g, "")
    .trim();
}

/** MDX → plain Markdown: drop imports, render components and the expressions the pages use. */
export function mdxToMarkdown(body: string): string {
  return body
    .replace(/^import .+ from .+;?\s*$/gm, "")
    .replace(/<PermissionMatrix\s*\/>/g, () => permissionMatrixMarkdown())
    .replace(/<ImportColumns\s+kind="([a-z]+)"\s*\/>/g, (_, kind: string) => importColumnsMarkdown(kind))
    .replace(/<AiPrompt\s*\/>/g, () => `\`\`\`\`markdown\n${AI_SETUP_PROMPT}\n\`\`\`\``)
    .replace(/\{TRY_LIVE \? \(\s*([\s\S]*?)\s*\) : \(\s*([\s\S]*?)\s*\)\}/g, (_, live: string, notYet: string) =>
      htmlToMarkdown(TRY_LIVE ? live : notYet),
    )
    .replace(/\{TRY_URL\}/g, TRY_URL)
    .replace(/\n{3,}/g, "\n\n");
}

/** Site-relative docs links become absolute, so a copied page still works outside the site. */
export function absoluteLinks(markdown: string): string {
  return markdown.replace(/\]\(\/docs\//g, `](${DOCS}/`);
}

export interface DocForExport {
  id: string;
  title: string;
  description: string;
  body: string;
  mdx: boolean;
}

/** One page as a self-contained Markdown document. */
export function pageMarkdown(doc: DocForExport): string {
  const body = absoluteLinks(doc.mdx ? mdxToMarkdown(doc.body) : doc.body).trim();
  return `# ${doc.title}\n\n> ${doc.description}\n\nSource: ${pageUrl(doc.id)}\n\n${body}\n`;
}
