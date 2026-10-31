import { expect, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

test.describe("Settings → Security", () => {
  test("owner sees sign-in methods, policy and timeouts; provider setup explains each field", async ({ page }) => {
    await uiSignInOk(page, E2E.members.owner.email);
    await page.goto("/settings/security");
    await expect(page.getByTestId("sign-in-methods")).toContainText("Email and password");
    await expect(page.getByTestId("insecure-transport")).toContainText("Not using HTTPS");
    // Password can't be switched off before an SSO method passes a test sign-in.
    await expect(page.getByRole("switch", { name: "Email and password sign-in" })).toBeDisabled();
    await page.getByRole("button", { name: "Add a method" }).click();
    await page.getByRole("menuitem", { name: "Microsoft Entra ID" }).click();
    await expect(page.getByText("Where to find these")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Enter your tenant (directory) ID")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.goto("/settings/audit");
    await expect(page.getByTestId("audit-table")).toContainText("Signed in");
  });

  test("an HR admin cannot open security settings", async ({ page }) => {
    await uiSignInOk(page, E2E.members.hr.email);
    await page.goto("/settings/security");
    await expect(page.getByText("Only owners can change security settings")).toBeVisible();
  });
});
