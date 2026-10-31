import { expect, test } from "@playwright/test";

/** Identity task 9.4 (reveal control) against the people dev server; see playwright.people.config.ts. */
test("NRIC reveal: masked by default, asks to confirm a stale sign-in, hides again", async ({ page }) => {
  await page.goto(`/__dev/as/hr?stale=1&to=${encodeURIComponent("/people")}`);
  await page.getByRole("link", { name: "Daniel Okafor" }).first().click();
  const value = page.getByTestId("nric-value");
  await expect(value).toHaveText(/^M\*{4}\d{3}[A-Z]$/);
  await page.getByRole("button", { name: "Show full NRIC/FIN" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Confirm it's you")).toBeVisible();
  await dialog.getByLabel("Password").fill("kopi-kaki-dev-only");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(value).toHaveText(/^M\d{7}[A-Z]$/);
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(value).toHaveText(/^M\*{4}/);
  // Revealed values are not kept across navigation.
  await page.getByRole("button", { name: "Show full NRIC/FIN" }).click();
  await expect(value).toHaveText(/^M\d{7}[A-Z]$/);
  await page.getByRole("tab", { name: "Job" }).click();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByTestId("nric-value")).toHaveText(/^M\*{4}/);
});

test("bank reveal is only offered to payroll", async ({ page }) => {
  await page.goto(`/__dev/as/hr?to=${encodeURIComponent("/people")}`);
  await page.getByRole("link", { name: "Chloe de Souza" }).first().click();
  await page.getByRole("tab", { name: "Pay" }).click();
  await page.getByRole("button", { name: "Show full account number" }).click();
  await expect(page.getByTestId("bank-value")).toHaveText(/^\d{10}$/);
  await page.goto(`/__dev/as/hronly?to=${encodeURIComponent("/people")}`);
  await page.getByRole("link", { name: "Chloe de Souza" }).first().click();
  await page.getByRole("tab", { name: "Pay" }).click();
  await expect(page.getByRole("button", { name: "Show full account number" })).toHaveCount(0);
});
