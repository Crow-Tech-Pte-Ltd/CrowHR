import type { APIRoute } from "astro";
import { exportableDocs } from "../astro/docs-collection.ts";
import { pageMarkdown } from "../lib/markdown.ts";
import { slugsInOrder } from "../lib/sidebar.ts";

/** Every docs page as Markdown in one file, in sidebar order (pages outside the sidebar last). */
export const GET: APIRoute = async () => {
  const docs = await exportableDocs();
  const order = ["index", ...slugsInOrder().map((s) => s.slug)];
  const ids = [...order.filter((id) => docs.has(id)), ...[...docs.keys()].filter((id) => !order.includes(id))];
  const pages = [...new Set(ids)].flatMap((id) => {
    const doc = docs.get(id);
    return doc ? [pageMarkdown(doc)] : [];
  });
  return new Response(pages.join("\n---\n\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
