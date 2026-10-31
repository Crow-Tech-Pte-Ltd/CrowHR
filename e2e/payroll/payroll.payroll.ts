import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/**
 * Task 5.3: create a run → review → approve → payslip visible to the employee → download the PDF.
 * The dev server seeds September (paid, released) and October (draft); this test runs November.
 */

async function as(page: Page, persona: string, to: string) {
  await page.goto(`/__dev/as/${persona}?to=${encodeURIComponent(to)}`);
}

test("monthly payroll from creation to the employee's payslip PDF", async ({ page }) => {
  // Payroll admin creates November's run.
  await as(page, "payroll", "/payroll");
  await expect(page.getByRole("heading", { level: 1, name: "Payroll" })).toBeVisible();
  await expect(page.getByText("Open run")).toBeVisible();

  // Year end: IR8A rows from the approved September payslips, for IRAS's import template.
  const ir8a = page.getByTestId("payroll-ir8a");
  await expect(ir8a).toContainText("Income year 2026 (Year of Assessment 2027)");
  await expect(ir8a).toContainText("Appendix 8A");
  const [csv] = await Promise.all([page.waitForEvent("download"), ir8a.getByRole("button", { name: "CSV" }).click()]);
  expect(csv.suggestedFilename()).toBe("ir8a-2026-part1-of-1.csv");
  expect(readFileSync(await csv.path(), "utf8")).toContain("*Record No.,*ID Type [Choose option]");

  await page.getByRole("button", { name: "New run" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Month", { exact: true }).fill("2026-11");
  await dialog.getByRole("button", { name: "Create run" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("November 2026 payroll");

  // Compute: the part-timer has no hours yet, which blocks the run.
  await page.getByRole("button", { name: "Compute" }).click();
  await expect(page.getByText(/1 blocking issue/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
  const blocking = page.locator("li", { hasText: "HOURS_MISSING" });
  await blocking.getByRole("button").first().click();

  // The drawer shows the working; add the hours there.
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Items in this run")).toBeVisible();
  await drawer.getByRole("button", { name: "Add item" }).click();
  await drawer.getByRole("combobox", { name: "Item" }).click();
  await page.getByRole("option", { name: "Hours worked" }).click();
  await drawer.getByLabel("Hours").fill("80");
  await drawer.getByRole("button", { name: "Add item" }).click();
  await expect(drawer.getByText("80 h", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByText(/blocking issue/)).toHaveCount(0);

  // Keyboard review: focus the first row, open it, step to the next employee.
  const firstRow = page.getByRole("table", { name: "Pay per employee" }).locator("tbody tr").first();
  await firstRow.focus();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByText("Rules used")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("link", { name: /cpf\.gov\.sg/ })
      .first(),
  ).toBeVisible();
  const before = await page.getByRole("dialog").getByRole("heading").first().textContent();
  await page.keyboard.press("]");
  await expect(page.getByRole("dialog").getByRole("heading").first()).not.toHaveText(before ?? "");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("In review").first()).toBeVisible();
  const url = page.url();

  // The owner approves and releases payslips.
  await as(page, "owner", new URL(url).pathname);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await page.getByRole("button", { name: "Release payslips" }).click();
  await expect(page.getByText("Payslips released").first()).toBeVisible();

  // The employee sees and downloads the payslip.
  await as(page, "employee", "/me/payslips");
  await expect(page.getByRole("heading", { level: 1, name: "Payslips" })).toBeVisible();
  await page.getByRole("link", { name: "Payslip, November 2026", exact: true }).click();
  await expect(page.getByRole("article", { name: "Payslip, November 2026" })).toBeVisible();
  await expect(page.getByText("Net pay", { exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^payslip-2026-11-E\d{4}\.pdf$/);
  const path = await download.path();
  expect(readFileSync(path).subarray(0, 5).toString()).toBe("%PDF-");

  // Employees cannot open payroll runs.
  await page.goto("/payroll");
  await expect(page).toHaveURL(/\/me\/payslips$/);
});
