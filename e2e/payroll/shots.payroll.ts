import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** Screenshots for design review (1440 and 390 wide). Only runs when SHOTS_DIR is set. */
const DIR = process.env.SHOTS_DIR;

test.describe("payroll screenshots", () => {
  test.skip(!DIR, "set SHOTS_DIR to capture screenshots");

  for (const [suffix, size] of [
    ["1440", { width: 1440, height: 900 }],
    ["390", { width: 390, height: 844 }],
  ] as const) {
    test(`capture ${suffix}`, async ({ page }) => {
      await page.setViewportSize(size);
      const runs = (await (await page.request.get("/__dev/runs")).json()) as { september: string; october: string };

      await page.goto("/__dev/as/payroll?to=/payroll");
      await expect(page.getByRole("heading", { level: 1, name: "Payroll" })).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws4-runs-${suffix}.png`, fullPage: true });

      await page.goto(`/payroll/runs/${runs.october}`);
      await expect(page.getByText(/Changes since September/)).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws4-run-overview-${suffix}.png`, fullPage: false });
      const table = page.getByRole("table", { name: "Pay per employee" });
      await page.getByRole("heading", { name: /^Employees/ }).evaluate((el) => {
        el.scrollIntoView({ block: "start" });
        window.scrollBy(0, -72);
      });
      await page.screenshot({ path: `${DIR}/ws4-review-table-${suffix}.png` });

      // CPF working drawer for the employee with an AW bonus.
      await table.getByRole("row", { name: /Benjamin Lee/ }).click();
      const drawer = page.getByRole("dialog");
      await expect(drawer.getByText("Rules used")).toBeVisible();
      await page.waitForTimeout(500); // let the slide-in finish
      await page.screenshot({ path: `${DIR}/ws4-cpf-drawer-${suffix}.png` });
      await drawer.getByText("Working", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/ws4-cpf-drawer-working-${suffix}.png` });
      await page.keyboard.press("Escape");

      // The employee's payslip (web) and Me → Payslips.
      await page.goto("/__dev/as/employee?to=/me/payslips");
      await expect(page.getByRole("heading", { level: 1, name: "Payslips" })).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws4-me-payslips-${suffix}.png`, fullPage: true });
      const mine = (await (await page.request.get("/api/v1/payslips")).json()) as {
        items: { id: string; month: string }[];
      };
      const sep = mine.items.find((p) => p.month === "2026-09");
      expect(sep).toBeDefined();
      await page.goto(`/me/payslips/${sep?.id}`);
      await expect(page.getByRole("article")).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws4-payslip-web-${suffix}.png`, fullPage: true });

      if (suffix === "1440") {
        const pdf = await page.request.get(`/api/v1/payslips/${sep?.id}/pdf`);
        expect(pdf.headers()["content-type"]).toBe("application/pdf");
        const file = `${DIR}/ws4-payslip.pdf`;
        writeFileSync(file, await pdf.body());
        try {
          execFileSync("pdftoppm", ["-png", "-r", "110", "-singlefile", file, `${DIR}/ws4-payslip-pdf`]);
        } catch {
          // pdftoppm not installed: the PDF itself is kept for review.
        }
      }
    });
  }
});
