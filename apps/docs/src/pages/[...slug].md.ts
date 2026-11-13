import type { APIRoute, GetStaticPaths } from "astro";
import { exportableDocs } from "../astro/docs-collection.ts";
import { type DocForExport, pageMarkdown } from "../lib/markdown.ts";

/** Every docs page as Markdown at `<page>.md` (the overview is /docs/index.md). */
export const getStaticPaths = (async () => {
  const docs = await exportableDocs();
  return [...docs.values()].map((doc) => ({ params: { slug: doc.id }, props: { doc } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(pageMarkdown((props as { doc: DocForExport }).doc), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
