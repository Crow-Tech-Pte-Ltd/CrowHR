import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { go, type Persona, pickPersona, signOut, waitForDemo } from "./helpers.ts";

/**
 * Screenshots of the demo at 1440 and 390 wide: loading state, persona picker, Home for each
 * persona, October's payroll run and the About page. Runs only when SHOTS_DIR is set.
 */
const SHOTS_DIR = process.env.SHOTS_DIR;
test.skip(!SHOTS_DIR, "Set SHOTS_DIR to take screenshots.");

const WIDTHS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

const shot = async (page: Page, name: string) => {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: false, animations: "disabled" });
};

for (const w of WIDTHS) {
  test(`demo screens at ${w.name}`, async ({ page }) => {
    await page.setViewportSize({ width: w.width, height: w.height });

    // Loading state: captured while the worker boots (first visit seeds, so it is on screen for a while).
    await page.goto("/");
    await expect(page.getByTestId("demo-loading")).toBeVisible();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#demo-boot-steps li")].some((li) => (li as HTMLElement).dataset.state === "done"),
    );
    await shot(page, `loading-${w.name}`);
    await waitForDemo(page);
    await expect(page.getByTestId("demo-personas")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await shot(page, `persona-picker-${w.name}`);

    const personas: Persona[] = ["owner", "hr-admin", "payroll-admin", "manager", "employee"];
    for (const p of personas) {
      await pickPersona(page, p);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await shot(page, `home-${p}-${w.name}`);
      if (p === "payroll-admin") {
        await page.goto("/payroll");
        await waitForDemo(page);
        await page
          .getByRole("link", { name: /October 2026/ })
          .first()
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText("October 2026 payroll");
        await page.waitForTimeout(400);
        await shot(page, `payroll-run-${w.name}`);
        await page
          .getByRole("table", { name: "Pay per employee" })
          .locator("tbody tr")
          .filter({ hasText: "Goh Jun Jie" })
          .first()
          .click();
        await expect(page.getByRole("dialog").getByText("Rules used")).toBeVisible();
        await page.waitForTimeout(300);
        await shot(page, `payroll-cpf-working-${w.name}`);
        await page.keyboard.press("Escape");
      }
      await signOut(page);
    }

    await go(page, "/sign-in");
    await page.getByTestId("demo-outbox").click();
    await expect(page.getByTestId("demo-outbox-sheet")).toBeVisible();
    await shot(page, `outbox-${w.name}`);
    await page.keyboard.press("Escape");

    await page.goto("/about-demo");
    await expect(page.getByTestId("about-demo")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await shot(page, `about-${w.name}`);
  });
}
