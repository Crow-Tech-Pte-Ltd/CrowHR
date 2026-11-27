import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { apiSignIn, E2E } from "./fixtures.ts";

test("payroll staff can download Excel, CSV and JSON from Export data", async ({ page }) => {
  await apiSignIn(page.request, E2E.members.payroll.email);
  await page.goto("/");
  await page.getByRole("complementary", { name: "Main navigation" }).getByRole("link", { name: "Export data" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Export data" })).toBeVisible();
  await expect(main.getByRole("link", { name: /Payroll runs and year-end/ })).toBeVisible();
  const button = main.getByRole("button", { name: "Download Payroll register", exact: true });
  for (const [label, extension] of [
    ["Excel", "xlsx"],
    ["CSV", "csv"],
    ["JSON", "json"],
  ] as const) {
    await button.click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: `${label} (.${extension})`, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^payroll-register-.*\\.${extension}$`));
    const file = await readFile(await download.path());
    if (extension === "xlsx") expect(file.subarray(0, 2).toString()).toBe("PK");
    if (extension === "csv") expect(file.toString()).toContain("Net payable on this run (S$)");
    if (extension === "json") {
      expect(JSON.parse(file.toString())).toMatchObject({
        report: { id: "payroll.register" },
        params: { state: "finalised" },
        rows: expect.any(Array),
      });
    }
    await expect(main.getByRole("status").filter({ hasText: "Download started" })).toBeVisible();
  }
  await page.setViewportSize({ width: 360, height: 800 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(colorScheme === "dark");
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const { violations } = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target).join(", ")}`)).toEqual([]);
    expect(await main.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(
      await main.evaluate((el) => el.clientWidth),
    );
  }
  await main.getByRole("link", { name: "Payroll register", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Payroll register" })).toBeVisible();
  await expect(main.getByLabel("From month")).toBeVisible();
});

test("staff can reach their own payslips but cannot export the payroll register", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await apiSignIn(page.request, E2E.members.requester.email);
  await page.goto("/");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Export data", exact: true }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Export data" })).toBeVisible();
  await expect(main.getByRole("link", { name: /My payslips/ })).toBeVisible();
  await expect(main.getByRole("button", { name: /Download Payroll register/ })).toHaveCount(0);
  expect((await page.request.get("/api/v1/reports/payroll.register/export?format=json")).status()).toBe(403);
  await main.getByRole("link", { name: /My payslips/ }).click();
  await expect(main.getByRole("heading", { name: "Payslips" })).toBeVisible();
});
