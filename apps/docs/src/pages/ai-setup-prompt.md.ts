import type { APIRoute } from "astro";
import { AI_SETUP_PROMPT } from "../lib/markdown.ts";

/** The "Copy for my AI" prompt (src/lib/ai-setup-prompt.md), fetched by the button on every page. */
export const GET: APIRoute = () =>
  new Response(`${AI_SETUP_PROMPT}\n`, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
