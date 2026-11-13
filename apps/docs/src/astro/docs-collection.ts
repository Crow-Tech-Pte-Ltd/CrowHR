import { getCollection } from "astro:content";
import type { DocForExport } from "../lib/markdown.ts";

/** Every docs page that has a Markdown copy (all except the 404 page), keyed by entry id. */
export async function exportableDocs(): Promise<Map<string, DocForExport>> {
  const entries = await getCollection("docs");
  const docs = new Map<string, DocForExport>();
  for (const entry of entries) {
    if (entry.id === "404" || typeof entry.body !== "string") continue;
    docs.set(entry.id, {
      id: entry.id,
      title: entry.data.title,
      description: entry.data.description ?? "",
      body: entry.body,
      mdx: entry.filePath?.endsWith(".mdx") ?? false,
    });
  }
  return docs;
}
