// @ts-check
import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import { apiTagSlug } from "./src/lib/api-tags.ts";
import { DOC_GROUPS, HELP_GROUP } from "./src/lib/sidebar.ts";

/**
 * Crow HR docs: static files served from https://hr.crow.sg/docs, next to the in-browser demo.
 * No server runtime, no third-party requests: fonts are self-hosted (@fontsource), search is
 * Pagefind (built into the static output), screenshots are pre-optimised WebP in src/assets.
 */
const SITE = "https://hr.crow.sg";
const BASE = "/docs";

const openapi = JSON.parse(
  readFileSync(new URL("../../packages/core/openapi/v1.snapshot.json", import.meta.url), "utf8"),
);
/** API reference pages are generated per OpenAPI tag by src/pages/api/[tag].astro. */
const apiTags = [
  ...new Set(
    Object.values(openapi.paths).flatMap((ops) =>
      Object.values(/** @type {Record<string, {tags?: string[]}>} */ (ops)).flatMap((op) => op.tags ?? []),
    ),
  ),
].sort((a, b) => a.localeCompare(b));

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "always",
  image: { service: passthroughImageService() },
  // The mobile apps page moved out of coming-soon/ when the Android app shipped. Keys are relative to
  // the base; the build writes a small redirect page at the old address.
  redirects: { "/coming-soon/mobile-apps/": "/docs/mobile-apps/" },
  // Note: avoid Starlight's <Steps> component. It renders with satteri, whose native binding cannot
  // be resolved from the prerender chunks under bun's isolated node_modules. Plain ordered lists work.
  integrations: [
    starlight({
      title: "Crow HR docs",
      description:
        "Documentation for Crow HR, the free, MIT-licensed, self-hosted HR and payroll platform for Singapore SMEs.",
      favicon: "/favicon.svg",
      customCss: [
        "@fontsource/azeret-mono/latin-400.css",
        "@fontsource/azeret-mono/latin-500.css",
        "@fontsource/azeret-mono/latin-600.css",
        "@fontsource/azeret-mono/latin-700.css",
        "@fontsource/ubuntu/latin-400.css",
        "@fontsource/ubuntu/latin-500.css",
        "@fontsource/ubuntu/latin-700.css",
        "./src/styles/crow.css",
      ],
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        // Structured data and the share image (SEO), and the Copy page / Copy for my AI buttons.
        Head: "./src/components/Head.astro",
        PageTitle: "./src/components/PageTitle.astro",
      },
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#FEFEFE", media: "(prefers-color-scheme: light)" } },
        { tag: "meta", attrs: { name: "theme-color", content: "#121212", media: "(prefers-color-scheme: dark)" } },
        // Starlight lets wide tables scroll sideways (on a phone, most of them). Keyboard users can only
        // scroll what they can focus, so tables get tabindex="0" (WCAG 2.1.1), as Starlight's code blocks have.
        {
          tag: "script",
          content:
            "document.addEventListener('DOMContentLoaded',()=>{for(const t of document.querySelectorAll('.sl-markdown-content table'))if(!t.hasAttribute('tabindex'))t.tabIndex=0})",
        },
        // Starlight's search button is named by aria-label="Search" while it also shows "Ctrl K", so the
        // visible text isn't in its name (WCAG 2.5.3). Name it by its own "Search" text instead (kept for
        // screen readers on phones by crow.css) and leave the shortcut to aria-keyshortcuts.
        {
          tag: "script",
          content:
            "document.addEventListener('DOMContentLoaded',()=>{const b=document.querySelector('button[data-open-modal]');const s=b&&b.querySelector(':scope>span');if(!s)return;b.removeAttribute('aria-label');s.removeAttribute('aria-hidden');s.classList.add('crow-search-label');for(const k of b.querySelectorAll(':scope>kbd'))k.setAttribute('aria-hidden','true')})",
        },
      ],
      lastUpdated: false,
      credits: false,
      // Shell snippets get the same plain frame as other code (no terminal title bar with window dots).
      // Long lines wrap with a hanging indent instead of scrolling sideways, so nothing is cut off on a
      // phone and no code block needs its own scroll region.
      expressiveCode: { defaultProps: { frame: "code", wrap: true, hangingIndent: 2 } },
      // Groups live in src/lib/sidebar.ts (shared with llms.txt); the API reference is generated here.
      sidebar: [
        ...DOC_GROUPS,
        {
          label: "API reference",
          collapsed: true,
          items: [
            { label: "Overview", link: "/api/" },
            ...apiTags.map((tag) => ({ label: tag, link: `/api/${apiTagSlug(tag)}/` })),
          ],
        },
        HELP_GROUP,
      ],
    }),
  ],
});
