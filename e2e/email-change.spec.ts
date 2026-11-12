import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * Sign-in email change in the web app. The e2e server has no SMTP, so the change is not offered
 * (the verified flow is covered by core's email-change.http.test.ts); the link page explains a used or
 * unknown link.
 */
async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    "axe violations",
  ).toEqual([]);
}

test("without email the sign-in email can't be changed, and the page says why", async ({ page }) => {
  await uiSignInOk(page, E2E.members.staff.email);
  await page.goto("/me/sessions");
  const section = page.getByRole("region", { name: "Sign-in email" });
  await expect(section).toContainText(E2E.members.staff.email);
  await expect(section).toContainText("This server can't send email");
  await expect(section.getByRole("button", { name: "Change email" })).toHaveCount(0);
  await axeClean(page);
});

test("an unknown or used confirmation link says what to do", async ({ page }) => {
  await page.goto("/email/not-a-real-token-0123456789");
  await expect(page.getByRole("heading", { name: "Confirm your new sign-in email" })).toBeVisible();
  await axeClean(page);
  await page.getByRole("button", { name: "Confirm new email" }).click();
  await expect(page.getByTestId("email-change-state")).toContainText("expired or was already used");
});
