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
    // Approvals (WS3): a manager and their report. Employee IDs stand in for employee records
    // until the people module lands; e2e/server.ts wires the reporting line.
    approver: {
      email: "kaiwen@kampongkopi.example",
      name: "Wong Kai Wen",
      roles: [],
      employeeId: "00000000-0000-7000-8000-00000000e201",
    },
    requester: {
      email: "ahmad@kampongkopi.example",
      name: "Ahmad Ismail",
      roles: [],
      employeeId: "00000000-0000-7000-8000-00000000e202",
    },
  },
  /** Second organisation with every SSO method on (screenshots / multi-org). */
  ssoOrg: {
    name: "Tanjong Tech Pte. Ltd.",
    slug: "tanjong-tech",
    owner: { email: "owner@tanjongtech.example", name: "Daniel Ong" },
  },
} as const;

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
