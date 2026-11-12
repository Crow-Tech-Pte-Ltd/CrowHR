// @ts-check
import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import { apiTagSlug } from "./src/lib/api-tags.ts";

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
      ],
      lastUpdated: false,
      credits: false,
      sidebar: [
        {
          label: "Start here",
          items: [{ slug: "introduction" }, { slug: "quick-start" }, { slug: "status" }, { slug: "demo" }],
        },
        {
          label: "Self-hosting",
          items: [
            { slug: "self-hosting/install" },
            { slug: "self-hosting/configuration" },
            { slug: "self-hosting/reverse-proxy" },
            { slug: "self-hosting/backups" },
            { slug: "self-hosting/upgrades" },
            { slug: "self-hosting/cli" },
            { slug: "self-hosting/troubleshooting" },
          ],
        },
        {
          label: "Administration",
          items: [
            { slug: "admin/setup-wizard" },
            { slug: "admin/company-and-structure" },
            { slug: "admin/members-and-roles" },
            { slug: "admin/sign-in-methods" },
            { slug: "admin/mfa" },
            {
              label: "Single sign-on guides",
              items: [
                { slug: "admin/sso/google-workspace" },
                { slug: "admin/sso/microsoft-entra-id" },
                { slug: "admin/sso/generic-oidc" },
                { slug: "admin/sso/singpass" },
              ],
            },
          ],
        },
        {
          label: "People",
          items: [
            { slug: "people/adding-employees" },
            { slug: "people/importing" },
            { slug: "people/lifecycle" },
            { slug: "people/work-passes" },
            { slug: "people/self-service-and-change-requests" },
          ],
        },
        {
          label: "Payroll and compliance",
          items: [
            { slug: "payroll/settings" },
            { slug: "payroll/running-payroll" },
            { slug: "payroll/cpf-working" },
            { slug: "payroll/shg-sdl-fwl" },
            { slug: "payroll/payslips" },
            { slug: "payroll/cpf-ezpay-file" },
            { slug: "payroll/bank-file" },
            { slug: "payroll/ir8a-export" },
            { slug: "payroll/verification" },
            { slug: "payroll/limitations" },
          ],
        },
        {
          label: "Time and leave",
          items: [{ slug: "leave/leave" }, { slug: "attendance/attendance" }, { slug: "scheduling/scheduling" }],
        },
        { label: "Claims", items: [{ slug: "claims/claims" }] },
        {
          label: "Approvals and notifications",
          items: [{ slug: "approvals/approvals" }, { slug: "approvals/notifications" }],
        },
        {
          label: "Documents",
          items: [{ slug: "documents/documents" }, { slug: "documents/letters-and-kets" }],
        },
        { label: "Reports", items: [{ slug: "reports/running-reports" }] },
        { label: "Roles and permissions", items: [{ slug: "roles-and-permissions" }] },
        { label: "Integrations", items: [{ slug: "integrations" }] },
        { label: "Mobile apps", items: [{ slug: "coming-soon/mobile-apps" }] },
        {
          label: "Developers",
          collapsed: true,
          items: [
            { slug: "developers/architecture" },
            { slug: "developers/modules" },
            { slug: "developers/api-conventions" },
            { slug: "developers/testing" },
            { slug: "developers/openspec" },
            { slug: "developers/contributing" },
          ],
        },
        {
          label: "API reference",
          collapsed: true,
          items: [
            { label: "Overview", link: "/api/" },
            ...apiTags.map((tag) => ({ label: tag, link: `/api/${apiTagSlug(tag)}/` })),
          ],
        },
        {
          label: "Help",
          items: [
            { slug: "help/troubleshooting" },
            { slug: "help/faq" },
            { slug: "help/security" },
            { slug: "help/privacy-pdpa" },
          ],
        },
      ],
    }),
  ],
});
