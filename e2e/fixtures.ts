import type { APIRequestContext, Page } from "@playwright/test";

/** Fictional e2e data (seeded by e2e/seed.ts). */
export const E2E = {
  org: { name: "Kampong Kopi Pte. Ltd.", slug: "kampong-kopi" },
  password: "kopi peng siew dai 2026",
  members: {
    owner: { email: "owner@kampongkopi.example", name: "Nur Aisyah", roles: ["owner"] },
    hr: { email: "hr@kampongkopi.example", name: "Tan Mei Ling", roles: ["hr_admin"] },
    staff: { email: "staff@kampongkopi.example", name: "Ravi Kumar", roles: [] },
    mfa: { email: "mfa@kampongkopi.example", name: "Lim Wei Jie", roles: [] },
    revokee: { email: "revokee@kampongkopi.example", name: "Siti Rahmah", roles: [] },
    shots: { email: "farah@kampongkopi.example", name: "Farah Hassan", roles: [] },
    // Approvals (WS3): a manager and their report, linked to employee records by e2e/seed.ts
    // (Ahmad and Farah report to Kai Wen).
    // Profile-change decisions require HR for personal details and payroll for bank details.
    approver: { email: "kaiwen@kampongkopi.example", name: "Wong Kai Wen", roles: ["hr_admin", "payroll_admin"] },
    requester: { email: "ahmad@kampongkopi.example", name: "Ahmad Ismail", roles: [] },
    // Leave (WS5): long-serving staff reporting to Kai Wen, and a payroll admin (e2e/seed.ts).
    leaveStaff: { email: "nadia@kampongkopi.example", name: "Nadia Rahman", roles: [] },
    leaveDad: { email: "weiming@kampongkopi.example", name: "Tan Wei Ming", roles: [] },
    payroll: { email: "payroll@kampongkopi.example", name: "Lim Jia Hui", roles: ["payroll_admin"] },
    // Scheduling (WS5b): rostered café crew at HQ reporting to Kai Wen (e2e/seed-schedules.ts).
    crewA: { email: "nurul@kampongkopi.example", name: "Nurul Huda", roles: [] },
    crewB: { email: "marcus@kampongkopi.example", name: "Marcus Lim", roles: [] },
    // Mobile device sessions (e2e/device-sessions.spec.ts).
    device: { email: "meixin@kampongkopi.example", name: "Goh Mei Xin", roles: [] },
  },
  /** Second organisation with every SSO method on (screenshots / multi-org). */
  ssoOrg: {
    name: "Tanjong Tech Pte. Ltd.",
    slug: "tanjong-tech",
    owner: { email: "owner@tanjongtech.example", name: "Daniel Ong" },
  },
  /**
   * Third organisation, just its owner, as a company looks right after the setup wizard: no
   * company profile, structure, schedule, people or claim types (company-setup, claim-types specs).
   */
  freshOrg: {
    name: "Kedai Runcit Ah Huat Pte. Ltd.",
    slug: "kedai-runcit",
    owner: { email: "owner@kedairuncit.example", name: "Tan Ah Huat" },
  },
  /**
   * Fourth organisation for the generic-OIDC round trip against the mock IdP
   * (security-settings spec), which turns password sign-in off here and nowhere else.
   */
  oidcOrg: {
    name: "Bukit Batok Bakery Pte. Ltd.",
    slug: "bukit-batok-bakery",
    owner: { email: "owner@bbbakery.example", name: "Chua Siew Lan" },
    hr: { email: "hr@bbbakery.example", name: "Priya Nair" },
    staff: { email: "baker@bbbakery.example", name: "Hafiz Rahman" },
  },
} as const;

const IDP_PORT = Number(process.env.E2E_PORT ?? 3100) + 3;
/** The mock OpenID provider served by e2e/mock-idp-server.ts (test only). */
export const MOCK_IDP = {
  origin: `http://127.0.0.1:${IDP_PORT}`,
  issuer: `http://127.0.0.1:${IDP_PORT}/realms/kopi`,
  clientId: "crowhr-e2e",
  clientSecret: "e2e-only-client-secret",
} as const;

/** Who the mock IdP signs in on its next authorize request. */
export async function mockIdpNextUser(
  request: APIRequestContext,
  user: { sub: string; email?: string; email_verified?: boolean; name?: string },
) {
  const res = await request.post(`${MOCK_IDP.origin}/_control/next-user`, { data: user });
  if (res.status() !== 204) throw new Error(`mock IdP control failed: ${res.status()}`);
}

export const SHOTS = process.env.SHOTS_DIR;

/** Home's h1: "Work to do" for approvers and admins, "Hi, <first name>" for everyone else. */
export const HOME_HEADING = /^(Work to do|Hi, .+)$/;

export async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ws1-${name}.png`, fullPage: true });
}

/** Signs in through the API (shares cookies with the page's browser context). */
export async function apiSignIn(request: APIRequestContext, email: string, password: string = E2E.password) {
  const res = await request.post("/api/v1/auth/sign-in", { data: { org: E2E.org.slug, email, password } });
  if (!res.ok()) throw new Error(`sign-in failed for ${email}: ${res.status()} ${await res.text()}`);
}

/** Signs in through the UI. */
export async function uiSignIn(page: Page, email: string, password: string = E2E.password, org: string = E2E.org.slug) {
  await page.goto(`/sign-in/${org}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Signs in through the UI and waits until Home has loaded. */
export async function uiSignInOk(page: Page, email: string, password: string = E2E.password, org?: string) {
  await uiSignIn(page, email, password, org);
  await page.getByRole("heading", { level: 1, name: HOME_HEADING }).waitFor();
}
