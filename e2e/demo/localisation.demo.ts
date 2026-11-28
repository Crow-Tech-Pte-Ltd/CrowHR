import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { waitForDemo, watchErrors } from "./helpers.ts";

test.use({ viewport: { width: 360, height: 800 }, locale: "zh-SG" });

test("language is shared by the demo and the app, and switching preserves the form and session", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await waitForDemo(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-SG");
  await expect(page.getByTestId("demo-reset")).toHaveAccessibleName("重置");

  const picker = page.getByRole("combobox", { name: "语言" });
  await expect(picker).toHaveValue("zh-SG");
  await picker.selectOption("ms-SG");
  await expect(page.locator("html")).toHaveAttribute("lang", "ms-SG");
  await expect(page.getByTestId("demo-reset")).toHaveAccessibleName("Tetapkan semula");
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
  await expect(page.getByTestId("demo-reset")).toHaveAccessibleName("மீட்டமை");
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
  expect(errors).toEqual([]);
});
