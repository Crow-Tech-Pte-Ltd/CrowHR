import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { readXlsxSheet } from "../../packages/core/src/export/xlsx-read.ts";

/** Reports (WS6b): export the payroll cost report as XLSX and check its totals. */
async function as(page: Page, persona: string, to: string) {
  await page.goto(`/__dev/as/${persona}?to=${encodeURIComponent(to)}`);
}

test("payroll cost exports to XLSX with the totals on screen", async ({ page }) => {
  await as(page, "payroll", "/reports");
  await page.getByTestId("report-payroll.cost").click();
  await expect(page.getByRole("heading", { level: 1, name: "Payroll cost" })).toBeVisible();
  const url = "/reports/payroll.cost?from=2026-01&to=2026-12&by=month";
  await page.goto(url);
  const totals = page.getByTestId("report-totals");
  await expect(totals).toBeVisible();
  // Only finalised runs: September is paid, October is still a draft.
  await expect(page.getByTestId("report-summary")).toContainText("No finalised payroll");
  const api = (await (
    await page.request.get("/api/v1/reports/payroll.cost?from=2026-01&to=2026-12&by=month")
  ).json()) as { totals: Record<string, number>; rows: Record<string, number | string>[] };
  const money = (cents: number) =>
    `S$${Math.trunc(cents / 100).toLocaleString("en-SG")}.${String(cents % 100).padStart(2, "0")}`;
  await expect(totals).toContainText(money(api.totals.grossCents as number));
  await expect(totals).toContainText(money(api.totals.employerTotalCents as number));

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-xlsx").click()]);
  expect(download.suggestedFilename()).toMatch(/^payroll-cost-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const sheet = readXlsxSheet(new Uint8Array(readFileSync(await download.path())));
  const header = sheet[0] ?? [];
  const last = sheet.at(-1) ?? [];
  expect(last[0]?.value).toBe("Total");
  const letter = (ref: string) => ref.replace(/\d+$/, "");
  const cell = (row: typeof last, title: string) => {
    const h = header.find((c) => c.value === title);
    return row.find((c) => h && letter(c.ref) === letter(h.ref))?.value;
  };
  // Money cells are numbers (dollars) formatted #,##0.00; they match the screen to the cent.
  for (const [title, key] of [
    ["Gross pay (S$)", "grossCents"],
    ["Employer CPF (S$)", "employerCpfCents"],
    ["SDL (S$)", "sdlCents"],
    ["Employer total (S$)", "employerTotalCents"],
  ] as const) {
    expect(Math.round(Number(cell(last, title)) * 100), title).toBe(api.totals[key]);
  }
  // And the rows add up to the total row.
  const rows = sheet.slice(1, -1);
  const sum = rows.reduce((a, r) => a + Math.round(Number(cell(r, "Gross pay (S$)")) * 100), 0);
  expect(sum).toBe(api.totals.grossCents);
});

test("hr_admin without payroll access can't run payroll cost", async ({ page }) => {
  await as(page, "hronly", "/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(page.getByTestId("report-people.headcount")).toBeVisible();
  await expect(page.getByTestId("report-payroll.cost")).toHaveCount(0);
  await page.goto("/reports/payroll.cost");
  await expect(page.getByText("You can't run this report")).toBeVisible();
});
