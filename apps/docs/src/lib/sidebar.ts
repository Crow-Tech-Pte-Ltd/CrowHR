/**
 * The docs sidebar, except the generated API reference group (astro.config.mjs inserts that before
 * Help). One definition for the site navigation and for llms.txt, so the two list the same pages in
 * the same order.
 */
export type SidebarItem =
  | { slug: string }
  | { label: string; link: string }
  | { label: string; items: SidebarItem[]; collapsed?: boolean };

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
  collapsed?: boolean;
}

export const DOC_GROUPS: SidebarGroup[] = [
  {
    label: "Get started",
    items: [{ slug: "introduction" }, { slug: "quick-start" }, { slug: "status" }, { slug: "demo" }],
  },
  {
    label: "Self-hosting",
    items: [
      { slug: "self-hosting/install" },
      { slug: "self-hosting/ai-agent" },
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
  { label: "Mobile apps", items: [{ slug: "mobile-apps" }] },
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
];

export const HELP_GROUP: SidebarGroup = {
  label: "Help",
  items: [
    { slug: "help/troubleshooting" },
    { slug: "help/faq" },
    { slug: "help/security" },
    { slug: "help/privacy-pdpa" },
    // The mobile apps' support and privacy pages live on crow.sg, where the store listings point.
    { label: "Mobile app support", link: "https://crow.sg/apps/crow-hr/support/" },
    { label: "Mobile app privacy policy", link: "https://crow.sg/apps/crow-hr/privacy/" },
  ],
};

/** Every docs slug in sidebar order, with the label of the top-level group it sits in. */
export function slugsInOrder(): { slug: string; group: string }[] {
  const out: { slug: string; group: string }[] = [];
  const walk = (items: SidebarItem[], group: string) => {
    for (const item of items) {
      if ("slug" in item) out.push({ slug: item.slug, group });
      else if ("items" in item) walk(item.items, group);
    }
  };
  for (const g of [...DOC_GROUPS, HELP_GROUP]) walk(g.items, g.label);
  return out;
}
