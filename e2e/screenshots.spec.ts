import { expect, type Page, test } from "@playwright/test";
import { totpAt } from "../packages/core/src/auth/totp.ts";
import { E2E, SHOTS, uiSignIn, uiSignInOk } from "./fixtures.ts";

/**
 * Design-review screenshots (run with SHOTS_DIR=<dir>). Desktop at 1440 wide; sign-in and My
 * sessions also at 390. Skipped in normal runs.
 */
test.skip(!SHOTS, "set SHOTS_DIR to capture screenshots");
test.use({ viewport: { width: 1440, height: 900 } });

async function snap(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/ws1-${name}.png`, fullPage });
}

test("sign-in pages", async ({ page }) => {
  await page.goto(`/sign-in/${E2E.ssoOrg.slug}`);
  await expect(page.getByTestId("sso-methods").getByRole("button")).toHaveCount(3);
  await snap(page, "sign-in-all-methods");
  await page.goto(`/sign-in/${E2E.org.slug}`);
  await expect(page.getByLabel("Work email")).toBeVisible();
  await snap(page, "sign-in-password-only");
  await page.goto("/sign-in");
  await snap(page, "sign-in-choose-org");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sign-in/${E2E.ssoOrg.slug}`);
  await snap(page, "sign-in-all-methods-390");
  await page.goto(`/sign-in/${E2E.org.slug}`);
  await snap(page, "sign-in-password-only-390");
});

test("two-step verification", async ({ page }) => {
  await uiSignInOk(page, E2E.members.shots.email);
  await page.goto("/me/sessions");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.replace(/\s+/g, "") as string;
  await snap(page, "mfa-enrol");
  await page.getByLabel("Code from the app").fill(await totpAt(secret, new Date()));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByTestId("recovery-codes")).toBeVisible();
  await snap(page, "mfa-recovery-codes");
  await page.getByRole("button", { name: "I've saved them" }).click();
  await snap(page, "my-sessions");
  await page.setViewportSize({ width: 390, height: 844 });
  await snap(page, "my-sessions-390");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await uiSignIn(page, E2E.members.shots.email);
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await snap(page, "mfa-challenge");
});

test("owner settings", async ({ page }) => {
  await uiSignInOk(page, E2E.ssoOrg.owner.email, E2E.password, E2E.ssoOrg.slug);
  await page.goto("/settings/security");
  await expect(page.getByTestId("sign-in-methods")).toContainText("Singpass");
  await snap(page, "security-settings");
  await page.getByRole("button", { name: "Add a method" }).click();
  await page.getByRole("menuitem", { name: "OpenID Connect" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Paste the client ID")).toBeVisible();
  await snap(page, "provider-setup", false);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await uiSignInOk(page, E2E.members.owner.email);
  await page.goto("/settings/members");
  await expect(page.getByTestId("members-table")).toBeVisible();
  await snap(page, "members");
  await page.getByRole("button", { name: "Invite someone" }).click();
  await page.getByLabel("Work email").fill(`shot.${Date.now()}@kampongkopi.example`);
  await page.getByLabel("Name", { exact: true }).fill("Goh Pei Shan");
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /^Payroll admin/ })
    .check();
  await snap(page, "invite-dialog", false);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByTestId("invite-link")).toBeVisible();
  await snap(page, "invite-link", false);
  await page.getByRole("button", { name: "Done" }).click();
  await page.goto("/settings/audit");
  await expect(page.getByTestId("audit-table")).toBeVisible();
  await snap(page, "audit-log");
});
