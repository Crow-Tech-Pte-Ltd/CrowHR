import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { waitForDemo, watchErrors } from "./helpers.ts";

test.use({ viewport: { width: 360, height: 800 }, locale: "zh-SG" });

test("language is shared by the demo and the app, and switching preserves the form and session", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  const welcome = page.getByTestId("demo-entry");
  await expect(welcome.getByRole("heading", { name: "试用 Crow HR" })).toBeVisible();
  await expect(welcome.getByRole("radio", { name: "简体中文" })).toBeChecked();
  await expect(page.getByTestId("demo-loading")).toBeHidden();
  expect(page.workers()).toHaveLength(0);

  const entryAxe = () =>
    new AxeBuilder({ page }).include('[data-testid="demo-entry"]').withTags(["wcag2a", "wcag2aa"]).analyze();
  expect((await entryAxe()).violations).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect((await entryAxe()).violations).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await welcome.getByRole("radio", { name: "Bahasa Melayu" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ms-SG");
  expect(page.workers()).toHaveLength(0);
  await welcome.getByRole("button", { name: "Mulakan demo" }).click();
  await waitForDemo(page);
  await expect(page.getByTestId("demo-options")).toHaveAccessibleName("Pilihan demo");
  await expect(page.getByRole("combobox", { name: "Bahasa" })).toHaveValue("ms-SG");

  await page.reload();
  await waitForDemo(page);
  await expect(page.getByRole("combobox", { name: "Bahasa" })).toHaveValue("ms-SG");
  await page.getByTestId("persona-owner").click();
  const account = page.getByRole("button", { name: "Menu akaun" });
  await expect(account).toBeVisible();

  await page.goto("/settings/company");
  await waitForDemo(page);
  await expect(page.getByRole("heading", { level: 1, name: "Syarikat" })).toBeVisible();
  const legalName = page.getByRole("textbox", { name: "Nama berdaftar" });
  await expect(legalName).toHaveValue("Qinghe Foods Pte. Ltd.");
  await legalName.fill("Unsaved name");

  await account.click();
  await page.getByRole("menuitem", { name: /Bahasa.*Bahasa Melayu/ }).click();
  const languages = page.getByRole("dialog", { name: "Bahasa" });
  await expect(languages).toBeInViewport({ ratio: 1 });
  const axe = () => new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa"]).analyze();
  expect((await axe()).violations).toEqual([]);
  await languages.getByRole("button", { name: "தமிழ்" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ta-SG");
  await expect(page.getByTestId("demo-options")).toHaveAccessibleName("செயல்விளக்க விருப்பங்கள்");
  await expect(page.getByRole("heading", { level: 1, name: "நிறுவனம்" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "பதிவு செய்யப்பட்ட பெயர்" })).toHaveValue("Unsaved name");
  const tamilAccount = page.getByRole("button", { name: "கணக்கு மெனு" });
  await tamilAccount.click();
  await page.getByRole("menuitemradio", { name: "இருள்" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await tamilAccount.click();
  await page.getByRole("menuitem", { name: /மொழி.*தமிழ்/ }).click();
  expect((await axe()).violations).toEqual([]);
  await page.getByRole("dialog", { name: "மொழி" }).getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Company" })).toBeVisible();
  await expect(page.getByText("Ready for payroll", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const reporting = page.getByRole("dialog").getByRole("list", { name: "Reporting" });
  await expect(reporting.getByRole("link", { name: "Reports", exact: true })).toBeVisible();
  await expect(reporting.getByRole("link", { name: "Export data", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
