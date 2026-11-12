import { expect, test } from "@playwright/test";

/**
 * A boot that stalls (here: Postgres's WebAssembly never arrives) must not leave the visitor on a
 * silent loading screen. After 30 seconds the boot card offers a reload and a fresh copy.
 */
test("a stalled boot offers a reload and a fresh copy after 30 seconds", async ({ page }) => {
  await page.clock.install();
  await page.route(/\.wasm(\.gz)?$/, () => undefined);
  await page.goto("/");
  const slow = page.locator("#demo-boot-slow");
  await expect(page.getByTestId("demo-loading")).toBeVisible();
  await expect(slow).toBeHidden();
  await page.clock.fastForward(29_000);
  await expect(slow).toBeHidden();
  await page.clock.fastForward(2_000);
  await expect(slow).toContainText("This is taking longer than usual.");
  await expect(slow.getByRole("button", { name: "Reload the page" })).toBeVisible();
  await expect(slow.getByRole("button", { name: "start again with a fresh copy" })).toBeVisible();
});
