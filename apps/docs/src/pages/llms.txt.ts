import type { APIRoute } from "astro";
import { exportableDocs } from "../astro/docs-collection.ts";
import { DOCS, markdownUrl } from "../lib/markdown.ts";
import { slugsInOrder } from "../lib/sidebar.ts";

/** llms.txt (https://llmstxt.org): what Crow HR is and every docs page as Markdown, in sidebar order. */
export const GET: APIRoute = async () => {
  const docs = await exportableDocs();
  const lines = [
    "# Crow HR",
    "",
    "> Free, MIT-licensed HR and payroll software for Singapore SMEs that you host yourself with Docker Compose: CPF payroll with every figure's working shown, leave, claims, attendance, scheduling, approvals, documents, IR8A, and iPhone and Android apps that connect only to your own server.",
    "",
    `To install Crow HR with an AI coding agent, give it the setup prompt: ${DOCS}/ai-setup-prompt.md. Every page below is Markdown; ${DOCS}/llms-full.txt has all of them in one file. The HTML docs are at ${DOCS}/, an in-browser demo with a fictional company at https://hr.crow.sg/, and the source at https://github.com/Crow-Tech-Pte-Ltd/CrowHR.`,
  ];
  let group = "";
  for (const { slug, group: label } of slugsInOrder()) {
    const doc = docs.get(slug);
    if (!doc) continue;
    if (label !== group) {
      lines.push("", `## ${label}`, "");
      group = label;
    }
    lines.push(`- [${doc.title}](${markdownUrl(doc.id)}): ${doc.description}`);
  }
  lines.push(
    "",
    "## Optional",
    "",
    `- [API reference](${DOCS}/api/): every endpoint of the v1 REST API (HTML, generated from the OpenAPI document)`,
  );
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
