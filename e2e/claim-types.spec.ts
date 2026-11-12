import { expect, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * add-claims task 5.3: Settings → Claim types in a company that has none yet (the fresh e2e
 * organisation): the starter set is offered on the empty state, a cap is edited, a type archived.
 */
test.describe.configure({ mode: "serial" });

test("starter set on the empty state, edit a cap, archive and restore a type", async ({ page }) => {
  await uiSignInOk(page, E2E.freshOrg.owner.email, E2E.password, E2E.freshOrg.slug);
  await page.goto("/settings/claim-types");

  // Empty state: the starter set, all ticked, nothing created until confirmed.
  const empty = page.getByTestId("claim-types-empty");
  await expect(empty).toContainText("No claim types yet.");
  for (const name of ["Transport", "Meals", "Medical (outpatient)", "Dental", "Mobile phone"]) {
    await expect(empty.getByText(name, { exact: true })).toBeVisible();
  }
  const add = page.getByTestId("add-starter");
  const all = Number((await add.textContent())?.match(/Add (\d+)/)?.[1]);
  expect(all).toBeGreaterThanOrEqual(5);
  await empty.getByLabel(/^Dental/).click(); // untick one
  await expect(add).toHaveText(`Add ${all - 1} claim types`);
  await add.click();
  await expect(page.getByText(`${all - 1} claim types added`)).toBeVisible();

  const table = page.getByRole("table", { name: "Claim types" });
  await expect(table.getByRole("row").filter({ hasText: "Transport" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Dental" })).toHaveCount(0);

  // Edit a cap: Meals, S$80.00 a month.
  await page.getByRole("button", { name: "Edit Meals" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Cap period" }).click();
  await page.getByRole("option", { name: /month/i }).click();
  await dialog.getByLabel("Cap amount").fill("80.00");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Meals saved")).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Meals" })).toContainText("S$80.00 a month");

  // A cap of zero is refused with a message saying how to fix it.
  await page.getByRole("button", { name: "Edit Meals" }).click();
  await dialog.getByLabel("Cap amount").fill("0");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("A cap must be more than S$0.00. Enter the cap amount, or choose No cap."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Archive Transport: marked archived, then restorable.
  await page.getByRole("button", { name: "Archive Transport" }).click();
  await expect(page.getByText("Transport archived")).toBeVisible();
  const transport = table.getByRole("row").filter({ hasText: "Transport" });
  await expect(transport).toContainText("Archived");
  await page.getByRole("button", { name: "Restore Transport" }).click();
  await expect(page.getByText("Transport restored")).toBeVisible();
  await expect(transport).not.toContainText("Archived");
});
