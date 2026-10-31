import { expect, test } from "@playwright/test";
import { totpAt } from "../packages/core/src/auth/totp.ts";
import { E2E, uiSignIn } from "./fixtures.ts";

test.describe("password sign-in", () => {
  test("shows only the enabled methods and a fix-it message for a wrong password", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Which organisation?" })).toBeVisible();
    await page.getByLabel("Organisation").fill(E2E.org.slug);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(new RegExp(`/sign-in/${E2E.org.slug}`));
    await expect(page.getByTestId("org-name")).toHaveText(E2E.org.name);
    await expect(page.getByTestId("sso-methods")).toHaveCount(0);
    await uiSignIn(page, E2E.members.staff.email, "definitely not it");
    await expect(page.getByTestId("sign-in-notice")).toContainText("don't match an account here");
  });

  test("signs in with email and password and lands on Home", async ({ page }) => {
    await uiSignIn(page, E2E.members.staff.email);
    await expect(page.getByRole("heading", { level: 1, name: "Work to do" })).toBeVisible();
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu")).toContainText(E2E.members.staff.email);
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByTestId("sign-in-notice")).toContainText("You have signed out");
  });

  test("protected pages redirect to sign-in", async ({ page }) => {
    await page.goto("/settings/members");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("two-step verification", () => {
  test("enrol an authenticator, then sign in with a code", async ({ page }) => {
    await uiSignIn(page, E2E.members.mfa.email);
    await expect(page.getByRole("heading", { name: "Work to do" })).toBeVisible();
    await page.goto("/me/sessions");
    await page.getByRole("button", { name: "Set up authenticator app" }).click();
    const secret = (await page.getByTestId("totp-secret").textContent())?.replace(/\s+/g, "") as string;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await expect(page.getByAltText("QR code to scan with your authenticator app")).toBeVisible();
    await page.getByLabel("Code from the app").fill(await totpAt(secret, new Date()));
    await page.getByRole("button", { name: "Turn on" }).click();
    const codes = page.getByTestId("recovery-codes");
    await expect(codes).toContainText("Save your recovery codes now");
    await expect(codes.locator("li")).toHaveCount(10);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await uiSignIn(page, E2E.members.mfa.email);
    await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
    // The enrolment code's time step was used; the next step is still inside the ±1 window.
    await page.getByLabel("Authenticator code").fill(await totpAt(secret, new Date(Date.now() + 30_000)));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page.getByRole("heading", { name: "Work to do" })).toBeVisible();
  });
});

test.describe("my sessions", () => {
  test("revoke another of my sessions from Sign-in and devices", async ({ page, browser }) => {
    const other = await browser.newContext();
    const op = await other.newPage();
    await uiSignIn(op, E2E.members.hr.email);
    await expect(op.getByRole("heading", { name: "Work to do" })).toBeVisible();

    await uiSignIn(page, E2E.members.hr.email);
    await expect(page.getByRole("heading", { name: "Work to do" })).toBeVisible();
    await page.goto("/me/sessions");
    const table = page.getByTestId("sessions-table");
    await expect(table.getByText("This device")).toBeVisible();
    await page.getByRole("button", { name: "Sign out everywhere else" }).click();
    await expect(page.getByText(/Signed out \d+ other session/)).toBeVisible();

    await op.goto("/settings");
    await expect(op).toHaveURL(/reason=revoked/);
    await other.close();
  });
});
