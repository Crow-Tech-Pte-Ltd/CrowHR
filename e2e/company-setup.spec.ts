import { expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * add-organisation-and-people task 7.1: a new company (the fresh e2e organisation, as it is right
 * after the setup wizard) follows the setup checklist on Home: company profile (with the UEN error
 * message), a department and the default work schedule. Steps disappear as the data appears.
 */
test.describe.configure({ mode: "serial" });

const steps = (page: Page) => page.getByTestId("home-setup").getByRole("listitem");

test("setup checklist on Home, company profile with a UEN error, department, default work schedule", async ({
  page,
}) => {
  await uiSignInOk(page, E2E.freshOrg.owner.email, E2E.password, E2E.freshOrg.slug);
  const card = page.getByTestId("home-setup");
  await expect(card).toContainText("Finish setting up");
  await expect(card).toContainText("4 steps left before your first payroll");
  await expect(steps(page)).toHaveText([/Company profile/, /Departments/, /Work schedule/, /First employee/]);

  // Company profile: a bad UEN says which formats are accepted.
  await steps(page).filter({ hasText: "Company profile" }).getByRole("link", { name: "Set up" }).click();
  await expect(page).toHaveURL(/\/settings\/company$/);
  await page.getByLabel("Legal name").fill(E2E.freshOrg.name);
  await page.getByLabel("UEN").fill("12345");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByText(/three ACRA formats/)).toBeVisible();
  await expect(page.getByLabel("UEN")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("UEN").fill("202612345K");
  await page.getByLabel("Postal code").fill("380015");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByText("Company profile saved")).toBeVisible();

  await page.goto("/");
  await expect(card).toContainText("3 steps left");
  await expect(steps(page).filter({ hasText: "Company profile" })).toHaveCount(0);

  // A department.
  await steps(page).filter({ hasText: "Departments" }).getByRole("link", { name: "Set up" }).click();
  await expect(page).toHaveURL(/\/settings\/structure$/);
  await page.getByLabel("New department").fill("Shop floor");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("table", { name: "Departments" })).toContainText("Shop floor");

  // The default work schedule: five and a half days (44 hours), Sunday the rest day.
  await page.goto("/");
  await steps(page).filter({ hasText: "Work schedule" }).getByRole("link", { name: "Set up" }).click();
  await expect(page).toHaveURL(/\/settings\/structure\?tab=schedules$/);
  await expect(page.getByText("No work schedule yet")).toBeVisible();
  await page.getByLabel("Name").fill("Shop 6-day");
  await page.getByRole("combobox", { name: "Sat day type" }).click();
  await page.getByRole("option", { name: "Half day" }).click();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Work schedule saved")).toBeVisible();
  const row = page.getByRole("table", { name: "Work schedules" }).getByRole("row").filter({ hasText: "Shop 6-day" });
  await expect(row).toContainText("Default");

  // Only the first employee is left.
  await page.goto("/");
  await expect(card).toContainText("1 step left");
  await expect(steps(page)).toHaveText([/First employee/]);
});
