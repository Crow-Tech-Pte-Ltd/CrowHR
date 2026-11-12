import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * Theme: System (the default) follows the device, the account menu stores Light or Dark in this
 * browser, and both themes pass axe's colour-contrast checks.
 */

async function axeClean(page: Page) {
  // Menus and the theme change fade: measure once every animation has finished.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    "axe violations",
  ).toEqual([]);
}

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("dark"));

async function chooseTheme(page: Page, name: "System" | "Light" | "Dark") {
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitemradio", { name }).click();
}

test("System follows the device; Light and Dark are kept in this browser", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await uiSignInOk(page, E2E.members.hr.email);
  expect(await isDark(page)).toBe(true);
  await axeClean(page);

  await chooseTheme(page, "Light");
  expect(await isDark(page)).toBe(false);
  await page.reload();
  await page.getByRole("heading", { level: 1 }).waitFor();
  expect(await isDark(page)).toBe(false);
  await axeClean(page);

  await page.emulateMedia({ colorScheme: "light" });
  await chooseTheme(page, "Dark");
  expect(await isDark(page)).toBe(true);
  await page.goto("/people");
  await page.getByRole("heading", { level: 1, name: "People" }).waitFor();
  expect(await isDark(page)).toBe(true);
  await axeClean(page);

  await chooseTheme(page, "System");
  expect(await isDark(page)).toBe(false);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => isDark(page)).toBe(true);
});

test("the sign-in page follows the saved theme before anyone signs in", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("crowhr.theme", "dark"));
  await page.goto(`/sign-in/${E2E.org.slug}`);
  await page.getByLabel("Work email").waitFor();
  expect(await isDark(page)).toBe(true);
  await axeClean(page);
});
